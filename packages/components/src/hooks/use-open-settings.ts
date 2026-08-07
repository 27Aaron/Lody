import { useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { currentWorkspaceSlugAtom, settingsActiveTabAtom, settingsDialogOpenAtom } from '@/atoms';
import { type SettingsTabId } from '@/components/settings/settings-tabs';
import { useIsMobile } from './use-mobile';

/**
 * Single entry point for opening settings from anywhere in the app.
 *
 * Desktop (non-mobile): settings is a modal overlay — open it by flipping the
 * `settingsDialogOpenAtom` and selecting a tab, without navigating away from the
 * current page (so the chat/workspace stays mounted behind the dialog).
 *
 * Mobile: settings stays a full-page route, so we navigate to the matching route,
 * exactly as before.
 */
export function useOpenSettings() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const setOpen = useSetAtom(settingsDialogOpenAtom);
  const setActiveTab = useSetAtom(settingsActiveTabAtom);

  const openSettings = useCallback(
    (tab?: SettingsTabId) => {
      if (!workspaceSlug) return;

      if (!isMobile) {
        if (tab) {
          setActiveTab(tab);
        }
        setOpen(true);
        return;
      }

      // Mobile: navigate to the matching full-page route. Each `to` is a literal so
      // the router can type-check params (mirrors the former route-based tab nav).
      const params = { workspaceName: workspaceSlug };
      switch (tab) {
        case 'account':
          void router.navigate({ to: '/$workspaceName/settings/account', params });
          return;
        case 'stats':
          void router.navigate({ to: '/$workspaceName/settings/stats', params });
          return;
        case 'projects':
          void router.navigate({ to: '/$workspaceName/settings/projects', params });
          return;
        case 'devices':
          void router.navigate({ to: '/$workspaceName/settings/devices', params });
          return;
        case 'agent-config':
          void router.navigate({ to: '/$workspaceName/settings/agent-config', params });
          return;
        case 'github':
          void router.navigate({ to: '/$workspaceName/settings/github', params });
          return;
        case 'keyboard-shortcuts':
          void router.navigate({ to: '/$workspaceName/settings/keyboard-shortcuts', params });
          return;
        case 'about':
          void router.navigate({ to: '/$workspaceName/settings/about', params });
          return;
        case 'general':
          void router.navigate({ to: '/$workspaceName/settings/general', params });
          return;
        case 'billing':
          void router.navigate({ to: '/$workspaceName/settings/billing', params });
          return;
        default:
          void router.navigate({ to: '/$workspaceName/settings', params });
      }
    },
    [isMobile, router, setActiveTab, setOpen, workspaceSlug]
  );

  const closeSettings = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  return { openSettings, closeSettings };
}
