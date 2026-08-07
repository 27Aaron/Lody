import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';

import {
  KIMI_CODE_MIN_NODE_VERSION,
  isNodeVersionAtLeast,
} from '../src/agent/managed-agent-runtime';

describe('locked Kimi ACP package', () => {
  it.skipIf(!isNodeVersionAtLeast(process.versions.node, KIMI_CODE_MIN_NODE_VERSION))(
    'advertises terminal login and rejects an empty home with auth_required',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'lody-kimi-empty-home-'));
      const mainPath = join(
        process.cwd(),
        'node_modules',
        '@moonshot-ai',
        'kimi-code',
        'dist',
        'main.mjs'
      );
      const child = spawn(process.execPath, [mainPath, 'acp'], {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          KIMI_CODE_HOME: join(home, '.kimi-code'),
          KIMI_CODE_NO_AUTO_UPDATE: '1',
          KIMI_DISABLE_TELEMETRY: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-8_192);
      });

      try {
        const connection = new ClientSideConnection(
          () => ({}) as Client,
          ndJsonStream(
            Writable.toWeb(child.stdin),
            Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
          )
        );
        const initialized = await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { auth: { terminal: true } },
        });

        expect(initialized.authMethods).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'terminal', args: ['--login'] }),
          ])
        );

        const authError = await connection
          .newSession({ cwd: home, mcpServers: [] })
          .catch((error) => error);
        expect(authError).toMatchObject({ code: -32000 });
        expect(String((authError as Error).message)).toMatch(/authentication required/iu);
      } catch (error) {
        throw new Error(`Kimi ACP smoke failed. stderr: ${stderr}`, { cause: error });
      } finally {
        child.kill('SIGTERM');
        await Promise.race([
          once(child, 'exit'),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
        await rm(home, { recursive: true, force: true });
      }
    },
    20_000
  );
});
