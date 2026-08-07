import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shutdownLocalAcpAgent, spawnAcpProcess } from './acp-runner';
import type { Logger } from '@/utils/logger';

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

function createFakeChildProcess(options?: {
  exitOnSigterm?: boolean;
  exitOnSigkill?: boolean;
  pid?: number;
}): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.exitCode = null;
  child.pid = options?.pid;
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    if (signal === 'SIGTERM' && options?.exitOnSigterm !== false) {
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, signal));
    }
    if (signal === 'SIGKILL' && options?.exitOnSigkill !== false) {
      child.exitCode = 137;
      queueMicrotask(() => child.emit('exit', 137, signal));
    }
    return true;
  });
  return child;
}

describe('spawnAcpProcess', () => {
  it('spawns ACP agents in a detached process group on POSIX', () => {
    const child = createFakeChildProcess();
    const spawnImpl = vi.fn(() => child);

    const result = spawnAcpProcess({
      cliType: 'builtin',
      agentType: 'codex',
      workdir: '/tmp',
      env: process.env,
      command: 'test-command',
      args: ['--test'],
      spawnImpl: spawnImpl as never,
    });

    expect(result).toBe(child);
    expect(spawnImpl).toHaveBeenCalledWith('test-command', ['--test'], {
      cwd: '/tmp',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
  });
});

describe('shutdownLocalAcpAgent', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the ACP session before terminating the local agent process', async () => {
    const calls: string[] = [];
    const child = createFakeChildProcess();
    const client = {
      closeSession: vi.fn(async () => {
        calls.push('close');
        return true;
      }),
    };
    vi.mocked(child.kill).mockImplementation((signal?: NodeJS.Signals) => {
      calls.push(`kill:${signal ?? 'default'}`);
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, signal));
      return true;
    });

    await shutdownLocalAcpAgent({
      agentProcess: child,
      client: client as never,
      acpSessionId: 'acp-1' as never,
      logger: createSilentLogger(),
      sessionLabel: 'test-local-agent',
    });

    expect(client.closeSession).toHaveBeenCalledWith('acp-1', 5000);
    expect(calls).toEqual(['close', 'kill:SIGTERM']);
  });

  it('escalates to SIGKILL when the local agent process ignores SIGTERM', async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess({ exitOnSigterm: false, exitOnSigkill: true });

    const shutdownPromise = shutdownLocalAcpAgent({
      agentProcess: child,
      logger: createSilentLogger(),
      sessionLabel: 'test-local-agent',
      exitTimeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    await shutdownPromise;

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  if (process.platform !== 'win32') {
    it('terminates the ACP process group on POSIX when the child has a PID', async () => {
      const child = createFakeChildProcess({ pid: 1234 });
      const processKill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        expect(pid).toBe(-1234);
        expect(signal).toBe('SIGTERM');
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, signal));
        return true;
      });

      await shutdownLocalAcpAgent({
        agentProcess: child,
        logger: createSilentLogger(),
        sessionLabel: 'test-local-agent',
      });

      expect(processKill).toHaveBeenCalledTimes(1);
      expect(child.kill).not.toHaveBeenCalled();
    });

    it('escalates the ACP process group to SIGKILL on POSIX when SIGTERM is ignored', async () => {
      vi.useFakeTimers();
      const child = createFakeChildProcess({ pid: 1234 });
      const processKill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        expect(pid).toBe(-1234);
        if (signal === 'SIGKILL') {
          child.exitCode = 137;
          queueMicrotask(() => child.emit('exit', 137, signal));
        }
        return true;
      });

      const shutdownPromise = shutdownLocalAcpAgent({
        agentProcess: child,
        logger: createSilentLogger(),
        sessionLabel: 'test-local-agent',
        exitTimeoutMs: 10,
      });

      await vi.advanceTimersByTimeAsync(10);
      await shutdownPromise;

      expect(processKill).toHaveBeenNthCalledWith(1, -1234, 'SIGTERM');
      expect(processKill).toHaveBeenNthCalledWith(2, -1234, 'SIGKILL');
      expect(child.kill).not.toHaveBeenCalled();
    });
  }
});
