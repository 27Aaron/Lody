import { atom } from 'jotai';

/** Group key for the "Chats" (no-repo) sidebar group. */
export const ONLY_CHATS_KEY = '__only_chats__';

/**
 * Focus layer for keyboard navigation.
 *
 * L1 = sidebar list selection (arrow keys move highlight)
 * L2 = session browse (arrow keys scroll chat)
 * L3 = input mode (typing in composer)
 */
export type FocusLayer = 'L1' | 'L2' | 'L3';

/**
 * Represents a navigable item in the sidebar flat list.
 */
export type SidebarNavItem =
  | { kind: 'group-header'; groupKey: string; collapsed: boolean }
  | { kind: 'session'; sessionId: string; groupKey: string }
  | { kind: 'show-more'; groupKey: string; expanded: boolean }
  | { kind: 'local-project'; machineId: string; localProjectId: string; collapsed: boolean };

/**
 * Current keyboard focus layer. Default is L3 (input mode).
 */
export const focusLayerAtom = atom<FocusLayer>('L3');

/**
 * Index of the highlighted item in the sidebar flat list.
 * -1 means no item is highlighted.
 */
export const sidebarHighlightIndexAtom = atom<number>(-1);

/**
 * Flat list of navigable sidebar items, written by the sidebar and read by
 * the keyboard navigation handler.
 */
export const sidebarNavItemsAtom = atom<SidebarNavItem[]>([]);

/**
 * Callbacks from the sidebar for keyboard navigation actions.
 * Written by the sidebar component.
 */
export type SidebarNavCallbacks = {
  onNavigateToSession: (sessionId: string) => void;
  onNavigateToNewSession: (repoFullName?: string) => void;
  onToggleRepoCollapsed: (repoFullName: string) => void;
  onToggleChatsCollapsed: () => void;
  onToggleLocalProjectCollapsed?: (machineId: string, localProjectId: string) => void;
  getSelectedSessionId: () => string | null;
  getSessionGroupKey?: (sessionId: string) => string | null;
  isChatLanding: () => boolean;
};

export const sidebarNavCallbacksAtom = atom<SidebarNavCallbacks | null>(null);

/**
 * Per-group "show full list" toggle state, shared between SessionList and
 * keyboard navigation so the flat nav list stays in sync with the
 * rendered sidebar.
 */
export const sidebarShowFullListAtom = atom<Record<string, boolean>>({});
