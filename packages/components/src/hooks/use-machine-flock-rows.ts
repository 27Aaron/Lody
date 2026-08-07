import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  getMachineFlockDocId,
  readMachineFlockRowsFromFlock,
  type MachineFlockEvent,
  type MachineFlockRowFamily,
  type MachineFlockRowMap,
  type MachineId,
  type ReadMachineFlockRowsOptions,
} from '@lody/shared';
import {
  applyMachineFlockRowEventsForMachineAtom,
  machineFlockRowsByWorkspaceAtom,
  setMachineFlockRowsForMachineAtom,
} from '@/atoms/machine-flock';
import { activeWorkspaceRuntimeAtom, type WorkspaceRuntime } from '@/atoms/runtime';
import { readinessBinding } from '@/lib/room-readiness';

type MachineFlockDocHandle = Awaited<ReturnType<WorkspaceRuntime['repo']['openFlockDoc']>>;
type MachineFlockRoomSubscription = Awaited<ReturnType<MachineFlockDocHandle['joinRoom']>>;

const EMPTY_MACHINE_FLOCK_ROWS = Object.freeze({}) as MachineFlockRowMap;

type MachineFlockRowsSyncEntry = {
  syncPromise: Promise<MachineFlockRowsSyncResult> | null;
};

type MachineFlockRowsSyncResult = {
  syncedRemote: boolean;
};

type MachineFlockRowsSnapshot = {
  rows: MachineFlockRowMap;
  mode?: 'replace' | 'merge';
  preserveExistingOnEmpty?: boolean;
  syncedRemote?: boolean;
};

type UseMachineFlockRowsOptions = {
  syncRemote?: boolean;
  remoteMachineIds?: readonly (MachineId | string)[];
  readLocal?: boolean;
  families?: readonly MachineFlockRowFamily[];
  remoteSyncDelayMs?: number;
};

export type MachineFlockRowsByMachineIdsState = {
  rowsByMachineId: ReadonlyMap<MachineId, MachineFlockRowMap>;
  remoteSyncedMachineIds: ReadonlySet<MachineId>;
};

type MachineFlockRemoteSyncRecord = {
  runtime: WorkspaceRuntime;
  store: MachineFlockRowsStore;
  workKey: string;
};

type MachineFlockRowsTask = {
  cancelled: boolean;
  cleanupFns: Set<() => void>;
  presenceAware: boolean;
  remoteEnabled: boolean;
  remoteScope: object;
  runtime: WorkspaceRuntime;
  store: MachineFlockRowsStore;
  workKey: string;
};

type MachineFlockRoomLease = {
  firstSyncedWithRemote: Promise<void>;
  release: () => void;
};

type SharedMachineFlockRoom = {
  refCount: number;
  subscription: MachineFlockRoomSubscription | null;
  subscriptionPromise: Promise<MachineFlockRoomSubscription>;
  firstSyncedWithRemote: Promise<void>;
  firstSyncSettled: boolean;
  freshCatchupPromise: Promise<void> | null;
  hasHadPresenceAwareLease: boolean;
  presenceAwareRefCount: number;
  presenceCatchupRequired: boolean;
  scopeByOwner: WeakMap<object, object>;
};

type MachineFlockRowsStore = ReturnType<typeof useStore>;

type SharedMachineFlockEvents = {
  refCountsByStore: Map<MachineFlockRowsStore, number>;
  unsubscribe: () => void;
};

// Which (machine, families) pairs this Jotai store has already read in full
// from the local Flock. The full read is an O(whole-flock) wasm scan, and once
// it has happened the shared subscription in `acquireMachineFlockEvents` keeps
// the atom current incrementally — so a LATER consumer mounting against the
// same store must not repeat it. Without this, every chat-surface mount
// re-scanned the machine Flock, i.e. once per session switch.
//
// The entry is dropped the moment this store stops receiving events for that
// machine (the only way its rows can silently go stale), so correctness rests
// on the release path in `acquireMachineFlockEvents`, not on a timer.
const MACHINE_FLOCK_LOCAL_READ_DONE = new WeakMap<
  MachineFlockRowsStore,
  Map<string, Set<string>>
>();

function hasFreshLocalMachineFlockRows(
  store: MachineFlockRowsStore,
  cacheKey: string,
  familiesKey: string
): boolean {
  return MACHINE_FLOCK_LOCAL_READ_DONE.get(store)?.get(cacheKey)?.has(familiesKey) ?? false;
}

function markLocalMachineFlockRowsFresh(
  store: MachineFlockRowsStore,
  cacheKey: string,
  familiesKey: string
): void {
  let byCacheKey = MACHINE_FLOCK_LOCAL_READ_DONE.get(store);
  if (!byCacheKey) {
    byCacheKey = new Map();
    MACHINE_FLOCK_LOCAL_READ_DONE.set(store, byCacheKey);
  }
  let families = byCacheKey.get(cacheKey);
  if (!families) {
    families = new Set();
    byCacheKey.set(cacheKey, families);
  }
  families.add(familiesKey);
}

function clearLocalMachineFlockRowsFresh(store: MachineFlockRowsStore, cacheKey: string): void {
  MACHINE_FLOCK_LOCAL_READ_DONE.get(store)?.delete(cacheKey);
}

const MACHINE_FLOCK_ROWS_SYNC_STATE = new Map<string, MachineFlockRowsSyncEntry>();
const SHARED_MACHINE_FLOCK_HANDLES = new WeakMap<
  object,
  Map<MachineId, Promise<MachineFlockDocHandle>>
>();
const SHARED_MACHINE_FLOCK_ROOMS = new WeakMap<
  WorkspaceRuntime,
  Map<MachineId, SharedMachineFlockRoom>
>();
const SHARED_MACHINE_FLOCK_EVENTS = new WeakMap<
  WorkspaceRuntime,
  Map<MachineId, SharedMachineFlockEvents>
>();
const EMPTY_MACHINE_IDS = new Set<MachineId>();
let machineFlockRowsPerfMeasureSeq = 0;

function getPerformanceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function recordMachineFlockRowsMeasure(label: string, startMs: number): void {
  const durationMs = getPerformanceNow() - startMs;
  if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
    try {
      performance.measure(`lody:${label}:${++machineFlockRowsPerfMeasureSeq}`, {
        start: startMs,
        duration: durationMs,
      });
    } catch {
      // Diagnostic-only mark; ignore unsupported performance APIs.
    }
  }
  if (durationMs >= 16) {
    console.debug(`[perf] ${label}`, { durationMs: Math.round(durationMs * 10) / 10 });
  }
}

function measureMachineFlockRowsSync<T>(label: string, fn: () => T): T {
  const startMs = getPerformanceNow();
  try {
    return fn();
  } finally {
    recordMachineFlockRowsMeasure(label, startMs);
  }
}

async function measureMachineFlockRowsAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startMs = getPerformanceNow();
  try {
    return await fn();
  } finally {
    recordMachineFlockRowsMeasure(label, startMs);
  }
}

// Mounted `useMachineFlockRowsByMachineIds` consumers register a listener per
// machine so an explicit re-sync can publish its fresh full snapshot alongside
// the live room's incremental Flock events.
type MachineFlockRowsListener = (snapshot: MachineFlockRowsSnapshot) => void;
const MACHINE_FLOCK_ROWS_LISTENERS = new Map<string, Set<MachineFlockRowsListener>>();

function subscribeMachineFlockRowsCache(
  cacheKey: string,
  listener: MachineFlockRowsListener
): () => void {
  let listeners = MACHINE_FLOCK_ROWS_LISTENERS.get(cacheKey);
  if (!listeners) {
    listeners = new Set();
    MACHINE_FLOCK_ROWS_LISTENERS.set(cacheKey, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = MACHINE_FLOCK_ROWS_LISTENERS.get(cacheKey);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      MACHINE_FLOCK_ROWS_LISTENERS.delete(cacheKey);
    }
  };
}

function notifyMachineFlockRowsCache(cacheKey: string, snapshot: MachineFlockRowsSnapshot): void {
  const listeners = MACHINE_FLOCK_ROWS_LISTENERS.get(cacheKey);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function getMachineFlockRowsCacheKey(workspaceId: string, machineId: MachineId): string {
  return `${workspaceId}\0${machineId}`;
}

function getMachineFlockRowsSyncEntry(cacheKey: string): MachineFlockRowsSyncEntry {
  let entry = MACHINE_FLOCK_ROWS_SYNC_STATE.get(cacheKey);
  if (!entry) {
    entry = {
      syncPromise: null,
    };
    MACHINE_FLOCK_ROWS_SYNC_STATE.set(cacheKey, entry);
  }
  return entry;
}

function normalizeMachineId(machineId: MachineId | string | null | undefined): MachineId | null {
  const trimmed = typeof machineId === 'string' ? machineId.trim() : '';
  return trimmed ? (trimmed as MachineId) : null;
}

function normalizeMachineIds(machineIds: readonly (MachineId | string)[]): MachineId[] {
  return Array.from(
    new Set(
      machineIds
        .map((machineId) => normalizeMachineId(machineId))
        .filter((machineId): machineId is MachineId => machineId !== null)
    )
  ).sort();
}

function normalizeMachineFlockRowFamilies(
  families: readonly MachineFlockRowFamily[] | undefined
): MachineFlockRowFamily[] {
  return Array.from(new Set(families ?? [])).sort();
}

function acquireMachineFlockRoom(
  runtime: WorkspaceRuntime,
  machineId: MachineId,
  owner: object,
  scope: object,
  presenceAware: boolean,
  joinRoom: () => Promise<MachineFlockRoomSubscription>,
  refreshRemote: () => Promise<void>
): MachineFlockRoomLease {
  let roomsByMachineId = SHARED_MACHINE_FLOCK_ROOMS.get(runtime);
  if (!roomsByMachineId) {
    roomsByMachineId = new Map();
    SHARED_MACHINE_FLOCK_ROOMS.set(runtime, roomsByMachineId);
  }

  let room = roomsByMachineId.get(machineId);
  const reusedRoom = room !== undefined;
  if (!room) {
    const subscriptionPromise = joinRoom();
    room = {
      refCount: 0,
      subscription: null,
      subscriptionPromise,
      firstSyncedWithRemote: subscriptionPromise.then(async (subscription) => {
        await readinessBinding(subscription).firstSyncedWithRemote;
      }),
      firstSyncSettled: false,
      freshCatchupPromise: null,
      hasHadPresenceAwareLease: false,
      presenceAwareRefCount: 0,
      presenceCatchupRequired: false,
      scopeByOwner: new WeakMap(),
    };
    roomsByMachineId.set(machineId, room);
    const createdRoom = room;
    void subscriptionPromise.then(
      (subscription) => {
        createdRoom.subscription = subscription;
        if (createdRoom.refCount === 0) {
          if (roomsByMachineId.get(machineId) === createdRoom) {
            roomsByMachineId.delete(machineId);
          }
          subscription.unsubscribe();
        }
      },
      () => {
        if (roomsByMachineId.get(machineId) === createdRoom) {
          roomsByMachineId.delete(machineId);
        }
      }
    );
    void room.firstSyncedWithRemote.then(
      () => {
        createdRoom.firstSyncSettled = true;
      },
      () => {
        createdRoom.firstSyncSettled = true;
      }
    );
  }

  const previousScope = room.scopeByOwner.get(owner);
  let needsFreshCatchup =
    previousScope !== undefined && previousScope !== scope && room.firstSyncSettled;
  room.scopeByOwner.set(owner, scope);
  if (presenceAware) {
    if (!room.hasHadPresenceAwareLease) {
      room.hasHadPresenceAwareLease = true;
      needsFreshCatchup ||= reusedRoom && room.firstSyncSettled;
    }
    needsFreshCatchup ||= room.presenceCatchupRequired && room.firstSyncSettled;
    room.presenceAwareRefCount += 1;
    room.presenceCatchupRequired = false;
  }
  if (needsFreshCatchup && !room.freshCatchupPromise) {
    const freshCatchupPromise = refreshRemote()
      .catch((error: unknown) => {
        if (room.presenceAwareRefCount > 0) {
          room.presenceCatchupRequired = true;
        }
        throw error;
      })
      .finally(() => {
        if (room.freshCatchupPromise === freshCatchupPromise) {
          room.freshCatchupPromise = null;
        }
      });
    room.freshCatchupPromise = freshCatchupPromise;
  }
  room.refCount += 1;
  let released = false;
  return {
    // A second consumer can enter after the first consumer has started a
    // catch-up and cleared `presenceCatchupRequired`. It must still wait for
    // that same in-flight generation instead of reusing the room's old ready
    // promise.
    firstSyncedWithRemote: room.freshCatchupPromise ?? room.firstSyncedWithRemote,
    release: () => {
      if (released) return;
      released = true;
      if (presenceAware) {
        room.presenceAwareRefCount -= 1;
        if (room.presenceAwareRefCount === 0) {
          room.presenceCatchupRequired = true;
        }
      }
      room.refCount -= 1;
      if (room.refCount > 0) return;
      if (room.subscription) {
        if (roomsByMachineId.get(machineId) === room) {
          roomsByMachineId.delete(machineId);
        }
        room.subscription.unsubscribe();
      }
    },
  };
}

function acquireMachineFlockEvents(
  runtime: WorkspaceRuntime,
  machineId: MachineId,
  handle: MachineFlockDocHandle,
  store: MachineFlockRowsStore
): () => void {
  let eventsByMachineId = SHARED_MACHINE_FLOCK_EVENTS.get(runtime);
  if (!eventsByMachineId) {
    eventsByMachineId = new Map();
    SHARED_MACHINE_FLOCK_EVENTS.set(runtime, eventsByMachineId);
  }

  let sharedEvents = eventsByMachineId.get(machineId);
  if (!sharedEvents) {
    const refCountsByStore = new Map<MachineFlockRowsStore, number>();
    sharedEvents = {
      refCountsByStore,
      unsubscribe: handle.flock.subscribe((batch) => {
        const events = (batch as { events?: MachineFlockEvent[] }).events ?? [];
        if (events.length === 0) return;
        for (const activeStore of refCountsByStore.keys()) {
          activeStore.set(applyMachineFlockRowEventsForMachineAtom, {
            workspaceId: runtime.workspaceId,
            machineId,
            events,
          });
        }
      }),
    };
    eventsByMachineId.set(machineId, sharedEvents);
  }

  sharedEvents.refCountsByStore.set(store, (sharedEvents.refCountsByStore.get(store) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const nextRefCount = (sharedEvents.refCountsByStore.get(store) ?? 1) - 1;
    if (nextRefCount > 0) {
      sharedEvents.refCountsByStore.set(store, nextRefCount);
      return;
    }
    sharedEvents.refCountsByStore.delete(store);
    // This store no longer receives incremental Flock events for the machine,
    // so its rows may drift; the next consumer must do a real local read.
    clearLocalMachineFlockRowsFresh(
      store,
      getMachineFlockRowsCacheKey(runtime.workspaceId, machineId)
    );
    if (sharedEvents.refCountsByStore.size > 0) return;
    if (eventsByMachineId.get(machineId) === sharedEvents) {
      eventsByMachineId.delete(machineId);
    }
    sharedEvents.unsubscribe();
  };
}

async function syncMachineFlockRowsOnce(
  cacheKey: string,
  handle: MachineFlockDocHandle,
  options: { force?: boolean } = {}
): Promise<MachineFlockRowsSyncResult> {
  const entry = getMachineFlockRowsSyncEntry(cacheKey);
  if (!options.force && entry.syncPromise) {
    return entry.syncPromise;
  }

  const syncPromise = measureMachineFlockRowsAsync('machine-flock:sync-once', async () => {
    // syncOnce resolves per-transport (loro-repo >=0.19). Selection, not
    // merging: `report.ok` is the AND over every attempted transport, so on a
    // dual-homed local machine doc a best-effort cloud failure would deny a
    // perfectly good local sync. Ask the cloud leg — the one that means
    // "reached a remote" — and treat a zero-transport (offline) report as
    // unconfirmed.
    const report = await handle.syncOnce();
    const cloud = report.transports.find((transport) => transport.transportId === 'cloud');
    return {
      syncedRemote: cloud ? cloud.ok : report.transports.length > 0 && report.ok,
    };
  })
    .catch(() => {
      return {
        syncedRemote: false,
      };
    })
    .finally(() => {
      if (entry.syncPromise === syncPromise) {
        entry.syncPromise = null;
      }
    });

  entry.syncPromise = syncPromise;
  return syncPromise;
}

async function openMachineFlockDoc(
  runtime: Pick<WorkspaceRuntime, 'repo' | 'workspaceId'>,
  machineId: MachineId
): Promise<MachineFlockDocHandle> {
  let handlesByMachineId = SHARED_MACHINE_FLOCK_HANDLES.get(runtime);
  if (!handlesByMachineId) {
    handlesByMachineId = new Map();
    SHARED_MACHINE_FLOCK_HANDLES.set(runtime, handlesByMachineId);
  }

  let handlePromise = handlesByMachineId.get(machineId);
  if (!handlePromise) {
    handlePromise = measureMachineFlockRowsAsync('machine-flock:open-doc', () =>
      runtime.repo.openFlockDoc(getMachineFlockDocId(runtime.workspaceId, machineId))
    );
    handlesByMachineId.set(machineId, handlePromise);
  }

  try {
    return await handlePromise;
  } catch (error) {
    if (handlesByMachineId.get(machineId) === handlePromise) {
      handlesByMachineId.delete(machineId);
    }
    throw error;
  }
}

function readMachineFlockRowsSnapshot(
  handle: MachineFlockDocHandle,
  readOptions: ReadMachineFlockRowsOptions | undefined,
  reason: 'local' | 'remote' | 'resync'
): MachineFlockRowMap {
  return measureMachineFlockRowsSync(`machine-flock:read-${reason}`, () =>
    readMachineFlockRowsFromFlock(handle.flock, readOptions)
  );
}

/**
 * Force a fresh remote sync of a single machine's flock doc and push the result
 * into any mounted `useMachineFlockRowsByMachineIds` consumers.
 *
 * The mounted hook normally keeps a live room joined. This remains the explicit
 * catch-up path after an acknowledged mutation, and also serves callers that do
 * not currently have a mounted Machine Flock consumer.
 *
 * A failed remote sync is not an error by default: the local rows were still
 * refreshed, and callers that resync after an already-acknowledged mutation
 * (settings, onboarding) must not report their own success as a failure. Pass
 * `requireRemoteSync` when the caller retries on a stale read.
 */
export async function resyncMachineFlockRows(
  runtime: Pick<WorkspaceRuntime, 'repo' | 'workspaceId'> | null | undefined,
  machineId: MachineId | string | null | undefined,
  options: { requireRemoteSync?: boolean } = {}
): Promise<void> {
  const normalizedMachineId = normalizeMachineId(machineId);
  if (!runtime || !normalizedMachineId) return;
  const cacheKey = getMachineFlockRowsCacheKey(runtime.workspaceId, normalizedMachineId);
  const handle = await openMachineFlockDoc(runtime, normalizedMachineId);
  const syncResult = await syncMachineFlockRowsOnce(cacheKey, handle, { force: true });
  notifyMachineFlockRowsCache(cacheKey, {
    rows: readMachineFlockRowsSnapshot(handle, undefined, 'resync'),
    mode: 'merge',
    preserveExistingOnEmpty: true,
    syncedRemote: syncResult.syncedRemote,
  });
  if (options.requireRemoteSync && !syncResult.syncedRemote) {
    throw new Error(`Failed to sync Machine Flock rows for ${normalizedMachineId}`);
  }
}

export function useMachineFlockRows(
  machineId: MachineId | string | null | undefined,
  options: UseMachineFlockRowsOptions = {}
): MachineFlockRowMap {
  const normalizedMachineId = useMemo(() => normalizeMachineId(machineId), [machineId]);
  const machineIds = useMemo(
    () => (normalizedMachineId ? [normalizedMachineId] : []),
    [normalizedMachineId]
  );
  const rowsByMachineId = useMachineFlockRowsByMachineIds(machineIds, options);
  return normalizedMachineId
    ? (rowsByMachineId.get(normalizedMachineId) ?? EMPTY_MACHINE_FLOCK_ROWS)
    : EMPTY_MACHINE_FLOCK_ROWS;
}

export function useMachineFlockRowsByMachineIds(
  machineIds: readonly (MachineId | string)[],
  options: UseMachineFlockRowsOptions = {}
): ReadonlyMap<MachineId, MachineFlockRowMap> {
  return useMachineFlockRowsByMachineIdsState(machineIds, options).rowsByMachineId;
}

export function useMachineFlockRowsByMachineIdsState(
  machineIds: readonly (MachineId | string)[],
  options: UseMachineFlockRowsOptions = {}
): MachineFlockRowsByMachineIdsState {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const machineFlockRowsStore = useStore();
  const machineFlockRowsByWorkspace = useAtomValue(machineFlockRowsByWorkspaceAtom);
  const setMachineFlockRowsForMachine = useSetAtom(setMachineFlockRowsForMachineAtom);
  const syncRemote = options.syncRemote ?? true;
  const readLocal = options.readLocal ?? true;
  const remoteSyncDelayMs = Math.max(0, options.remoteSyncDelayMs ?? 0);
  const familiesKey = useMemo(
    () => normalizeMachineFlockRowFamilies(options.families).join('\0'),
    [options.families]
  );
  const readOptions = useMemo<ReadMachineFlockRowsOptions | undefined>(
    () =>
      familiesKey ? { families: familiesKey.split('\0') as MachineFlockRowFamily[] } : undefined,
    [familiesKey]
  );
  const normalizedMachineIdsKey = useMemo(
    () => normalizeMachineIds(machineIds).join('\0'),
    [machineIds]
  );
  const normalizedMachineIds = useMemo(
    () => (normalizedMachineIdsKey ? (normalizedMachineIdsKey.split('\0') as MachineId[]) : []),
    [normalizedMachineIdsKey]
  );
  const normalizedRemoteMachineIdsKey = useMemo(
    () =>
      options.remoteMachineIds === undefined
        ? '*'
        : normalizeMachineIds(options.remoteMachineIds).join('\0'),
    [options.remoteMachineIds]
  );
  const normalizedRemoteMachineIds = useMemo(
    () =>
      normalizedRemoteMachineIdsKey === '*'
        ? null
        : new Set(
            normalizedRemoteMachineIdsKey
              ? (normalizedRemoteMachineIdsKey.split('\0') as MachineId[])
              : []
          ),
    [normalizedRemoteMachineIdsKey]
  );
  const remoteSyncOwner = useMemo(() => ({}), []);
  const activeTasksRef = useRef(new Map<MachineId, MachineFlockRowsTask>());
  const [remoteSyncState, setRemoteSyncState] = useState<
    ReadonlyMap<MachineId, MachineFlockRemoteSyncRecord>
  >(() => new Map());
  useEffect(() => {
    const activeTasks = activeTasksRef.current;
    const stopTask = (task: MachineFlockRowsTask): void => {
      if (task.cancelled) return;
      task.cancelled = true;
      for (const cleanup of task.cleanupFns) {
        cleanup();
      }
      task.cleanupFns.clear();
    };
    const clearRemoteSynced = (machineId: MachineId): void => {
      setRemoteSyncState((previous) => {
        if (!previous.has(machineId)) return previous;
        const next = new Map(previous);
        next.delete(machineId);
        return next;
      });
    };

    const desiredMachineIds = new Set(normalizedMachineIds);
    for (const [machineId, task] of activeTasks) {
      if (runtime && desiredMachineIds.has(machineId)) continue;
      stopTask(task);
      activeTasks.delete(machineId);
      clearRemoteSynced(machineId);
    }

    if (!runtime) return;

    for (const machineId of normalizedMachineIds) {
      const remoteEnabled = syncRemote && (normalizedRemoteMachineIds?.has(machineId) ?? true);
      const presenceAware = normalizedRemoteMachineIds !== null;
      const workKey = `${familiesKey}\0${readLocal ? 'read-local' : 'skip-local'}\0${remoteEnabled ? 'remote' : 'local'}\0${presenceAware ? 'presence-aware' : 'unscoped'}\0${remoteSyncDelayMs}`;
      const previousTask = activeTasks.get(machineId);
      if (
        previousTask?.runtime === runtime &&
        previousTask.store === machineFlockRowsStore &&
        previousTask.workKey === workKey &&
        !previousTask.cancelled
      ) {
        continue;
      }

      const remoteScope =
        previousTask?.runtime === runtime &&
        previousTask.remoteEnabled === remoteEnabled &&
        previousTask.presenceAware === presenceAware
          ? previousTask.remoteScope
          : {};
      if (previousTask) {
        stopTask(previousTask);
      }
      clearRemoteSynced(machineId);

      const task: MachineFlockRowsTask = {
        cancelled: false,
        cleanupFns: new Set(),
        presenceAware,
        remoteEnabled,
        remoteScope,
        runtime,
        store: machineFlockRowsStore,
        workKey,
      };
      activeTasks.set(machineId, task);

      const addCleanup = (cleanup: () => void): void => {
        if (task.cancelled) {
          cleanup();
          return;
        }
        task.cleanupFns.add(cleanup);
      };
      const isCurrent = (): boolean =>
        !task.cancelled && activeTasksRef.current.get(machineId) === task;
      const markRemoteSynced = (): void => {
        if (!isCurrent()) return;
        setRemoteSyncState((previous) => {
          const current = previous.get(machineId);
          if (
            current?.runtime === runtime &&
            current.store === machineFlockRowsStore &&
            current.workKey === workKey
          ) {
            return previous;
          }
          const next = new Map(previous);
          next.set(machineId, { runtime, store: machineFlockRowsStore, workKey });
          return next;
        });
      };
      const publishSnapshot = (snapshot: MachineFlockRowsSnapshot): void => {
        if (!isCurrent()) return;
        setMachineFlockRowsForMachine({
          workspaceId: runtime.workspaceId,
          machineId,
          rows: snapshot.rows,
          mode: snapshot.mode,
          preserveExistingOnEmpty: snapshot.preserveExistingOnEmpty,
        });
        if (snapshot.syncedRemote) {
          markRemoteSynced();
        }
      };

      void (async () => {
        const cacheKey = getMachineFlockRowsCacheKey(runtime.workspaceId, machineId);
        addCleanup(subscribeMachineFlockRowsCache(cacheKey, publishSnapshot));

        const handle = await openMachineFlockDoc(runtime, machineId);
        if (!isCurrent()) return;

        // Skipping the read is only safe because the subscription acquired
        // immediately below has been alive continuously since the read that set
        // this marker — the read and the subscribe are adjacent synchronous
        // statements, so no event can land between them.
        if (
          readLocal &&
          !hasFreshLocalMachineFlockRows(machineFlockRowsStore, cacheKey, familiesKey)
        ) {
          publishSnapshot({
            rows: readMachineFlockRowsSnapshot(handle, readOptions, 'local'),
            mode: 'merge',
            preserveExistingOnEmpty: true,
          });
        }
        addCleanup(acquireMachineFlockEvents(runtime, machineId, handle, machineFlockRowsStore));
        // Only after the subscription is held: a cancelled task already ran its
        // cleanup above, which cleared the marker, and re-setting it here would
        // leave the store claiming freshness it no longer receives events for.
        if (!isCurrent()) return;
        if (readLocal) {
          markLocalMachineFlockRowsFresh(machineFlockRowsStore, cacheKey, familiesKey);
        }

        if (!remoteEnabled) return;
        let remoteSyncTimer: ReturnType<typeof setTimeout> | null = null;
        addCleanup(() => {
          if (remoteSyncTimer !== null) {
            clearTimeout(remoteSyncTimer);
          }
        });
        const runRemoteSync = (): void => {
          remoteSyncTimer = null;
          if (!isCurrent()) return;
          void (async () => {
            const roomLease = acquireMachineFlockRoom(
              runtime,
              machineId,
              remoteSyncOwner,
              remoteScope,
              presenceAware,
              () => handle.joinRoom(),
              async () => {
                const result = await syncMachineFlockRowsOnce(cacheKey, handle);
                if (!result.syncedRemote) {
                  throw new Error(`Failed to sync Machine Flock rows for ${machineId}`);
                }
              }
            );
            addCleanup(roomLease.release);
            if (!isCurrent()) return;
            // Dual-homed rooms reject the merged `firstSyncedWithRemote`;
            // readiness is the selected binding's first sync.
            await roomLease.firstSyncedWithRemote;
            publishSnapshot({
              rows: readMachineFlockRowsSnapshot(handle, readOptions, 'remote'),
              mode: 'merge',
              preserveExistingOnEmpty: true,
              syncedRemote: true,
            });
          })().catch(() => undefined);
        };
        if (remoteSyncDelayMs > 0) {
          remoteSyncTimer = setTimeout(runRemoteSync, remoteSyncDelayMs);
        } else {
          runRemoteSync();
        }
      })().catch(() => {
        // Keep the last known shared rows on transient open/read failures.
        // Explicit flock events and local writes are still allowed to delete rows.
        if (!isCurrent()) return;
        stopTask(task);
        activeTasks.delete(machineId);
        clearRemoteSynced(machineId);
      });
    }
  }, [
    familiesKey,
    machineFlockRowsStore,
    normalizedMachineIds,
    normalizedRemoteMachineIds,
    readLocal,
    readOptions,
    remoteSyncDelayMs,
    remoteSyncOwner,
    runtime,
    setMachineFlockRowsForMachine,
    syncRemote,
  ]);
  useEffect(
    () => () => {
      for (const task of activeTasksRef.current.values()) {
        task.cancelled = true;
        for (const cleanup of task.cleanupFns) {
          cleanup();
        }
      }
      activeTasksRef.current.clear();
    },
    []
  );

  const rowsByMachineId = useMemo(() => {
    const rowsByMachine = new Map<MachineId, MachineFlockRowMap>();
    if (!runtime) return rowsByMachine;
    const workspaceRows = machineFlockRowsByWorkspace[String(runtime.workspaceId)] ?? {};
    for (const machineId of normalizedMachineIds) {
      rowsByMachine.set(machineId, workspaceRows[String(machineId)] ?? EMPTY_MACHINE_FLOCK_ROWS);
    }
    return rowsByMachine;
  }, [machineFlockRowsByWorkspace, normalizedMachineIds, runtime]);
  const remoteSyncedMachineIds = useMemo(() => {
    if (!runtime) return EMPTY_MACHINE_IDS;
    const synced = new Set<MachineId>();
    const presenceAware = normalizedRemoteMachineIds !== null;
    for (const machineId of normalizedMachineIds) {
      const remoteEnabled = syncRemote && (normalizedRemoteMachineIds?.has(machineId) ?? true);
      if (!remoteEnabled) continue;
      const workKey = `${familiesKey}\0${readLocal ? 'read-local' : 'skip-local'}\0remote\0${presenceAware ? 'presence-aware' : 'unscoped'}\0${remoteSyncDelayMs}`;
      const record = remoteSyncState.get(machineId);
      if (
        record?.runtime === runtime &&
        record.store === machineFlockRowsStore &&
        record.workKey === workKey
      ) {
        synced.add(machineId);
      }
    }
    return synced.size > 0 ? synced : EMPTY_MACHINE_IDS;
  }, [
    familiesKey,
    machineFlockRowsStore,
    normalizedMachineIds,
    normalizedRemoteMachineIds,
    readLocal,
    remoteSyncDelayMs,
    remoteSyncState,
    runtime,
    syncRemote,
  ]);

  return useMemo(
    () => ({ rowsByMachineId, remoteSyncedMachineIds }),
    [remoteSyncedMachineIds, rowsByMachineId]
  );
}
