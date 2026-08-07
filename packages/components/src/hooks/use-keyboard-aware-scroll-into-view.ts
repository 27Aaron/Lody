import { useEffect, type RefObject } from 'react';

/**
 * Keeps the focused control inside a scroll container visible above the native
 * soft keyboard.
 *
 * On iOS Capacitor the WebView is NOT resized when the keyboard opens
 * (`resize: "none"` + `interactive-widget=overlaps-content`), so the browser's
 * default focus-scroll can leave the focused input — or the controls just below
 * it — hidden behind the keyboard. Sheets lift themselves via
 * `bottom-[var(--native-keyboard-height)]` and cap their scroll height to the
 * visible region; this hook then pulls the focused element to the CENTER of
 * that region. Centering (rather than `nearest`/`end`) is deliberate: it leaves
 * room below the focused field so a trailing cluster (e.g. the new-chat agent +
 * permission row that sits under the composer) also clears the keyboard.
 *
 * Fires on:
 *   - `lody:keyboard-resize` with height > 0 (keyboard opening), and
 *   - focus moving between fields while the keyboard is already up.
 *
 * Web is a no-op because the native shell does not dispatch this event there.
 * Android keeps `--native-keyboard-height` at `0px` because the WebView resizes, but
 * the native shell still dispatches `lody:keyboard-resize`; this hook may recenter
 * after that resize.
 *
 * Listeners are bound to `window` / `document` (not the container) and read
 * `containerRef.current` lazily at event time, so the hook works even when the
 * container mounts later (e.g. a drawer that only renders its content when open).
 */
export function useKeyboardAwareScrollIntoView(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scrollActiveIntoView = () => {
      const container = containerRef.current;
      const active = document.activeElement;
      if (!container || !(active instanceof HTMLElement) || !container.contains(active)) {
        return;
      }
      // Two rAFs so the keyboard var + the sheet/dialog height reflow land
      // before we measure; otherwise we would target stale container geometry.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (document.activeElement === active) {
            const containerRect = container.getBoundingClientRect();
            const activeRect = active.getBoundingClientRect();
            const targetTop =
              container.scrollTop +
              activeRect.top +
              activeRect.height / 2 -
              (containerRect.top + containerRect.height / 2);
            const maxScrollTop = container.scrollHeight - container.clientHeight;
            container.scrollTop = Math.max(0, Math.min(targetTop, maxScrollTop));
          }
        });
      });
    };

    const handleKeyboardResize = (event: Event) => {
      const detail = (event as CustomEvent<{ height?: number }>).detail;
      if ((detail?.height ?? 0) > 0) scrollActiveIntoView();
    };

    const handleFocusIn = () => {
      // Only act when the keyboard is already up; otherwise the keyboard-resize
      // event drives the scroll once it opens (focusin fires before the keyboard,
      // when the layout is still full-height).
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--native-keyboard-height')
        .trim();
      if (raw && parseFloat(raw) > 0) scrollActiveIntoView();
    };

    window.addEventListener('lody:keyboard-resize', handleKeyboardResize);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('lody:keyboard-resize', handleKeyboardResize);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [containerRef]);
}
