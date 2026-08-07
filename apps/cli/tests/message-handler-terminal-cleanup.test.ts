import { describe, expect, it, vi } from 'vitest';

import {
  getMachineRoomId,
  getSessionRoomId,
  machineFlockKeys,
  type MachineFlockScanRow,
  type NeedToDeleteSessionQueueItem,
  type AcpSessionNotification,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

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

type MessageHandlerInternals = {
  archiveSessionResources: (sessionId: SessionId) => Promise<void>;
  deleteSessionResources: (sessionId: SessionId) => Promise<{ keptWorktreePath?: string }>;
  writeKeptWorktreePath: (
    sessionId: SessionId,
    request: NeedToDeleteSessionQueueItem | undefined,
    keptWorktreePath: string
  ) => Promise<void>;
  enqueueACPUpdate: (sessionId: SessionId, update: AcpSessionNotification) => void;
  quiesceACPFlushForDeletion: (sessionId: SessionId) => Promise<void>;
  codeCollabV2PendingEvidenceWrites: Map<SessionId, Set<Promise<void>>>;
  codeCollabV2TurnDiffs: Map<string, unknown[]>;
  deletedSessionIds: Set<SessionId>;
  deleteInFlight: Set<SessionId>;
  store: {
    has: (sessionId: SessionId) => boolean;
    get: (sessionId: SessionId) => { acpFlushInFlight: Promise<void> | null };
  };
  previewService: {
    closeSessionPreviewForCleanup: (sessionId: SessionId, reason: string) => Promise<void>;
  };
};

function createHarness(options?: {
  sessionId?: SessionId;
  childSessionIds?: SessionId[];
  closeSessionTerminals?: (sessionId: SessionId) => void;
  machineFlockRows?: MachineFlockScanRow[];
}) {
  const sessionId = options?.sessionId ?? ('session-1' as SessionId);
  const childSessionIds = options?.childSessionIds ?? [];
  const machineId = 'machine-1';
  const sessionRoomId = getSessionRoomId(sessionId);
  const machineRoomId = getMachineRoomId(machineId);
  const machineFlockRows = [...(options?.machineFlockRows ?? [])];
  const flockSet = vi.fn((key: readonly unknown[], value: unknown) => {
    const rowIndex = machineFlockRows.findIndex(
      (row) => JSON.stringify(row.key) === JSON.stringify(key)
    );
    const nextRow = { key, value };
    if (rowIndex >= 0) {
      machineFlockRows[rowIndex] = nextRow;
    } else {
      machineFlockRows.push(nextRow);
    }
  });
  const flockCommit = vi.fn();
  const sessionDoc = {
    updateHistory: vi.fn(async (updater: (history: unknown[]) => unknown[]) => {
      updater([]);
    }),
    waitUntilSynced: vi.fn(async () => {}),
    setLastMessageAt: vi.fn(async () => {}),
  };
  const repo = {
    watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getDocMeta: vi.fn(async (roomId: string) => {
      if (roomId === sessionRoomId) {
        return { meta: { isArchived: true } };
      }
      if (roomId === machineRoomId) {
        return {
          meta: {
            needToArchiveSessions: {},
            needToDeleteSessions: { [sessionId]: true },
          },
        };
      }
      return { meta: {} };
    }),
    openFlockDoc: vi.fn(async () => ({
      flock: {
        scan: () => machineFlockRows,
        set: flockSet,
        delete: vi.fn(),
        commit: flockCommit,
      },
      syncOnce: vi.fn(async () => {}),
    })),
    upsertDocMeta: vi.fn(async () => {}),
    deleteDoc: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
  const workspaceDocument = {
    sessions: new Map<SessionId, unknown>(),
    repo,
    getOrCreateSessionDoc: vi.fn(async () => sessionDoc),
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
  };
  const sessionManager = {
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    getActiveChildSessionIds: vi.fn(() => childSessionIds),
    hasSession: vi.fn(() => false),
    terminateSession: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    cleanUp: vi.fn(async () => {}),
    setSessionError: vi.fn(async () => {}),
  };
  const closeSessionTerminals = options?.closeSessionTerminals ?? vi.fn();

  const handler = new MessageHandler(
    sessionManager as unknown as SessionManager,
    workspaceDocument as unknown as LoroDocumentManager,
    createSilentLogger(),
    {
      token: 'token',
      workspaceId: 'workspace-1' as WorkspaceId,
      userId: 'user-1',
      machineId,
      machineName: 'machine',
      cliVersion: '0.0.0',
      closeSessionTerminals,
      cloudPort: createTestCloudPort(),
    }
  );
  const internal = handler as unknown as MessageHandlerInternals;
  internal.previewService = {
    closeSessionPreviewForCleanup: vi.fn(async () => {}),
  };

  return {
    handler: internal,
    sessionId,
    childSessionIds,
    closeSessionTerminals,
    sessionManager,
    repo,
    flockSet,
    flockCommit,
  };
}

describe('MessageHandler terminal cleanup', () => {
  it('closes session terminals when archiving resources even without an active session', async () => {
    const { handler, sessionId, closeSessionTerminals, sessionManager } = createHarness();

    await handler.archiveSessionResources(sessionId);

    expect(closeSessionTerminals).toHaveBeenCalledWith(sessionId);
    expect(sessionManager.terminateSession).not.toHaveBeenCalled();
  });

  it('closes parent and active child terminals before permanent deletion cleanup', async () => {
    const childSessionId = 'child-1' as SessionId;
    const { handler, sessionId, closeSessionTerminals } = createHarness({
      childSessionIds: [childSessionId],
    });

    await handler.deleteSessionResources(sessionId);

    expect(closeSessionTerminals).toHaveBeenCalledWith(childSessionId);
    expect(closeSessionTerminals).toHaveBeenCalledWith(sessionId);
  });

  it('drops transient ACP retry state before deletion and rejects late output', async () => {
    const { handler, sessionId, repo } = createHarness();

    await handler.deleteSessionResources(sessionId);

    expect(repo.deleteDoc).toHaveBeenCalledWith(getSessionRoomId(sessionId));
    expect(handler.store.has(sessionId)).toBe(false);

    handler.enqueueACPUpdate(sessionId, {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'late output' },
      },
    });

    expect(handler.store.has(sessionId)).toBe(false);
  });

  it('keeps a failed session-doc deletion retryable', async () => {
    const { handler, sessionId, repo } = createHarness();
    await vi.waitFor(() => expect(handler.deleteInFlight.size).toBe(0));
    handler.deletedSessionIds.clear();
    repo.deleteDoc.mockClear();
    repo.deleteDoc.mockRejectedValueOnce(new Error('temporary delete failure'));

    await expect(handler.deleteSessionResources(sessionId)).rejects.toThrow(
      'temporary delete failure'
    );
    expect(handler.deletedSessionIds.has(sessionId)).toBe(false);
    const callsAfterFailure = repo.deleteDoc.mock.calls.length;

    await expect(handler.deleteSessionResources(sessionId)).resolves.toEqual({});
    expect(repo.deleteDoc.mock.calls.length).toBeGreaterThan(callsAfterFailure);
    expect(handler.deletedSessionIds.has(sessionId)).toBe(true);
  });

  it('waits for an in-flight ACP write before dropping deletion state', async () => {
    const { handler, sessionId } = createHarness();
    let releaseWrite: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    handler.store.get(sessionId).acpFlushInFlight = inFlight;
    let quiesced = false;

    const quiesce = handler.quiesceACPFlushForDeletion(sessionId).then(() => {
      quiesced = true;
    });
    await Promise.resolve();

    expect(quiesced).toBe(false);
    expect(handler.store.has(sessionId)).toBe(true);

    releaseWrite?.();
    await quiesce;

    expect(handler.store.has(sessionId)).toBe(false);
  });

  it('waits for an in-flight evidence collector before dropping deletion state', async () => {
    const { handler, sessionId } = createHarness();
    const key = `${sessionId}\0turn-delete`;
    let releaseCollector: (() => void) | undefined;
    let trackedCollector: Promise<void>;
    const pending = new Set<Promise<void>>();
    const collector = new Promise<void>((resolve) => {
      releaseCollector = () => {
        handler.codeCollabV2TurnDiffs.set(key, [{ path: 'a.txt', oldText: 'old', newText: 'new' }]);
        resolve();
      };
    });
    trackedCollector = collector.finally(() => {
      pending.delete(trackedCollector);
      if (pending.size === 0) {
        handler.codeCollabV2PendingEvidenceWrites.delete(sessionId);
      }
    });
    pending.add(trackedCollector);
    handler.codeCollabV2PendingEvidenceWrites.set(sessionId, pending);
    let quiesced = false;

    const quiesce = handler.quiesceACPFlushForDeletion(sessionId).then(() => {
      quiesced = true;
    });
    await Promise.resolve();

    expect(quiesced).toBe(false);

    releaseCollector?.();
    await quiesce;

    expect(handler.codeCollabV2TurnDiffs.has(key)).toBe(false);
    expect(handler.store.has(sessionId)).toBe(false);
  });

  it('preserves kept worktree path by creating a Flock command for legacy-only delete requests', async () => {
    const sessionId = 'session-legacy-delete' as SessionId;
    const { handler, flockSet, flockCommit, repo } = createHarness({ sessionId });
    const request = {
      branchName: 'lody/session-legacy-delete',
      baseBranchName: 'main',
      isWorktree: true,
      localProjectId: 'local-1',
      originalRootPath: '/repo/app',
      requestedAt: 123,
    } satisfies NeedToDeleteSessionQueueItem;

    await handler.writeKeptWorktreePath(sessionId, request, '/repo/app/.lody/worktrees/session');

    expect(flockSet).toHaveBeenCalledWith(
      machineFlockKeys.deleteSessionCommand(sessionId),
      {
        v: 1,
        branchName: 'lody/session-legacy-delete',
        baseBranchName: 'main',
        localProjectId: 'local-1',
        originalRootPath: '/repo/app',
        requestedAt: 123,
        keptWorktreePath: '/repo/app/.lody/worktrees/session',
        isWorktree: true,
      },
      expect.any(Number)
    );
    expect(flockCommit).toHaveBeenCalled();
    expect(repo.flush).toHaveBeenCalled();
  });
});
