import { useEffect } from 'react';
import { usePostHog } from '@posthog/react';
import {
  captureShortcutUsage,
  commands,
  createShortcutUsagePayload,
  type GlobalShortcutTriggeredPayload,
} from '@/lib/commands';

export function ShortcutAnalyticsTracker() {
  const postHog = usePostHog();

  useEffect(() => {
    commands.setShortcutAnalyticsHandler((payload) => {
      captureShortcutUsage(postHog, payload);
    });
    return () => {
      commands.setShortcutAnalyticsHandler(null);
    };
  }, [postHog]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.__LODY_ELECTRON__ !== true) {
      return undefined;
    }

    return window.api?.globalShortcuts?.onTriggered?.((payload: GlobalShortcutTriggeredPayload) => {
      captureShortcutUsage(
        postHog,
        createShortcutUsagePayload({
          commandId: payload.id,
          binding: payload.binding,
          source: 'global_shortcut',
          isUserOverride: payload.binding !== payload.defaultBinding,
        })
      );
    });
  }, [postHog]);

  return null;
}
