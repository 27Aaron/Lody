import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'child_process';

import { ShellTerminalManager } from '../src/session/terminal-manager';
import type { SessionProcessHandle, SessionSandbox } from '../src/session/session-sandbox';
import type { Logger } from '../src/utils/logger';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

function createProcessHandle(terminate: SessionProcessHandle['terminate']): SessionProcessHandle {
  const child = new EventEmitter() as ChildProcess;
  child.pid = 4321;
  child.killed = false;
  child.exitCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);

  const subscribe = (stream: NodeJS.ReadableStream) => (listener: (chunk: Buffer) => void) => {
    stream.on('data', listener);
    return () => {
      stream.off('data', listener);
    };
  };

  return {
    child,
    inspectExit: async () => null,
    terminate,
    onExit: () => () => {},
    onClose: () => () => {},
    onError: () => () => {},
    onStdout: subscribe(child.stdout as NodeJS.ReadableStream),
    onStderr: subscribe(child.stderr as NodeJS.ReadableStream),
  };
}

describe('ShellTerminalManager', () => {
  it('uses process handle termination instead of child.kill when stopping terminals', async () => {
    const terminate = vi.fn(async () => {});
    const processHandle = createProcessHandle(terminate);
    const sandbox: SessionSandbox = {
      enabled: false,
      description: 'noop',
      applyLimits: async () => {},
      spawn: vi.fn(async () => processHandle),
      terminate: async () => {},
      cleanup: async () => {},
    };
    const manager = new ShellTerminalManager({
      logger: createSilentLogger(),
      sessionLabel: 'test-session',
      getActiveAcpSessionId: () => 'acp-1',
      resolveWorkdir: (cwd) => cwd ?? process.cwd(),
      buildEnv: () => process.env,
      sandbox,
    });

    const terminalId = await manager.createTerminal('acp-1', 'node', ['-v']);
    await manager.killTerminal('acp-1', terminalId);

    expect(terminate).toHaveBeenCalledWith(false);
    expect(processHandle.child.kill).not.toHaveBeenCalled();
  });
});
