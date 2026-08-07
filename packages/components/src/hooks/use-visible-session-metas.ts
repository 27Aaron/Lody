import { useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import type { MachineId, SessionMeta } from '@lody/shared';
import { userAtom } from '@/atoms';
import { allActiveSessionsAtom, archivedSessionListAtom, sessionListAtom } from '@/atoms/doc-meta';
import { filterSessionsByVisibility, type SessionListEntry } from '@/lib/session-visibility';
import { useVisibleLocalProjects } from './use-visible-local-projects';
import { useVisibleMachineMetas } from './use-visible-machine-metas';

function areSetsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

type VisibleSessionMetasResult = {
  sessions: SessionListEntry[];
  allActiveSessions: SessionMeta[];
  visibleMachineIds: Set<MachineId>;
  visibleLocalProjectKeys: Set<string>;
  isLoading: boolean;
};

type VisibleArchivedSessionMetasResult = {
  archivedSessions: SessionListEntry[];
  visibleMachineIds: Set<MachineId>;
  visibleLocalProjectKeys: Set<string>;
  isLoading: boolean;
};

export function useVisibleMachineIdSet(): {
  visibleMachineIds: Set<MachineId>;
  isLoading: boolean;
} {
  const { accessByMachineId, isLoading } = useVisibleMachineMetas({ includeMachineFlock: false });

  // `accessByMachineId` is a fresh Map on every Loro machine-meta tick even
  // when the key set is unchanged. Stabilize the Set reference by content so
  // downstream memos (e.g. filtered session lists) don't re-run on no-op
  // visibility updates.
  const prevRef = useRef<Set<MachineId>>(new Set());
  const visibleMachineIds = useMemo(() => {
    const next = new Set<MachineId>(accessByMachineId.keys());
    const prev = prevRef.current;
    if (areSetsEqual(prev, next)) return prev;
    prevRef.current = next;
    return next;
  }, [accessByMachineId]);

  return { visibleMachineIds, isLoading };
}

export function useVisibleLocalProjectKeySet(): {
  visibleLocalProjectKeys: Set<string>;
  isLoading: boolean;
} {
  const { accessByProjectKey, isLoading } = useVisibleLocalProjects({
    includeMachineFlock: false,
  });

  const prevRef = useRef<Set<string>>(new Set());
  const visibleLocalProjectKeys = useMemo(() => {
    const next = new Set<string>(accessByProjectKey.keys());
    const prev = prevRef.current;
    if (areSetsEqual(prev, next)) return prev;
    prevRef.current = next;
    return next;
  }, [accessByProjectKey]);

  return { visibleLocalProjectKeys, isLoading };
}

export function useVisibleSessionMetas(): VisibleSessionMetasResult {
  const sessions = useAtomValue(sessionListAtom);
  const allActiveSessions = useAtomValue(allActiveSessionsAtom);
  const { visibleMachineIds, isLoading: machineLoading } = useVisibleMachineIdSet();
  const { visibleLocalProjectKeys, isLoading: localProjectLoading } =
    useVisibleLocalProjectKeySet();
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const isLoading = machineLoading || localProjectLoading;

  const visibleSessions = useMemo(
    () =>
      filterSessionsByVisibility(
        sessions,
        visibleMachineIds,
        visibleLocalProjectKeys,
        machineLoading,
        currentUserId
      ),
    [currentUserId, machineLoading, sessions, visibleLocalProjectKeys, visibleMachineIds]
  );
  const visibleAllActiveSessions = useMemo(
    () =>
      filterSessionsByVisibility(
        allActiveSessions,
        visibleMachineIds,
        visibleLocalProjectKeys,
        machineLoading,
        currentUserId
      ),
    [allActiveSessions, currentUserId, machineLoading, visibleLocalProjectKeys, visibleMachineIds]
  );

  return {
    sessions: visibleSessions,
    allActiveSessions: visibleAllActiveSessions,
    visibleMachineIds,
    visibleLocalProjectKeys,
    isLoading,
  };
}

export function useVisibleArchivedSessionMetas(): VisibleArchivedSessionMetasResult {
  const archivedSessions = useAtomValue(archivedSessionListAtom);
  const { visibleMachineIds, isLoading: machineLoading } = useVisibleMachineIdSet();
  const { visibleLocalProjectKeys, isLoading: localProjectLoading } =
    useVisibleLocalProjectKeySet();
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const isLoading = machineLoading || localProjectLoading;

  const visibleArchivedSessions = useMemo(
    () =>
      filterSessionsByVisibility(
        archivedSessions,
        visibleMachineIds,
        visibleLocalProjectKeys,
        machineLoading,
        currentUserId
      ),
    [archivedSessions, currentUserId, machineLoading, visibleLocalProjectKeys, visibleMachineIds]
  );

  return {
    archivedSessions: visibleArchivedSessions,
    visibleMachineIds,
    visibleLocalProjectKeys,
    isLoading,
  };
}
