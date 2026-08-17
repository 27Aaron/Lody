import { describe, expect, it, vi } from 'vitest';
import {
  SessionStatusFactory,
  type AgentConfigId,
  type MachineId,
  type McpServerId,
  type SessionHistoryInput,
  type SessionId,
  type SessionMeta,
} from '@lody/shared';
import { cloneHistoryThroughTurn, SessionForkService } from './session-fork-service';

const sourceSessionId = 'source-session' as SessionId;
const targetSessionId = 'target-session' as SessionId;
const machineId = 'machine-1' as MachineId;
const agentConfigId = 'agent-config-1' as AgentConfigId;

const sourceHistory: SessionHistoryInput[] = [
  {
    id: 'user-1',
    timestamp: '2026-07-27T00:00:00.000Z',
    role: 'user',
    items: [{ type: 'text', text: 'hello' }],
    fileDiff: [],
    finished: true,
    read: true,
    status: 'handled',
    sendStatus: undefined,
  },
  {
    id: 'assistant-1',
    timestamp: '2026-07-27T00:00:01.000Z',
    role: 'assistant',
    items: [{ type: 'text', text: 'world' }],
    fileDiff: [],
    finished: true,
    read: true,
    status: undefined,
    sendStatus: undefined,
  },
];

function createForkHarness(
  failPersistReason?: string,
  options: {
    sourceBusy?: boolean;
    supportsActiveTurnFork?: boolean;
    sourceHistory?: SessionHistoryInput[];
    worktree?: { dirty: boolean; headSha: string };
  } = {}
) {
  const sourceMeta = {
    id: sourceSessionId,
    machineId,
    createdAt: '2026-07-27T00:00:00.000Z',
    lastMessageAt: 1,
    title: 'Original',
    userId: 'user-1',
    status: SessionStatusFactory.idle(),
    isArchived: false,
    cliType: 'builtin',
    agentType: 'codex',
    agentConfigId,
    acpSessionId: 'acp-source',
    ...(options.worktree
      ? {
          project: {
            kind: 'local' as const,
            localProjectId: 'local-project-1' as never,
          },
        }
      : {}),
  } as unknown as SessionMeta;
  const sourceDoc = {
    getMetaState: vi.fn(async () => sourceMeta),
    getHistory: vi.fn(async () => options.sourceHistory ?? sourceHistory),
  };
  let forkOperation: unknown;
  const targetDoc = {
    updateHistory: vi.fn(async () => undefined),
    waitUntilSynced: vi.fn(async () => false),
    getForkOperation: vi.fn(() => forkOperation),
    setForkOperation: vi.fn((operation) => {
      forkOperation = operation;
    }),
  };
  const persistPendingChanges = vi.fn(async (reason: string) => {
    if (reason === failPersistReason) {
      throw new Error(`persist failed: ${reason}`);
    }
  });
  const repo = {
    getDocMeta: vi.fn(async () => undefined),
    upsertDocMeta: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
  };
  const workspaceDocument = {
    repo,
    getOrCreateSessionDoc: vi.fn(async (sessionId: SessionId) =>
      sessionId === sourceSessionId ? sourceDoc : targetDoc
    ),
    getAgentConfigById: vi.fn(async () => ({
      customAcp: undefined,
      runtimeOverrides: undefined,
      env: undefined,
    })),
    persistPendingChanges,
  };
  const sessionManager = {
    createSession: vi.fn(async () => undefined),
    getSession: vi.fn((sessionId: SessionId) =>
      sessionId === sourceSessionId
        ? {
            acpSessionId: 'acp-source',
            agentClient: {
              supportsActiveTurnFork: () => options.supportsActiveTurnFork === true,
            },
          }
        : { acpSessionId: 'acp-target', getWorkdir: () => process.cwd() }
    ),
    terminateSession: vi.fn(async () => undefined),
    resolveSessionWorkdir: vi.fn(async () => '/source/workdir'),
    resolveLocalProjectRootPath: vi.fn(async () => '/source/project-root'),
    cleanupForkWorktree: vi.fn(async () => undefined),
  };
  const logger = { error: vi.fn() };
  const service = new SessionForkService({
    workspaceDocument: workspaceDocument as never,
    sessionManager: sessionManager as never,
    userResolver: {
      resolve: vi.fn(async () => ({ name: 'User', email: 'user@example.com' })),
    } as never,
    logger: logger as never,
    workspaceId: 'workspace-1',
    machineId,
    isSourceBusy: () => options.sourceBusy === true,
    inspectGitWorkdir: options.worktree
      ? vi.fn(async () => ({
          dirty: options.worktree!.dirty,
          headSha: options.worktree!.headSha,
        }))
      : undefined,
  });

  return {
    service,
    persistPendingChanges,
    repo,
    sessionManager,
    targetDoc,
  };
}

const forkSpec = {
  sourceSessionId,
  sourceTurnId: 'assistant-1',
  targetSessionId,
  requestedByUserId: 'user-1',
};

describe('cloneHistoryThroughTurn', () => {
  it('clones through the latest completed assistant turn and records the origin', () => {
    const history: SessionHistoryInput[] = [
      {
        id: 'user-1',
        timestamp: '2026-07-27T00:00:00.000Z',
        role: 'user',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
        finished: true,
        read: false,
        status: 'handled',
        sendStatus: undefined,
      },
      {
        id: 'assistant-1',
        timestamp: '2026-07-27T00:00:01.000Z',
        role: 'assistant',
        items: [{ type: 'text', text: 'world' }],
        fileDiff: [{ filePath: 'src/a.ts', add: 1, del: 0 }],
        finished: true,
        read: false,
        status: undefined,
        sendStatus: undefined,
      },
    ];

    const result = cloneHistoryThroughTurn(
      history,
      'assistant-1',
      sourceSessionId,
      'Original',
      targetSessionId
    );

    expect(result).not.toBeNull();
    expect(result?.warnings.map((warning) => warning.code)).toEqual([
      'HISTORICAL_TURN_DIFF_UNAVAILABLE',
    ]);
    expect(result?.history[1]?.fileDiff).toEqual([]);
    expect(result?.history.at(-1)?.items).toEqual([
      {
        type: 'system_notice',
        name: 'session_fork_origin',
        meta: {
          sourceSessionId,
          sourceTurnId: 'assistant-1',
          sourceTitle: 'Original',
        },
      },
    ]);
  });

  it('rejects a non-latest assistant turn', () => {
    const assistant = (id: string): SessionHistoryInput => ({
      id,
      timestamp: '2026-07-27T00:00:00.000Z',
      role: 'assistant',
      items: [{ type: 'text', text: id }],
      fileDiff: [],
      finished: true,
      read: true,
      status: undefined,
      sendStatus: undefined,
    });
    expect(
      cloneHistoryThroughTurn(
        [assistant('assistant-1'), assistant('assistant-2')],
        'assistant-1',
        sourceSessionId,
        'Original',
        targetSessionId
      )
    ).toBeNull();
  });

  it('clones through an older assistant turn with an exact ACP turn boundary', () => {
    const assistant = (id: string, acpTurnId?: string): SessionHistoryInput => ({
      id,
      timestamp: '2026-07-27T00:00:00.000Z',
      role: 'assistant',
      items: [{ type: 'text', text: id }],
      fileDiff: [],
      finished: true,
      read: true,
      status: undefined,
      sendStatus: undefined,
      acpTurnId,
    });

    const result = cloneHistoryThroughTurn(
      [assistant('assistant-1', 'turn-answer-1'), assistant('assistant-2')],
      'assistant-1',
      sourceSessionId,
      'Original',
      targetSessionId
    );

    expect(result?.history.map((entry) => entry.id)).toEqual([
      'assistant-1',
      `session-fork-origin:${targetSessionId}`,
    ]);
    expect(result?.history[0]?.acpTurnId).toBe('turn-answer-1');
    expect(result?.acpTurnId).toBe('turn-answer-1');
  });

  it('clones the completed prefix while an unfinished assistant turn is active', () => {
    const history: SessionHistoryInput[] = [
      ...sourceHistory,
      {
        id: 'user-2',
        timestamp: '2026-07-27T00:00:02.000Z',
        role: 'user',
        items: [{ type: 'text', text: 'next' }],
        fileDiff: [],
        finished: true,
        read: true,
        status: 'pending',
        sendStatus: undefined,
      },
      {
        id: 'assistant-2',
        timestamp: '2026-07-27T00:00:03.000Z',
        role: 'assistant',
        items: [{ type: 'text', text: 'streaming' }],
        fileDiff: [],
        finished: false,
        read: true,
        status: undefined,
        sendStatus: undefined,
      },
    ];

    const result = cloneHistoryThroughTurn(
      history,
      'assistant-1',
      sourceSessionId,
      'Original',
      targetSessionId,
      { allowActiveTurnSuffix: true }
    );

    expect(result?.history.map((entry) => entry.id)).toEqual([
      'user-1',
      'assistant-1',
      `session-fork-origin:${targetSessionId}`,
    ]);
  });
});

describe('SessionForkService durability boundary', () => {
  it('commits after local persistence without requiring a cloud sync acknowledgement', async () => {
    const harness = createForkHarness();

    const result = await harness.service.fork(forkSpec);

    expect(result.success).toBe(true);
    expect(harness.persistPendingChanges.mock.calls.map(([reason]) => reason)).toEqual([
      'session-fork-prepare',
      'session-fork-commit',
    ]);
    expect(harness.targetDoc.waitUntilSynced).not.toHaveBeenCalled();
    expect(harness.sessionManager.terminateSession).not.toHaveBeenCalled();
  });

  it('persists a side-panel placement without changing workspace ownership', async () => {
    const harness = createForkHarness();

    const result = await harness.service.fork({
      ...forkSpec,
      targetPlacement: 'side-panel',
    });

    expect(result.success).toBe(true);
    expect(harness.repo.upsertDocMeta).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        parentSessionId: sourceSessionId,
        childSessionPlacement: 'side-panel',
      })
    );
    expect(harness.sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ parentSessionId: sourceSessionId }),
      expect.any(Object)
    );
  });

  it('forks through the persisted ACP turn boundary before an active turn', async () => {
    const harness = createForkHarness(undefined, {
      sourceBusy: true,
      supportsActiveTurnFork: true,
      sourceHistory: [
        sourceHistory[0]!,
        {
          ...sourceHistory[1]!,
          acpTurnId: 'turn-previous-answer',
        },
      ],
    });

    const result = await harness.service.fork(forkSpec);

    expect(result.success).toBe(true);
    expect(harness.sessionManager.createSession).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        forkSessionId: 'acp-source',
        forkSessionTurnId: 'turn-previous-answer',
      })
    );
  });

  it('forks an older completed assistant turn through its persisted ACP turn id', async () => {
    const historicalSource: SessionHistoryInput[] = [
      {
        ...sourceHistory[0]!,
      },
      {
        ...sourceHistory[1]!,
        acpTurnId: 'turn-answer-1',
      },
      {
        id: 'assistant-2',
        timestamp: '2026-07-27T00:00:02.000Z',
        role: 'assistant',
        items: [{ type: 'text', text: 'later' }],
        fileDiff: [],
        finished: true,
        read: true,
      },
    ];
    const harness = createForkHarness(undefined, { sourceHistory: historicalSource });

    const result = await harness.service.fork(forkSpec);

    expect(result.success).toBe(true);
    expect(harness.sessionManager.createSession).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        forkSessionId: 'acp-source',
        forkSessionTurnId: 'turn-answer-1',
      })
    );
  });

  it('keeps the busy rejection for agents without active-turn fork points', async () => {
    const harness = createForkHarness(undefined, {
      sourceBusy: true,
      supportsActiveTurnFork: false,
    });

    const result = await harness.service.fork(forkSpec);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'SOURCE_SESSION_BUSY' },
    });
    expect(harness.sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('does not start ACP when the target cannot be prepared durably', async () => {
    const harness = createForkHarness('session-fork-prepare');

    const result = await harness.service.fork(forkSpec);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'TARGET_WRITE_FAILED' },
    });
    expect(harness.sessionManager.createSession).not.toHaveBeenCalled();
    expect(harness.repo.deleteDoc).toHaveBeenCalledTimes(1);
    expect(harness.persistPendingChanges).toHaveBeenLastCalledWith('session-fork-rollback');
  });

  it('compensates the ACP fork when the final durable commit fails', async () => {
    const harness = createForkHarness('session-fork-commit');

    const result = await harness.service.fork(forkSpec);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'TARGET_WRITE_FAILED' },
    });
    expect(harness.sessionManager.createSession).toHaveBeenCalledTimes(1);
    expect(harness.sessionManager.terminateSession).toHaveBeenCalledWith(targetSessionId, true);
    expect(harness.repo.deleteDoc).toHaveBeenCalledTimes(1);
    expect(harness.persistPendingChanges).toHaveBeenLastCalledWith('session-fork-rollback');
  });

  it('requires confirmation for a dirty source without reserving the target', async () => {
    const harness = createForkHarness(undefined, {
      worktree: { dirty: true, headSha: 'a'.repeat(40) },
    });

    const result = await harness.service.fork({
      ...forkSpec,
      targetContext: { kind: 'new-worktree' },
    });

    expect(result).toMatchObject({
      success: false,
      disposition: 'confirmation-required',
      reason: 'SOURCE_WORKTREE_DIRTY',
    });
    expect(harness.targetDoc.setForkOperation).not.toHaveBeenCalled();
    expect(harness.sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('accepts durably before creating an independent worktree from captured HEAD', async () => {
    const capturedHead = 'b'.repeat(40);
    const selectedMcpServerId = 'mcp-server-1' as McpServerId;
    const harness = createForkHarness(undefined, {
      worktree: { dirty: true, headSha: capturedHead },
      sourceHistory: [
        {
          ...sourceHistory[0]!,
          inputConfig: {
            prompt: 'hello',
            cliType: 'builtin',
            agentType: 'codex',
            mcpServerIds: [selectedMcpServerId],
          },
        },
        sourceHistory[1]!,
      ],
    });

    const result = await harness.service.fork({
      ...forkSpec,
      targetContext: { kind: 'new-worktree', acknowledgeDirtySource: true },
    });

    expect(result).toMatchObject({
      success: true,
      disposition: 'accepted',
      operationId: `session-fork:${targetSessionId}`,
    });
    expect(harness.persistPendingChanges).toHaveBeenCalledWith('session-fork-prepare');
    expect(harness.targetDoc.setForkOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        capturedHeadSha: capturedHead,
        sourceWasDirty: true,
        state: 'preparing',
      })
    );
    expect(harness.sessionManager.createSession).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.sessionManager.createSession).toHaveBeenCalledTimes(1));
    expect(harness.sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeStartPoint: capturedHead,
        deferWorktreeMetaPersistence: true,
        workdir: '/source/project-root',
        project: expect.objectContaining({ kind: 'local', useWorktree: true }),
        mcpServerIds: [selectedMcpServerId],
      }),
      expect.objectContaining({ forkSessionId: 'acp-source' })
    );
    expect(harness.sessionManager.createSession.mock.calls[0]?.[0]).not.toHaveProperty(
      'parentSessionId'
    );
    await vi.waitFor(() =>
      expect(harness.persistPendingChanges).toHaveBeenCalledWith('session-fork-commit')
    );
    expect(harness.targetDoc.updateHistory).toHaveBeenCalledTimes(1);
    expect(harness.targetDoc.setForkOperation).toHaveBeenLastCalledWith(undefined);
  });
});
