import { useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { sessionListAtom } from '@/atoms/doc-meta';
import { userAtom, currentWorkspaceIdAtom } from '@/atoms';
import { lodyPresenceNowMsAtom, lodyPresenceStatesAtom } from '@/atoms/presence';
import { isElectronRenderer } from '@/lib/electron';
import { findFreshSessionPresenceState } from '@lody/shared';

type WindowBadge = { unread: number; waiting: number };

type ElectronBadgeBridge = {
  setWindowBadge?: (badge: WindowBadge) => void;
};

function getElectronBridge(): ElectronBadgeBridge | null {
  if (!isElectronRenderer()) return null;
  const candidate: unknown = (window as { api?: unknown }).api;
  if (!candidate || typeof candidate !== 'object') return null;
  const setWindowBadge = (candidate as { setWindowBadge?: unknown }).setWindowBadge;
  return typeof setWindowBadge === 'function'
    ? (candidate as ElectronBadgeBridge)
    : null;
}

const DEBOUNCE_MS = 150;
const ZERO: WindowBadge = { unread: 0, waiting: 0 };

/**
 * Compute the OS dock/taskbar badge for *this window*: how many sessions in
 * the current workspace, owned by the current user, are unread or
 * waiting-on-permission. Pushed to the Electron main process, which sums the
 * contributions across all windows and writes the OS badge.
 *
 * On the web there is no OS badge, so this hook is a no-op there. The
 * per-tab favicon is driven separately by `useTabStatus`.
 *
 * Mount once per authenticated workspace layout.
 */
export function useWorkspaceBadge(): void {
  const sessions = useAtomValue(sessionListAtom);
  const presenceStates = useAtomValue(lodyPresenceStatesAtom);
  const presenceNowMs = useAtomValue(lodyPresenceNowMsAtom);
  const user = useAtomValue(userAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const userId = user?.id ?? null;

  const badge = useMemo<WindowBadge>(() => {
    if (!userId || !currentWorkspaceId) return ZERO;
    let unread = 0;
    let waiting = 0;
    for (const session of sessions) {
      if (session.userId !== userId) continue;
      const liveStatus = findFreshSessionPresenceState(presenceStates, session.id, presenceNowMs)
        ?.status;
      if (liveStatus?.type === 'requestPermission') {
        waiting += 1;
        continue;
      }
      const lastMessageAt =
        typeof session.lastMessageAt === 'number' ? session.lastMessageAt : null;
      const lastReadAt =
        typeof session.lastReadAt === 'number' ? session.lastReadAt : null;
      if (lastMessageAt !== null && (lastReadAt === null || lastMessageAt > lastReadAt)) {
        unread += 1;
      }
    }
    return { unread, waiting };
  }, [sessions, presenceNowMs, presenceStates, userId, currentWorkspaceId]);

  const { unread, waiting } = badge;
  useEffect(() => {
    const bridge = getElectronBridge();
    if (!bridge) return undefined;

    const handle = window.setTimeout(() => {
      bridge.setWindowBadge?.({ unread, waiting });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [unread, waiting]);

  // Clear our contribution when the hook unmounts (workspace switch / logout).
  useEffect(() => {
    return () => {
      getElectronBridge()?.setWindowBadge?.(ZERO);
    };
  }, []);
}
