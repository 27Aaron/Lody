import { useCallback } from 'react';
import { useCloudMutation } from '@lody/platform/react';
import { cloudOperations } from '@/lib/cloud-api-operations';
import { useCloudQuery } from '@lody/platform/react';
import type {
  Session,
  SessionStatus,
  SessionHistory,
  SessionHistoryInput,
  SessionId,
  SessionMeta,
  SessionToCreate,
  MachineId,
  MachineLegacyMetaFields,
  SessionDocMeta,
  SessionTurnInputConfig,
  MachineFlockKey,
  MachineFlockRow,
} from '@lody/shared';
import {
  buildMachineArchiveSessionCommand,
  buildMachineDeleteSessionCommand,
  getMachineRoomId,
  getMachineFlockDocId,
  getMachineFlockLocalProjects,
  getSessionRoomId,
  machineFlockKeys,
  machineDeleteCommandToQueueItem,
  SessionStatusFactory,
  getLocalProjectHistoryProviderKey,
  getServerNow,
  evaluateSessionCreateQuota,
  formatSessionQuotaRejection,
  isConvexUnauthenticatedError,
  isLoroRepoDocDeleted,
  normalizeSessionTurnInputConfig,
  readMachineFlockRowsFromFlock,
  shouldQueueMachineDeleteSession,
} from '@lody/shared';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { usePostHog } from '@posthog/react';
// Default import: `debug` is CJS. Named `{ debug }` breaks Vite 8 / TanStack
// module-runner interop used by site-docs SSR (UNEXPECTED named-export error).
import debug from 'debug';
import { v4 as uuidv4 } from 'uuid';
import { activeWorkspaceRuntimeAtom, type WorkspaceRuntime } from '@/atoms/runtime';
import {
  setDocMetaByRoomIdAtom,
  sessionMetaCacheAtom,
  sessionMetaCountAtom,
} from '@/atoms/doc-meta';
import {
  addRpcDeliveredTurn,
  getRpcDeliveredTurnKey,
  rpcDeliveredTurnsAtom,
} from '@/atoms/session-dispatch-delivery';
import { resolveSessionCreateRepoFullName } from '@/lib/session-repo';
import { capturePostHogEvent } from '@/lib/posthog-analytics';
import { useAuthenticatedConvex } from './use-authenticated-convex';

const log = debug('lody:session-actions');

type RepoDocMetaPatch = Parameters<WorkspaceRuntime['repo']['upsertDocMeta']>[1];
type CreateSessionResult = {
  sessionId: SessionId;
  sessionMeta: SessionMeta;
};
type StartSessionResult = CreateSessionResult & {
  historyEntry: SessionHistory;
};

function buildSessionCreateResult(payload: SessionToCreate): CreateSessionResult {
  const sessionId = payload.sessionId ?? (uuidv4() as SessionId);
  const sessionMeta: SessionMeta = {
    id: sessionId,
    machineId: payload.machineId,
    userId: payload.userId,
    status: SessionStatusFactory.idle(),
    isArchived: false,
    createdAt: new Date().toISOString(),
    cliType: payload.cliType,
    agentType: payload.agentType,
    agentConfigId: payload.agentConfigId,
    acpSessionId: undefined,
    diffStats: undefined,
  };
  if (payload.title?.trim()) {
    sessionMeta.title = payload.title.trim();
    sessionMeta.titleSource = payload.titleSource ?? 'user';
  }
  if (payload.fromFeedbackPostId?.trim()) {
    sessionMeta.fromFeedbackPostId = payload.fromFeedbackPostId.trim();
  }
  const repoFullName = resolveSessionCreateRepoFullName(payload);
  if (repoFullName) {
    sessionMeta.repoFullName = repoFullName;
  }
  if (payload.project) {
    sessionMeta.project = payload.project;
  }
  if (
    payload.isWorktree === true ||
    payload.project?.kind === 'github' ||
    payload.project?.useWorktree === true
  ) {
    sessionMeta.isWorktree = true;
  }
  const baseBranch =
    payload.project?.kind === 'local'
      ? undefined
      : payload.project?.branch?.trim() || payload.branchName?.trim();
  if (baseBranch) {
    sessionMeta.baseBranch = baseBranch;
  }
  if (payload.parentSessionId) {
    sessionMeta.parentSessionId = payload.parentSessionId;
  }
  return { sessionId, sessionMeta };
}

/**
 * Local workspace state rejected creating this session for billing reasons
 * (free session limit, or the workspace is waiting on checkout). Callers surface
 * an upgrade/checkout prompt instead of a generic failure toast.
 */
export class SessionCreateBillingError extends Error {
  constructor(
    readonly code: 'free_session_limit_reached' | 'workspace_payment_required',
    readonly limit: number,
    readonly current: number,
    message: string
  ) {
    super(message);
    this.name = 'SessionCreateBillingError';
  }
}

async function writeMachineFlockRowBestEffort(
  runtime: WorkspaceRuntime,
  machineId: string,
  row: MachineFlockRow,
  reason: string
): Promise<void> {
  try {
    await writeMachineFlockRowRequired(runtime, machineId, row);
  } catch (error) {
    log('[machine-flock] failed to write command row', { machineId, reason, error });
  }
}

async function writeMachineFlockRowRequired(
  runtime: WorkspaceRuntime,
  machineId: string,
  row: MachineFlockRow
): Promise<void> {
  await runtime.writer.flockRowPut(
    getMachineFlockDocId(runtime.workspaceId, machineId as MachineId),
    row.key,
    row.value
  );
}

async function deleteMachineFlockRowsBestEffort(
  runtime: WorkspaceRuntime,
  machineId: string,
  keys: MachineFlockKey[],
  reason: string
): Promise<void> {
  try {
    const flockDocId = getMachineFlockDocId(runtime.workspaceId, machineId as MachineId);
    for (const key of keys) {
      await runtime.writer.flockRowDelete(flockDocId, key);
    }
  } catch (error) {
    log('[machine-flock] failed to delete command row', { machineId, reason, error });
  }
}

async function cleanupMachineSessionCommandQueues(
  runtime: WorkspaceRuntime,
  machineId: string,
  sessionId: SessionId,
  reason: string
): Promise<void> {
  const machineRoomId = getMachineRoomId(machineId as MachineId);
  const machineMeta = (await runtime.repo.getDocMeta(machineRoomId))?.meta as
    | MachineLegacyMetaFields
    | undefined;
  const needToArchiveSessions = machineMeta?.needToArchiveSessions ?? {};
  const needToDeleteSessions = machineMeta?.needToDeleteSessions ?? {};

  let nextNeedToArchiveSessions: typeof needToArchiveSessions | undefined;
  let nextNeedToDeleteSessions: typeof needToDeleteSessions | undefined;

  if (needToArchiveSessions[sessionId] !== undefined) {
    const { [sessionId]: _, ...rest } = needToArchiveSessions;
    nextNeedToArchiveSessions = rest;
  }

  if (needToDeleteSessions[sessionId] !== undefined) {
    const { [sessionId]: _, ...rest } = needToDeleteSessions;
    nextNeedToDeleteSessions = rest;
  }

  if (nextNeedToArchiveSessions !== undefined || nextNeedToDeleteSessions !== undefined) {
    await runtime.writer.upsertDocMeta(machineRoomId, {
      ...(nextNeedToArchiveSessions !== undefined
        ? { needToArchiveSessions: nextNeedToArchiveSessions }
        : {}),
      ...(nextNeedToDeleteSessions !== undefined
        ? { needToDeleteSessions: nextNeedToDeleteSessions }
        : {}),
    } as unknown as RepoDocMetaPatch);
  }

  await deleteMachineFlockRowsBestEffort(
    runtime,
    machineId,
    [
      machineFlockKeys.archiveSessionCommand(sessionId),
      machineFlockKeys.deleteSessionCommand(sessionId),
    ],
    reason
  );
}

export type SessionActions = {
  createSession: (payload: SessionToCreate) => Promise<CreateSessionResult>;
  startSession: (
    payload: SessionToCreate,
    history: Omit<SessionHistoryInput, 'id'>
  ) => Promise<StartSessionResult>;
  addSessionHistory: (
    sessionId: SessionId,
    history: Omit<SessionHistoryInput, 'id'>,
    options?: { dispatch?: boolean }
  ) => Promise<SessionHistory>;
  requestSessionDispatch: (
    sessionId: SessionId,
    userTurnId: string,
    options?: { inputConfig?: SessionTurnInputConfig; machineId?: MachineId | null }
  ) => Promise<void>;
  requestSessionCancel: (sessionId: SessionId, turnId: string) => Promise<void>;
  requestSessionSteer: (
    sessionId: SessionId,
    expectedTurnId: string,
    userTurnId: string,
    options?: { machineId?: MachineId | null }
  ) => Promise<boolean>;
  touchSessionActivity: (sessionId: SessionId) => Promise<void>;
  updateSessionStatus: (sessionId: SessionId, status: SessionStatus) => Promise<void>;
  updateSessionTitle: (sessionId: SessionId, title: string) => Promise<void>;
  /** Reassign `SessionMeta.userId` to another workspace member. */
  transferSessionOwner: (sessionId: SessionId, nextUserId: string) => Promise<void>;
  markSessionRead: (sessionId: SessionId, lastMessageAt?: number | null) => Promise<void>;
  deleteSessions: (sessionIds: SessionId[]) => Promise<void>;
  archiveSession: (sessionId: SessionId) => Promise<void>;
  restoreSession: (sessionId: SessionId) => Promise<void>;
  deleteArchivedSession: (sessionId: SessionId) => Promise<void>;
  setSessionPinned: (sessionId: SessionId, isPinned: boolean) => Promise<void>;
};

const extractSessionStatus = (value: unknown): Session['status'] | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const maybeMeta = 'meta' in value ? (value as { meta?: unknown }).meta : value;

  if (!maybeMeta || typeof maybeMeta !== 'object' || !('status' in maybeMeta)) {
    return undefined;
  }

  const status = (maybeMeta as { status?: unknown }).status;
  if (!status || typeof status !== 'object') {
    return undefined;
  }

  const type = (status as { type?: unknown }).type;
  if (typeof type !== 'string') {
    return undefined;
  }

  return status as Session['status'];
};

type SessionActivityProposal = {
  lastMessageAt?: number;
  lastReadAt?: number;
};

function getFiniteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildSessionActivityPatch(
  meta: SessionMeta | undefined,
  proposal: SessionActivityProposal
): Partial<SessionMeta> {
  const patch: Partial<SessionMeta> = {};
  if (proposal.lastMessageAt !== undefined) {
    const current = getFiniteTimestamp(meta?.lastMessageAt);
    if (current === null || proposal.lastMessageAt > current) {
      patch.lastMessageAt = proposal.lastMessageAt;
    }
  }
  if (proposal.lastReadAt !== undefined) {
    const current = getFiniteTimestamp(meta?.lastReadAt);
    if (current === null || proposal.lastReadAt > current) {
      patch.lastReadAt = proposal.lastReadAt;
    }
  }
  return patch;
}

async function upsertSessionActivityPatch(
  runtime: WorkspaceRuntime,
  sessionId: SessionId,
  proposal: SessionActivityProposal
): Promise<SessionMeta | undefined> {
  const roomId = getSessionRoomId(sessionId);
  const existing = await runtime.repo.getDocMeta(roomId);
  if (isLoroRepoDocDeleted(existing)) return undefined;
  const meta = existing?.meta as SessionMeta | undefined;
  const patch = buildSessionActivityPatch(meta, proposal);
  if (Object.keys(patch).length > 0) {
    await runtime.writer.upsertDocMeta(roomId, patch as RepoDocMetaPatch);
  }
  return meta;
}

export async function touchSessionActivityMeta(
  runtime: WorkspaceRuntime,
  sessionId: SessionId,
  proposal: SessionActivityProposal
): Promise<void> {
  const meta = await upsertSessionActivityPatch(runtime, sessionId, proposal);
  const parentSessionId = meta?.parentSessionId;
  if (parentSessionId && parentSessionId !== sessionId) {
    await upsertSessionActivityPatch(runtime, parentSessionId, proposal);
  }
}

export function useSessionActions(): SessionActions {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const setDocMetaByRoomId = useSetAtom(setDocMetaByRoomIdAtom);
  const store = useStore();
  // Convex dedupes identical subscriptions client-side, so this shares the
  // entitlement subscription already held by the chat surfaces.
  const billingEntitlement = useCloudQuery(
    cloudOperations.billing.getWorkspaceBillingEntitlement,
    runtime?.workspaceId ? { workspaceId: runtime.workspaceId } : 'skip'
  );
  const postHog = usePostHog();
  const { isAuthenticated: isConvexAuthenticated, requestAuthRecovery } = useAuthenticatedConvex();
  const recordMyWorkspaceDailyActiveUser = useCloudMutation(
    cloudOperations.activity.recordMyWorkspaceDailyActiveUser
  );

  const recordWorkspaceActivity = useCallback(
    (workspaceId: string | undefined) => {
      if (!workspaceId || !isConvexAuthenticated) return;
      // Best-effort DAU recording: never block the chat/session flow.
      void recordMyWorkspaceDailyActiveUser({ workspaceId }).catch((error: unknown) => {
        if (isConvexUnauthenticatedError(error)) {
          requestAuthRecovery();
          return;
        }
        console.warn('[session-actions] Failed to record daily active user:', error);
      });
    },
    [isConvexAuthenticated, recordMyWorkspaceDailyActiveUser, requestAuthRecovery]
  );

  /** Find all child session IDs for a given parent session. */
  const getChildSessionIds = useCallback(
    (parentId: SessionId): SessionId[] => {
      const cache = store.get(sessionMetaCacheAtom);
      return Object.values(cache)
        .filter((meta): meta is SessionMeta => !!meta && meta.parentSessionId === parentId)
        .map((meta) => meta.id);
    },
    [store]
  );

  const assertSessionCreateAllowed = useCallback(
    (sessionId: SessionId) => {
      if (!runtime?.workspaceId) return;
      if (store.get(sessionMetaCacheAtom)[getSessionRoomId(sessionId)] !== undefined) return;

      const admission = evaluateSessionCreateQuota({
        effectivePlanTier: billingEntitlement?.effectivePlanTier,
        checkoutPending: billingEntitlement?.checkoutPending,
        sessionCount: store.get(sessionMetaCountAtom),
      });
      if (admission.allowed) return;

      throw new SessionCreateBillingError(
        admission.reason === 'checkout_pending'
          ? 'workspace_payment_required'
          : 'free_session_limit_reached',
        admission.limit,
        admission.current,
        formatSessionQuotaRejection('session_create', admission)
      );
    },
    [billingEntitlement, runtime, store]
  );

  const createSession = useCallback(
    async (payload: SessionToCreate): Promise<CreateSessionResult> => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const { sessionId, sessionMeta } = buildSessionCreateResult(payload);
      const sessionRoomId = getSessionRoomId(sessionId);
      // The local Flock index is the session-count source of truth. Incomplete
      // local state fails open so session creation never depends on Convex
      // availability or a server-side reservation.
      assertSessionCreateAllowed(sessionId);
      if (payload.parentSessionId) {
        // Creating a child session (filter/sieve) is an explicit active user action.
        recordWorkspaceActivity(runtime.workspaceId);
      }

      const metaWrite = runtime.writer.upsertDocMeta(sessionRoomId, sessionMeta);
      // Stream pre-creation is a warm-up, not part of accepting the user's turn.
      // Rejected: awaiting it here lets a stuck createStream() prevent history
      // and dispatch writes. Room join/retry handles stream_not_found recovery.
      void runtime.ensureDocStream(sessionRoomId).catch((error: unknown) => {
        console.warn('Failed to pre-create session doc stream', { sessionId, error });
      });
      await metaWrite;
      setDocMetaByRoomId(sessionRoomId, sessionMeta);

      return { sessionId, sessionMeta };
    },
    [assertSessionCreateAllowed, recordWorkspaceActivity, runtime, setDocMetaByRoomId]
  );

  const startSession = useCallback(
    async (
      payload: SessionToCreate,
      history: Omit<SessionHistoryInput, 'id'>
    ): Promise<StartSessionResult> => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const { sessionId, sessionMeta } = buildSessionCreateResult(payload);
      const sessionRoomId = getSessionRoomId(sessionId);
      const historyEntry = { ...history, id: uuidv4() } as SessionHistory;
      const inputConfig = normalizeSessionTurnInputConfig(historyEntry.inputConfig);
      const userId = historyEntry.userId?.trim();
      const timestamp = historyEntry.timestamp?.trim();
      if (historyEntry.role !== 'user' || !userId || !timestamp || !inputConfig) {
        throw new Error(`Cannot start session with invalid user history (sessionId=${sessionId})`);
      }

      assertSessionCreateAllowed(sessionId);
      recordWorkspaceActivity(runtime.workspaceId);
      void runtime.ensureDocStream(sessionRoomId).catch((error: unknown) => {
        console.warn('Failed to pre-create session doc stream', { sessionId, error });
      });
      await runtime.writer.startSession(
        sessionId,
        sessionMeta as unknown as Record<string, unknown>,
        historyEntry as unknown as Record<string, unknown>,
        {
          userTurnId: historyEntry.id,
          userId,
          timestamp,
          inputConfig: inputConfig as unknown as Record<string, unknown>,
        }
      );
      setDocMetaByRoomId(sessionRoomId, sessionMeta);
      capturePostHogEvent(postHog, 'session/chat', {
        user_id: sessionMeta.userId,
        workspace_id: runtime.workspaceId,
        session_id: sessionId,
        machine_id: sessionMeta.machineId,
        agent_config_id: sessionMeta.agentConfigId,
        cli_type: sessionMeta.cliType,
        agent_type: sessionMeta.agentType,
        project_kind: sessionMeta.project?.kind ?? null,
        is_first_message: true,
      });
      return { sessionId, sessionMeta, historyEntry };
    },
    [postHog, recordWorkspaceActivity, assertSessionCreateAllowed, runtime, setDocMetaByRoomId]
  );

  const addSessionHistory = useCallback(
    async (
      sessionId: SessionId,
      history: Omit<SessionHistoryInput, 'id'>,
      options?: { dispatch?: boolean }
    ) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }

      // Sending any user message (new chat, reply, child-session/filter reply)
      // counts as an explicit active user action.
      if (history.role === 'user') {
        recordWorkspaceActivity(runtime.workspaceId);
      }

      const entry = { ...history, id: uuidv4() } as SessionHistory;

      // The pending user turn is authored through the writer seam. In direct
      // (web/cloud) mode the writer authors it into the renderer's own repo,
      // exactly as `sessionStore.setState(history.push(entry))` did before. In
      // intent (Electron local-first) mode it forwards the append to the CLI —
      // the sole author — which relays the authored op back into the local
      // mirror and up to Loro Streams. This resolves when the write is ACCEPTED
      // (the send hot-path accept boundary), not when remote sync completes; the
      // caller may clear the composer / navigate once it returns. It REJECTS
      // when the write did not happen (intent failed after bounded retries),
      // which propagates to the send paths' failure branches — the composer
      // stays intact and the error is surfaced instead of the message silently
      // vanishing.
      //
      let dispatch:
        | {
            userTurnId: string;
            userId: string;
            timestamp: string;
            inputConfig: Record<string, unknown>;
          }
        | undefined;
      if (options?.dispatch) {
        const inputConfig = normalizeSessionTurnInputConfig(entry.inputConfig);
        const userId = entry.userId?.trim();
        const timestamp = entry.timestamp?.trim();
        if (!userId || !timestamp || !inputConfig) {
          throw new Error(`Cannot dispatch invalid user history entry (sessionId=${sessionId})`);
        }
        dispatch = {
          userTurnId: entry.id,
          userId,
          timestamp,
          inputConfig: inputConfig as unknown as Record<string, unknown>,
        };
      }
      await runtime.writer.appendSessionTurn(
        sessionId,
        entry as unknown as Record<string, unknown>,
        dispatch
      );
      // session/chat fires once for every user message dispatched through Lody —
      // the session-creating turn AND every follow-up — so it tracks active-use
      // frequency, unlike session/start_success which only covers creation. This
      // is the single convergence point for both the chat-landing (new session)
      // and session-chat-interface (reply/queue/child) send paths.
      if (history.role === 'user') {
        const sessionMeta = store.get(sessionMetaCacheAtom)[getSessionRoomId(sessionId)];
        capturePostHogEvent(postHog, 'session/chat', {
          user_id: sessionMeta?.userId,
          workspace_id: runtime.workspaceId,
          session_id: sessionId,
          machine_id: sessionMeta?.machineId,
          agent_config_id: sessionMeta?.agentConfigId,
          cli_type: sessionMeta?.cliType,
          agent_type: sessionMeta?.agentType,
          project_kind: sessionMeta?.project?.kind ?? null,
          is_first_message: false,
        });
      }
      return entry;
    },
    [runtime, recordWorkspaceActivity, postHog, store]
  );

  const updateSessionStatus = useCallback(
    async (sessionId: SessionId, status: SessionStatus) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const roomId = getSessionRoomId(sessionId);
      const existing = await runtime.repo.getDocMeta(roomId);
      if (isLoroRepoDocDeleted(existing)) return;
      const prevStatus = extractSessionStatus(existing);
      if (prevStatus?.type === 'running' && status.type === 'idle') {
        // Web should not drive running -> idle; only CLI owns that transition.
        log('[session-status] ignore running -> idle transition from web', {
          sessionId,
          prevStatus,
          nextStatus: status,
        });
        return;
      }
      // Keep web writes aligned with the shared state machine to avoid regressions.
      const nextStatus = status;
      if (prevStatus && nextStatus === prevStatus) {
        return;
      }
      await runtime.writer.upsertDocMeta(roomId, { status: nextStatus } as Partial<SessionMeta>);
    },
    [runtime]
  );

  const requestSessionDispatch = useCallback(
    async (
      sessionId: SessionId,
      userTurnId: string,
      options?: { inputConfig?: SessionTurnInputConfig; machineId?: MachineId | null }
    ) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const entry = await runtime.withSessionStore(sessionId, (sessionStore) =>
        sessionStore
          .getState()
          .history.find((item) => item.id === userTurnId && item.role === 'user')
      );
      const inputConfig =
        options?.inputConfig ?? normalizeSessionTurnInputConfig(entry?.inputConfig);
      const dispatchUserId = entry?.userId?.trim();
      let rpcAcceptedPromise: Promise<boolean> | null = null;
      const startDispatchTurnRpc = (machineId: MachineId | null | undefined): void => {
        // The Machine RPC fast path rides the facade's per-target routing: local
        // machines go over the local socket RPC, remote machines over the cloud
        // JSON stream. The durable pointer write below remains recovery truth.
        if (!machineId || !entry || !inputConfig || !dispatchUserId) {
          return;
        }
        const rpcArgs = {
          sessionId,
          userTurnId,
          userId: dispatchUserId,
          timestamp: entry.timestamp,
          inputConfig,
        };
        // Attachments ride as R2/local references, so payloads are normally
        // small; skip the fast path for pathological sizes rather than risk an
        // oversized stream append.
        try {
          if (JSON.stringify(rpcArgs).length > 256 * 1024) {
            return;
          }
        } catch {
          return;
        }
        rpcAcceptedPromise = runtime
          .requestSessionDispatchTurn(machineId, rpcArgs)
          .then((response) => {
            if (response?.accepted) {
              store.set(rpcDeliveredTurnsAtom, (previous) =>
                addRpcDeliveredTurn(previous, getRpcDeliveredTurnKey(sessionId, userTurnId))
              );
              return true;
            }
            log(
              'session dispatch-turn rpc not accepted for %s/%s: %s',
              sessionId,
              userTurnId,
              response
                ? `${response.disposition}${response.error ? `: ${response.error}` : ''}`
                : 'timeout'
            );
            return false;
          })
          .catch((error) => {
            log('session dispatch-turn rpc threw for %s/%s: %o', sessionId, userTurnId, error);
            return false;
          });
      };

      // Local history writes are the accept boundary. Remote document sync is a
      // sibling of dispatch signaling, never a blocker for clearing the composer.
      // Hold a store ref for the flush so eviction cannot unload the doc mid-flush.
      void runtime
        .withSessionStore(sessionId, (sessionStore) => sessionStore.waitUntilSynced())
        .catch((error: unknown) => {
          console.warn('Failed to sync session doc after dispatch request', {
            sessionId,
            userTurnId,
            error,
          });
        });
      startDispatchTurnRpc(options?.machineId ?? null);
      const roomId = getSessionRoomId(sessionId);
      const existing = await runtime.repo.getDocMeta(roomId);
      if (isLoroRepoDocDeleted(existing)) {
        return;
      }
      if (!options?.machineId) {
        const meta = existing?.meta as SessionMeta | undefined;
        startDispatchTurnRpc(meta?.machineId ?? null);
      }
      try {
        await runtime.writer.upsertDocMeta(roomId, {
          latestUserMsgId: userTurnId,
          lastMissingHistoryUserMsgId: undefined,
        } as Partial<SessionMeta>);
      } catch (error) {
        // The RPC fast path may already have delivered this turn to the CLI; a
        // rejection here would make callers toast "failed to send" for a turn
        // that is actually running, inviting a duplicate resend. Only surface
        // the failure when the fast path did not deliver.
        if (await rpcAcceptedPromise) {
          console.warn('Dispatch metadata write failed after RPC fast-path delivery', {
            sessionId,
            userTurnId,
            error,
          });
          return;
        }
        throw error;
      }
    },
    [runtime, store]
  );

  const requestSessionCancel = useCallback(
    async (sessionId: SessionId, turnId: string) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const roomId = getSessionRoomId(sessionId);
      const existing = await runtime.repo.getDocMeta(roomId);
      if (isLoroRepoDocDeleted(existing)) return;
      const meta = existing?.meta as SessionMeta | undefined;
      const machineId = meta?.machineId;
      if (machineId) {
        // Fast-path RPC is intentionally redundant with the durable meta fallback below.
        void runtime
          .requestSessionCancel(machineId, sessionId, turnId, { timeoutMs: 2_000 })
          .then((response) => {
            if (response && !response.success) {
              log('session cancel rpc failed for %s/%s: %s', sessionId, turnId, response.error);
            }
          })
          .catch((error) => {
            log('session cancel rpc threw for %s/%s: %o', sessionId, turnId, error);
          });
      }
      await runtime.writer.upsertDocMeta(roomId, {
        // Stop targets the assistant turn currently on screen, not the originating user turn.
        lastCanceledTurn: turnId,
      } as Partial<SessionMeta>);
    },
    [runtime]
  );

  const requestSessionSteer = useCallback(
    async (
      sessionId: SessionId,
      expectedTurnId: string,
      userTurnId: string,
      options?: { machineId?: MachineId | null }
    ): Promise<boolean> => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const entry = await runtime.withSessionStore(sessionId, (sessionStore) =>
        sessionStore
          .getState()
          .history.find((item) => item.id === userTurnId && item.role === 'user')
      );
      const inputConfig = normalizeSessionTurnInputConfig(entry?.inputConfig);
      const userId = entry?.userId?.trim();
      const roomId = getSessionRoomId(sessionId);
      let machineId = options?.machineId ?? null;
      if (!machineId) {
        const existing = await runtime.repo.getDocMeta(roomId);
        const meta = isLoroRepoDocDeleted(existing)
          ? undefined
          : (existing?.meta as SessionMeta | undefined);
        machineId = meta?.machineId ?? null;
      }
      if (!entry || !inputConfig || !userId || !machineId) {
        return false;
      }
      const response = await runtime.requestSessionSteer(machineId, {
        sessionId,
        expectedTurnId,
        userTurnId,
        userId,
        timestamp: entry.timestamp,
        inputConfig,
      });
      if (response?.applied) {
        store.set(rpcDeliveredTurnsAtom, (previous) =>
          addRpcDeliveredTurn(previous, getRpcDeliveredTurnKey(sessionId, userTurnId))
        );
        return true;
      }
      if (response?.disposition === 'no-active-turn') {
        // The target prompt ended before the CLI submitted the steer. Reuse
        // the same user turn as a normal follow-up instead of leaving it stuck
        // in pending_apply. Other failures must not fall back because the
        // provider may already have committed the steer.
        // Re-acquire the store for the write: the steer RPC above can run long,
        // and we must not hold a store ref across it.
        const promoted = await runtime.withSessionStore(sessionId, (sessionStore) => {
          let didPromote = false;
          sessionStore.setState((draft: SessionDocMeta) => {
            const pendingEntry = draft.history.find(
              (item) => item.id === userTurnId && item.role === 'user'
            );
            if (pendingEntry?.status === 'pending_apply') {
              pendingEntry.status = 'pending';
              pendingEntry.read = false;
              didPromote = true;
            }
          });
          return didPromote;
        });
        // A duplicate response must not reset a turn that another request has
        // already promoted, started, or completed.
        if (!promoted) {
          return false;
        }
        await requestSessionDispatch(sessionId, userTurnId, {
          inputConfig,
          machineId,
        });
        log(
          'session steer promoted to ordinary dispatch for %s/%s after target turn ended',
          sessionId,
          userTurnId
        );
        return false;
      }
      log(
        'session steer not applied for %s/%s: %s',
        sessionId,
        userTurnId,
        response
          ? `${response.disposition}${response.error ? `: ${response.error}` : ''}`
          : 'timeout'
      );
      return false;
    },
    [requestSessionDispatch, runtime, store]
  );

  const touchSessionActivity = useCallback(
    async (sessionId: SessionId) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const now = getServerNow();
      await touchSessionActivityMeta(runtime, sessionId, { lastMessageAt: now, lastReadAt: now });
    },
    [runtime]
  );

  const updateSessionTitle = useCallback(
    async (sessionId: SessionId, title: string) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const nextTitle = title.trim();
      if (!nextTitle) {
        return;
      }
      const roomId = getSessionRoomId(sessionId);
      const existing = await runtime.repo.getDocMeta(roomId);
      if (isLoroRepoDocDeleted(existing)) return;
      await runtime.writer.upsertDocMeta(roomId, {
        title: nextTitle,
        titleSource: 'user',
      } as Partial<SessionMeta>);
    },
    [runtime]
  );

  /**
   * Hand a session to another workspace member. `SessionMeta.userId` is the
   * owner: it drives the My/Team scope split, the sidebar author avatar, and
   * CLI-side owner checks (Code Collab writes, usage attribution). Anyone in
   * the workspace may transfer, mirroring task owner assignment.
   */
  const transferSessionOwner = useCallback(
    async (sessionId: SessionId, nextUserId: string) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const userId = nextUserId.trim();
      if (!userId) {
        return;
      }
      const roomId = getSessionRoomId(sessionId);
      const existing = await runtime.repo.getDocMeta(roomId);
      if (isLoroRepoDocDeleted(existing)) return;
      await runtime.writer.upsertDocMeta(roomId, {
        userId,
      } as Partial<SessionMeta>);
    },
    [runtime]
  );

  const markSessionRead = useCallback(
    async (sessionId: SessionId, lastMessageAt?: number | null) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const readAt = getFiniteTimestamp(lastMessageAt) ?? getServerNow();
      await touchSessionActivityMeta(runtime, sessionId, { lastReadAt: readAt });
    },
    [runtime]
  );

  const invalidateExternalHistoryCatalog = useCallback(
    async (sessionMeta: SessionMeta | undefined) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const externalHistory = sessionMeta?.externalHistory;
      if (!sessionMeta || !externalHistory || sessionMeta.project?.kind !== 'local') {
        return;
      }

      const machineRoomId = getMachineRoomId(sessionMeta.machineId);
      const machineMeta = (await runtime.repo.getDocMeta(machineRoomId))?.meta as
        | MachineLegacyMetaFields
        | undefined;
      const flockDocId = getMachineFlockDocId(runtime.workspaceId, sessionMeta.machineId);
      const handle = await runtime.repo.openFlockDoc(flockDocId);
      const localProjects = {
        ...(machineMeta?.localProjects ?? {}),
        ...getMachineFlockLocalProjects(
          readMachineFlockRowsFromFlock(handle.flock, { families: ['localProject'] })
        ),
      };
      const project = localProjects?.[sessionMeta.project.localProjectId];
      const providerKey = getLocalProjectHistoryProviderKey(externalHistory.provider);
      const catalog = project?.history?.[providerKey];
      const item = catalog?.sessions[externalHistory.sourceAcpSessionId];
      if (!project || !catalog || !item) {
        return;
      }
      if (item.importedSessionId && item.importedSessionId !== sessionMeta.id) {
        return;
      }

      const nextItem = {
        acpSessionId: item.acpSessionId,
        title: item.title,
        ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        status: 'available' as const,
      };

      const key = machineFlockKeys.localProject(sessionMeta.project.localProjectId);
      await runtime.writer.flockRowPut(flockDocId, key, {
        ...project,
        history: {
          ...(project.history ?? {}),
          [providerKey]: {
            ...catalog,
            sessions: {
              ...catalog.sessions,
              [externalHistory.sourceAcpSessionId]: nextItem,
            },
          },
        },
      });
    },
    [runtime]
  );

  const deleteSessionDocuments = useCallback(
    async (sessionId: SessionId, options?: { cleanupLaunchConfig?: boolean }) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }

      const sessionRoomId = getSessionRoomId(sessionId);
      const sessionMeta = (await runtime.repo.getDocMeta(sessionRoomId))?.meta as
        | SessionMeta
        | undefined;
      await invalidateExternalHistoryCatalog(sessionMeta);
      if (options?.cleanupLaunchConfig !== false && sessionMeta?.machineId) {
        await deleteMachineFlockRowsBestEffort(
          runtime,
          sessionMeta.machineId,
          [machineFlockKeys.sessionLaunchConfig(sessionId)],
          'deleteSessionDocuments'
        );
      }

      await Promise.all([
        runtime.writer.deleteDoc(sessionRoomId),
        runtime.releaseSessionStore(sessionId),
      ]);
    },
    [invalidateExternalHistoryCatalog, runtime]
  );

  const deleteSessions = useCallback(
    async (sessionIds: SessionId[]) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      // Collect child session IDs for cascade deletion
      const allIds = new Set(sessionIds);
      for (const id of sessionIds) {
        for (const childId of getChildSessionIds(id)) {
          allIds.add(childId);
        }
      }
      const uniqueIds = Array.from(allIds);
      await Promise.all(
        uniqueIds.map(async (id) => {
          await deleteSessionDocuments(id);
        })
      );
    },
    [runtime, getChildSessionIds, deleteSessionDocuments]
  );

  const archiveSession = useCallback(
    async (sessionId: SessionId) => {
      log('[session-archive] start', { sessionId });
      if (!runtime) {
        throw new Error('Runtime not ready');
      }

      if (typeof window !== 'undefined') {
        window.api?.terminal?.closeSession(sessionId);
      }

      const sessionRoomId = getSessionRoomId(sessionId);
      const sessionMeta = (await runtime.repo.getDocMeta(sessionRoomId))?.meta as
        | SessionMeta
        | undefined;
      log('[session-archive] session meta loaded', {
        sessionId,
        machineId: sessionMeta?.machineId,
      });

      await runtime.writer.upsertDocMeta(sessionRoomId, {
        isArchived: true,
        status: SessionStatusFactory.idle(),
      } as Partial<SessionMeta>);
      log('[session-archive] session meta archived', { sessionId });

      // Cascade: archive all child sessions first (before any early returns)
      const childIds = getChildSessionIds(sessionId);
      if (childIds.length > 0) {
        await Promise.all(
          childIds.map(async (childId) => {
            const childRoomId = getSessionRoomId(childId);
            await runtime.writer.upsertDocMeta(childRoomId, {
              isArchived: true,
              status: SessionStatusFactory.idle(),
            } as Partial<SessionMeta>);
          })
        );
        log('[session-archive] archived child sessions', { sessionId, childIds });
      }

      // Child sessions share parent's worktree — skip machine queue
      if (sessionMeta?.parentSessionId) {
        log('[session-archive] child session, skip machine queue', { sessionId });
        return;
      }

      const machineId = sessionMeta?.machineId;
      if (!machineId) {
        log('[session-archive] missing machineId, skip queue', { sessionId });
        return;
      }

      const requestedAt = getServerNow();
      await writeMachineFlockRowBestEffort(
        runtime,
        machineId,
        {
          key: machineFlockKeys.archiveSessionCommand(sessionId),
          value: buildMachineArchiveSessionCommand({ requestedAt }),
        },
        'archiveSession'
      );
      const machineRoomId = getMachineRoomId(machineId);
      const machineMeta = (await runtime.repo.getDocMeta(machineRoomId))?.meta as
        | MachineLegacyMetaFields
        | undefined;
      await runtime.writer.upsertDocMeta(machineRoomId, {
        needToArchiveSessions: {
          ...(machineMeta?.needToArchiveSessions ?? {}),
          [sessionId]: true,
        },
      } as unknown as RepoDocMetaPatch);
      log('[session-archive] archive queued on machine Flock doc', { sessionId, machineId });
    },
    [runtime, getChildSessionIds]
  );

  const restoreSession = useCallback(
    async (sessionId: SessionId) => {
      log('[session-restore] start', { sessionId });
      if (!runtime) {
        throw new Error('Runtime not ready');
      }

      const sessionRoomId = getSessionRoomId(sessionId);
      await runtime.writer.upsertDocMeta(sessionRoomId, {
        isArchived: false,
      } as Partial<SessionMeta>);
      log('[session-restore] session meta restored', { sessionId });

      // Cascade: restore all child sessions first (before any early returns)
      const childIds = getChildSessionIds(sessionId);
      if (childIds.length > 0) {
        await Promise.all(
          childIds.map(async (childId) => {
            const childRoomId = getSessionRoomId(childId);
            await runtime.writer.upsertDocMeta(childRoomId, {
              isArchived: false,
            } as Partial<SessionMeta>);
          })
        );
        log('[session-restore] restored child sessions', { sessionId, childIds });
      }

      // Remove from machine queues if present
      const sessionMeta = (await runtime.repo.getDocMeta(sessionRoomId))?.meta as
        | SessionMeta
        | undefined;
      const machineId = sessionMeta?.machineId;
      if (!machineId) {
        log('[session-restore] missing machineId, skip queue cleanup', { sessionId });
        return;
      }

      const machineRoomId = getMachineRoomId(machineId);
      const machineMeta = (await runtime.repo.getDocMeta(machineRoomId))?.meta as
        | MachineLegacyMetaFields
        | undefined;
      const needToArchiveSessions = machineMeta?.needToArchiveSessions ?? {};
      const needToDeleteSessions = machineMeta?.needToDeleteSessions ?? {};

      let nextNeedToArchiveSessions: typeof needToArchiveSessions | undefined;
      let nextNeedToDeleteSessions: typeof needToDeleteSessions | undefined;

      if (needToArchiveSessions[sessionId] !== undefined) {
        const { [sessionId]: _, ...rest } = needToArchiveSessions;
        nextNeedToArchiveSessions = rest;
      }

      if (needToDeleteSessions[sessionId] !== undefined) {
        const { [sessionId]: _, ...rest } = needToDeleteSessions;
        nextNeedToDeleteSessions = rest;
      }

      if (nextNeedToArchiveSessions !== undefined || nextNeedToDeleteSessions !== undefined) {
        await runtime.writer.upsertDocMeta(machineRoomId, {
          ...(nextNeedToArchiveSessions !== undefined
            ? { needToArchiveSessions: nextNeedToArchiveSessions }
            : {}),
          ...(nextNeedToDeleteSessions !== undefined
            ? { needToDeleteSessions: nextNeedToDeleteSessions }
            : {}),
        } as unknown as RepoDocMetaPatch);
      }

      await deleteMachineFlockRowsBestEffort(
        runtime,
        machineId,
        [
          machineFlockKeys.archiveSessionCommand(sessionId),
          machineFlockKeys.deleteSessionCommand(sessionId),
        ],
        'restoreSession'
      );

      if (nextNeedToArchiveSessions !== undefined) {
        log('[session-restore] removed from archive queue', { sessionId, machineId });
      }
      if (nextNeedToDeleteSessions !== undefined) {
        log('[session-restore] removed from delete queue', { sessionId, machineId });
      }
    },
    [runtime, getChildSessionIds]
  );

  const deleteArchivedSession = useCallback(
    async (sessionId: SessionId) => {
      log('[session-delete] start', { sessionId });
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const sessionRoomId = getSessionRoomId(sessionId);
      const sessionMeta = (await runtime.repo.getDocMeta(sessionRoomId))?.meta as
        | SessionMeta
        | undefined;

      // Cascade: delete all child sessions first (before any early returns)
      const childIds = getChildSessionIds(sessionId);
      if (childIds.length > 0) {
        await Promise.all(
          childIds.map(async (childId) => {
            await deleteSessionDocuments(childId);
          })
        );
        log('[session-delete] deleted child sessions', { sessionId, childIds });
      }

      const shouldQueueMachineCleanup =
        sessionMeta !== undefined && shouldQueueMachineDeleteSession(sessionMeta);

      // Sessions without machine-owned disk resources can be deleted directly.
      if (!shouldQueueMachineCleanup) {
        log('[session-delete] chat session, deleting directly', { sessionId });
        const machineId = sessionMeta?.machineId;
        if (machineId) {
          await cleanupMachineSessionCommandQueues(runtime, machineId, sessionId, 'deleteSession');
        }
        await deleteSessionDocuments(sessionId);
        log('[session-delete] chat session deleted', { sessionId });
        return;
      }

      // For code sessions, queue deletion on machine to clean up worktree/disk
      const machineId = sessionMeta?.machineId;
      if (machineId === undefined || machineId.length === 0) {
        log('[session-delete] missing machineId, deleting directly', { sessionId });
        await deleteSessionDocuments(sessionId);
        return;
      }

      const machineRoomId = getMachineRoomId(machineId);
      const machineMeta = (await runtime.repo.getDocMeta(machineRoomId))?.meta as
        | MachineLegacyMetaFields
        | undefined;
      const machineFlockHandle = await runtime.repo.openFlockDoc(
        getMachineFlockDocId(runtime.workspaceId, machineId)
      );
      const machineMetaForCleanup = {
        localProjects: {
          ...(machineMeta?.localProjects ?? {}),
          ...getMachineFlockLocalProjects(
            readMachineFlockRowsFromFlock(machineFlockHandle.flock, {
              families: ['localProject'],
            })
          ),
        },
      } satisfies Pick<MachineLegacyMetaFields, 'localProjects'>;
      const needToArchiveSessions = machineMeta?.needToArchiveSessions ?? {};
      const needToDeleteSessions = machineMeta?.needToDeleteSessions ?? {};
      const requestedAt = getServerNow();
      let nextNeedToArchiveSessions: typeof needToArchiveSessions | undefined;
      if (needToArchiveSessions[sessionId] !== undefined) {
        const { [sessionId]: _, ...rest } = needToArchiveSessions;
        nextNeedToArchiveSessions = rest;
      }

      const deleteAlreadyQueued = needToDeleteSessions[sessionId] !== undefined;
      const deleteCommand = buildMachineDeleteSessionCommand({
        session: sessionMeta,
        machineMeta: machineMetaForCleanup,
        requestedAt,
        existing: needToDeleteSessions[sessionId],
      });

      if (nextNeedToArchiveSessions !== undefined) {
        log('[session-delete] removed from archive queue', { sessionId, machineId });
      }
      if (deleteAlreadyQueued) {
        log('[session-delete] delete already queued', { sessionId, machineId });
      } else {
        log('[session-delete] delete queued on machine', { sessionId, machineId });
      }

      await deleteMachineFlockRowsBestEffort(
        runtime,
        machineId,
        [machineFlockKeys.archiveSessionCommand(sessionId)],
        'deleteSession'
      );
      const legacyDeletePatch =
        nextNeedToArchiveSessions !== undefined || deleteCommand
          ? {
              ...(nextNeedToArchiveSessions !== undefined
                ? { needToArchiveSessions: nextNeedToArchiveSessions }
                : {}),
              ...(deleteCommand
                ? {
                    needToDeleteSessions: {
                      ...needToDeleteSessions,
                      [sessionId]: machineDeleteCommandToQueueItem(deleteCommand),
                    },
                  }
                : {}),
            }
          : null;
      if (legacyDeletePatch) {
        await runtime.writer.upsertDocMeta(
          machineRoomId,
          legacyDeletePatch as unknown as RepoDocMetaPatch
        );
      }
      if (deleteCommand) {
        await writeMachineFlockRowRequired(runtime, machineId, {
          key: machineFlockKeys.deleteSessionCommand(sessionId),
          value: deleteCommand,
        });
      }

      // Optimistically delete the doc now; CLI will clean up worktree/disk later from the queue.
      await deleteSessionDocuments(sessionId, { cleanupLaunchConfig: false });
    },
    [runtime, getChildSessionIds, deleteSessionDocuments]
  );

  const setSessionPinned = useCallback(
    async (sessionId: SessionId, isPinned: boolean) => {
      if (!runtime) {
        throw new Error('Runtime not ready');
      }
      const roomId = getSessionRoomId(sessionId);
      const existing = await runtime.repo.getDocMeta(roomId);
      if (isLoroRepoDocDeleted(existing)) return;
      await runtime.writer.upsertDocMeta(roomId, {
        isPinned,
      } as Partial<SessionMeta>);
    },
    [runtime]
  );

  return {
    createSession,
    startSession,
    addSessionHistory,
    requestSessionDispatch,
    requestSessionCancel,
    requestSessionSteer,
    touchSessionActivity,
    updateSessionStatus,
    updateSessionTitle,
    transferSessionOwner,
    markSessionRead,
    deleteSessions,
    archiveSession,
    restoreSession,
    deleteArchivedSession,
    setSessionPinned,
  };
}
