import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@lody/shared';
import type { Logger } from '@/utils/logger';

const connectionMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  newSession: vi.fn(),
  loadSession: vi.fn(),
  resumeSession: vi.fn(),
  unstable_forkSession: vi.fn(),
  closeSession: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: 1,
  ClientSideConnection: class {
    readonly initialize = connectionMocks.initialize;
    readonly newSession = connectionMocks.newSession;
    readonly loadSession = connectionMocks.loadSession;
    readonly resumeSession = connectionMocks.resumeSession;
    readonly unstable_forkSession = connectionMocks.unstable_forkSession;
    readonly closeSession = connectionMocks.closeSession;
    readonly cancel = connectionMocks.cancel;
  },
}));

import { AgentClient } from './agent-client';

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
    setDebug: vi.fn(),
    child: vi.fn(() => logger),
    close: vi.fn(async () => undefined),
  };
  return logger;
}

describe('AgentClient session preparation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.initialize.mockResolvedValue({ agentCapabilities: {} });
    connectionMocks.newSession.mockResolvedValue({ sessionId: 'acp-session-1' });
  });

  it('initializes before the claim and starts the ACP session only with the claimed workdir', async () => {
    const target = deferred<{ workdir: string }>();
    const stages: string[] = [];
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-1' as SessionId,
      terminalManager: {} as never,
      onStartupStage: (event) => stages.push(event.type),
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    const startPromise = client.startSession(
      {} as never,
      '/provisional',
      undefined,
      {},
      undefined,
      async () => await target.promise
    );

    await vi.waitFor(() => expect(stages).toEqual(['initialize_start', 'initialize_end']));
    expect(connectionMocks.initialize).toHaveBeenCalledTimes(1);
    expect(connectionMocks.newSession).not.toHaveBeenCalled();
    expect(stages).toEqual(['initialize_start', 'initialize_end']);

    target.resolve({ workdir: '/claimed' });
    await expect(startPromise).resolves.toEqual({ sessionId: 'acp-session-1' });
    expect(connectionMocks.newSession).toHaveBeenCalledWith({
      cwd: '/claimed',
      mcpServers: [],
    });
    expect(stages).toEqual([
      'initialize_start',
      'initialize_end',
      'new_session_start',
      'new_session_end',
    ]);
  });

  it('registers the same Grok client identifier for initial and replacement sessions', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-grok' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'grok' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');

    expect(connectionMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        _meta: { clientIdentifier: 'lody:session-grok' },
      })
    );
    expect(connectionMocks.newSession).toHaveBeenCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: { clientIdentifier: 'lody:session-grok' },
    });

    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });
    await client.prepareReplacementSession();

    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: { clientIdentifier: 'lody:session-grok' },
    });
  });

  it('aborts while waiting for a claim without creating an ACP session', async () => {
    const target = deferred<{ workdir: string }>();
    const startupAbort = deferred<never>();
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-aborted' as SessionId,
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    const startPromise = client.startSession(
      {} as never,
      '/provisional',
      undefined,
      {},
      startupAbort.promise,
      async () => await target.promise
    );
    await vi.waitFor(() => expect(connectionMocks.initialize).toHaveBeenCalledTimes(1));

    const abortError = new Error('preparation cancelled');
    abortError.name = 'AbortError';
    startupAbort.reject(abortError);

    await expect(startPromise).rejects.toBe(abortError);
    expect(connectionMocks.newSession).not.toHaveBeenCalled();
  });

  it('prepares a turn-addressed fork before adopting it', async () => {
    connectionMocks.initialize.mockResolvedValue({
      agentCapabilities: {
        sessionCapabilities: { fork: {}, close: {} },
        _meta: { lody: { forkAtTurn: { version: 1 } } },
      },
    });
    connectionMocks.unstable_forkSession.mockResolvedValue({ sessionId: 'acp-session-2' });
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-fork' as SessionId,
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });
    await client.startSession({} as never, '/workdir');

    const prepared = await client.prepareReplacementSession('provider-turn-1');

    expect(prepared).toEqual({ sessionId: 'acp-session-2' });
    expect(connectionMocks.unstable_forkSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'acp-session-1',
        cwd: '/workdir',
        _meta: { lody: { forkAtTurn: { version: 1, turnId: 'provider-turn-1' } } },
      })
    );
    await client.cancel('acp-session-1' as never);
    expect(connectionMocks.cancel).toHaveBeenCalledWith({ sessionId: 'acp-session-1' });

    client.adoptPreparedSession(prepared);
    await client.closeDetachedSession('acp-session-1' as never);
    expect(connectionMocks.closeSession).toHaveBeenCalledWith({ sessionId: 'acp-session-1' });
  });

  it('prepares a fresh provider session for editing the first user message', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-first' as SessionId,
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });
    await client.startSession({} as never, '/workdir');
    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });

    await expect(client.prepareReplacementSession()).resolves.toEqual({
      sessionId: 'acp-session-2',
    });
    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
    });
  });
});
