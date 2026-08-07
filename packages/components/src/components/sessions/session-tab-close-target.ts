export type SessionTabFocusRegion = 'conversation' | 'side-panel';

export type SessionTabCloseTarget =
  | { kind: 'conversation'; tabId: string }
  | { kind: 'side-panel'; tabId: string };

export function getSessionTabCloseTarget({
  focusRegion,
  sidePanelOpen,
  activeSidePanelTabId,
  activeConversationTabId,
  parentConversationTabId,
}: {
  focusRegion: SessionTabFocusRegion;
  sidePanelOpen: boolean;
  activeSidePanelTabId: string | null;
  activeConversationTabId: string;
  parentConversationTabId: string;
}): SessionTabCloseTarget | null {
  if (focusRegion === 'side-panel' && sidePanelOpen) {
    return activeSidePanelTabId ? { kind: 'side-panel', tabId: activeSidePanelTabId } : null;
  }
  if (activeConversationTabId !== parentConversationTabId) {
    return { kind: 'conversation', tabId: activeConversationTabId };
  }
  return null;
}
