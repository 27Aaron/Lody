import { describe, expect, it } from 'vitest';
import {
  SessionStatusFactory,
  type MachineId,
  type SessionId,
  type SessionMeta,
} from '@lody/shared';
import {
  findNextDispatchableUserTurn,
  getPendingUserTurnActivationId,
  hasPendingUserTurnActivation,
  resolveSessionDispatchAction,
  shouldWatchSession,
} from './session-dispatch-logic';
import { SessionExecutionService } from './session-execution-service';

describe('shouldWatchSession', () => {
  const baseMeta = {
    id: 'session-idle' as SessionId,
    machineId: 'machine-1',
    createdAt: '2026-08-03T00:00:00.000Z',
    userId: 'user-1',
    cliType: 'builtin',
    agentType: 'codex',
    status: SessionStatusFactory.idle(),
  } satisfies SessionMeta;

  const decide = (
    meta: SessionMeta,
    overrides: Partial<{
      hasUnprocessedCancelRequest: boolean;
      hasRpcTurnOffer: boolean;
      hasAccessRetry: boolean;
    }> = {}
  ) =>
    shouldWatchSession({
      meta,
      hasUnprocessedCancelRequest: false,
      hasRpcTurnOffer: false,
      hasAccessRetry: false,
      ...overrides,
    });

  it('keeps idle metadata-only sessions closed regardless of handled-marker history', () => {
    expect(decide(baseMeta)).toBe(false);
    expect(decide({ ...baseMeta, lastHandledUserMsgId: 'turn-old' })).toBe(false);
  });

  it('opens rooms for every durable dispatch activation signal', () => {
    expect(decide({ ...baseMeta, latestUserMsgId: 'turn-pending' })).toBe(true);
    expect(decide({ ...baseMeta, processingUserMsgId: 'turn-processing' })).toBe(true);
    expect(decide({ ...baseMeta, messageQueueUpdatedAt: 2, messageQueueCheckedAt: 1 })).toBe(true);
    expect(decide({ ...baseMeta, status: SessionStatusFactory.running() })).toBe(true);
  });

  it('suppresses only the exact activation whose history payload was missing', () => {
    const missingMeta = {
      ...baseMeta,
      latestUserMsgId: 'turn-missing',
      processingUserMsgId: 'turn-missing',
      lastMissingHistoryUserMsgId: 'turn-missing',
    };
    expect(hasPendingUserTurnActivation(missingMeta)).toBe(false);
    expect(getPendingUserTurnActivationId(missingMeta)).toBeUndefined();
    expect(decide(missingMeta)).toBe(false);
    expect(
      decide({
        ...missingMeta,
        latestUserMsgId: 'turn-new',
      })
    ).toBe(true);
    expect(
      getPendingUserTurnActivationId({
        ...missingMeta,
        latestUserMsgId: 'turn-new',
      })
    ).toBe('turn-new');
  });

  it('opens rooms for process-local RPC, access-retry, and cancel signals', () => {
    expect(decide(baseMeta, { hasRpcTurnOffer: true })).toBe(true);
    expect(decide(baseMeta, { hasAccessRetry: true })).toBe(true);
    expect(decide(baseMeta, { hasUnprocessedCancelRequest: true })).toBe(true);
  });
});

describe('resolveSessionDispatchAction rewrite barrier', () => {
  it('blocks stale-status repair and pending dispatch while history is being replaced', () => {
    const machineId = 'machine-1' as MachineId;
    const meta = {
      id: 'session-1',
      machineId,
      createdAt: '2026-08-03T00:00:00.000Z',
      userId: 'user-1',
      cliType: 'builtin',
      agentType: 'codex',
      status: SessionStatusFactory.running(),
      latestUserMsgId: 'replacement-user',
    } as SessionMeta;

    expect(
      resolveSessionDispatchAction(
        {
          meta,
          history: [
            {
              id: 'replacement-user',
              timestamp: '2026-08-03T00:00:01.000Z',
              role: 'user',
              items: [{ type: 'text', text: 'replacement' }],
              fileDiff: [],
              status: 'pending',
            },
          ],
          hasActiveTurn: false,
          hasBlockingPendingCreate: false,
          hasReusableSession: true,
          hasRewriteBarrier: true,
        },
        machineId
      )
    ).toEqual({ type: 'noop', reason: 'rewrite-barrier' });
  });
});

describe('findNextDispatchableUserTurn steer intent', () => {
  const machineId = 'machine-1' as MachineId;
  const guide = {
    id: 'guide-user',
    timestamp: '2026-08-03T00:00:01.000Z',
    role: 'user' as const,
    items: [{ type: 'text' as const, text: 'do it differently' }],
    fileDiff: [],
    status: 'pending_apply' as const,
  };
  const baseMeta = {
    id: 'session-1',
    machineId,
    createdAt: '2026-08-03T00:00:00.000Z',
    userId: 'user-1',
    cliType: 'builtin',
    agentType: 'codex',
    status: SessionStatusFactory.idle(),
    lastHandledUserMsgId: 'earlier-user',
  } as SessionMeta;

  it('leaves an ordinary guide alone: it belongs to the steer path, not dispatch', () => {
    expect(findNextDispatchableUserTurn([guide], baseMeta)).toBeNull();
  });

  it('dispatches a guide the dispatch pointer was re-aimed at after the agent refused it', () => {
    expect(
      findNextDispatchableUserTurn([guide], { ...baseMeta, latestUserMsgId: 'guide-user' })
    ).toEqual(guide);
  });

  it('does not re-dispatch a re-aimed guide that already ran', () => {
    expect(
      findNextDispatchableUserTurn([guide], {
        ...baseMeta,
        latestUserMsgId: 'guide-user',
        lastHandledUserMsgId: 'guide-user',
      })
    ).toBeNull();
  });
});

describe('findNextDispatchableUserTurn missing-history acknowledgement', () => {
  it('does not resurrect a turn whose payload arrived after recovery timed out', () => {
    const turn = {
      id: 'turn-missing',
      timestamp: '2026-08-03T00:00:01.000Z',
      role: 'user' as const,
      items: [{ type: 'text' as const, text: 'late payload' }],
      fileDiff: [],
      status: 'pending' as const,
    };
    const meta = {
      id: 'session-1',
      machineId: 'machine-1',
      createdAt: '2026-08-03T00:00:00.000Z',
      userId: 'user-1',
      cliType: 'builtin',
      agentType: 'codex',
      status: SessionStatusFactory.idle(),
      latestUserMsgId: turn.id,
      lastMissingHistoryUserMsgId: turn.id,
    } as SessionMeta;

    expect(findNextDispatchableUserTurn([turn], meta)).toBeNull();
  });
});

describe('SessionExecutionService history mutation ownership', () => {
  it('makes queue promotion and edit-and-resend mutually exclusive', () => {
    const service = new SessionExecutionService({
      logger: { debug: () => undefined } as never,
      sessionManager: {
        getPendingSession: () => undefined,
        getSession: () => undefined,
      },
    } as never);
    const sessionId = 'session-1' as SessionId;

    const releaseQueue = service.tryAcquireSessionRewriteConflictLease(sessionId);
    expect(releaseQueue).toBeTypeOf('function');
    expect(service.tryAcquireSessionRewriteBarrier(sessionId)).toBeNull();

    releaseQueue?.();
    const releaseRewrite = service.tryAcquireSessionRewriteBarrier(sessionId);
    expect(releaseRewrite).toBeTypeOf('function');
    expect(service.tryAcquireSessionRewriteConflictLease(sessionId)).toBeNull();

    releaseRewrite?.();
    const releaseNextQueue = service.tryAcquireSessionRewriteConflictLease(sessionId);
    expect(releaseNextQueue).toBeTypeOf('function');
    releaseNextQueue?.();
  });
});
