import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VListHandle } from 'virtua';
import type { SessionId } from '@lody/shared';
import {
  getScrollBottomPaddingOffset,
  getStickyScrollMetrics,
  resolveVListScrollElement,
  scrollViewportToRealBottom,
} from './sticky-scroll-dom';
import {
  getInitialStickyScrollState,
  PROGRAMMATIC_SCROLL_BASELINE,
  reduceStickyScrollState,
} from './sticky-scroll-state';
import { getScrollPosition, saveScrollPosition } from './use-scroll-position-cache';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UseStickyScrollOptions {
  sessionId: SessionId;
  vlistRef: RefObject<VListHandle | null>;
  /** Root element for scoped DOM fallback when Virtua internals are unavailable. */
  scrollRootRef: RefObject<HTMLElement | null>;
  /** Total number of items in the list. Used as the scroll-to target index. */
  itemCount: number;
  /**
   * Serialized key that changes whenever the list's visual content changes
   * (e.g. new items, activity indicator toggle). When this changes and isSticky
   * is true, auto-scrolls to bottom.
   */
  contentChangeKey: string | number;
  /** CSS class on the VList scroll container, used as fallback for DOM access. */
  scrollContainerClass: string;
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * When true, suppresses automatic scroll-to-bottom behavior (e.g. during
   * search navigation so sticky-scroll does not fight the programmatic jump).
   */
  suppressAutoScrollRef?: React.RefObject<boolean>;
}

export interface UseStickyScrollResult {
  /** Whether the view is currently locked to the bottom. */
  isSticky: boolean;
  /** Force-scroll to bottom and re-enable sticky mode. */
  scrollToBottom: () => void;
  /** Pass to VList's onScroll prop. */
  handleScroll: (offset: number) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a programmatic scroll and reset the scroll-offset baseline so that
 * handleScroll doesn't misinterpret the resulting scroll event as "user
 * scrolled up".
 *
 * When lastOffsetRef is -1, handleScroll computes scrollDelta = 0 (neutral)
 * for the very first scroll event that follows. This means:
 * - The programmatic scroll event itself is ignored (delta = 0).
 * - A real user scroll arriving as the *next* event is detected normally,
 *   because lastOffsetRef will have been updated to a valid value by then.
 *
 * Contrast with the old boolean-flag approach which suppressed ALL scroll
 * events for an entire animation frame, swallowing user input during streaming.
 */
function runProgrammaticScroll(
  lastOffsetRef: React.MutableRefObject<number>,
  fn: () => void
): void {
  fn();
  lastOffsetRef.current = PROGRAMMATIC_SCROLL_BASELINE;
}

/* Derive "is the message viewport shrinking?" from the keyboard resize
   event that drives a timed CSS transition over the message area.
   Module-scope so their identity is stable across renders (passing an
   inline arrow would re-subscribe the pump effect every render). */
function keyboardEventIsShrinking(event: Event): boolean {
  const height = (event as CustomEvent<{ height: number }>).detail?.height ?? 0;
  /* height > 0 → keyboard opening → viewport shrinks. */
  return height > 0;
}

/* The terminal dock opening shrinks the chat viewport (it rises as a flex
   sibling below); closing grows it back. */
function terminalDockEventIsShrinking(event: Event): boolean {
  return (event as CustomEvent<{ open: boolean }>).detail?.open === true;
}

/**
 * Pump `scrollToRealBottom` on every animation frame for the duration
 * of a CSS-driven viewport resize, so the messages track a *shrinking*
 * viewport smoothly instead of lagging a frame behind the one-shot
 * ResizeObserver scroll (which tears / jitters during a 250–300ms
 * transition).
 *
 * Used for native soft-keyboard open (`lody:keyboard-resize`), which
 * shrinks the message viewport via a timed CSS transition.
 *
 * Only pumps while sticky-at-bottom with items present. A *growing*
 * viewport (keyboard closing / chrome hiding) just needs a single
 * scroll: the list grows downward and the bottom stays put, so
 * per-frame pumping would be wasted work.
 */
function usePumpStickyScrollDuringResize(options: {
  eventName: string;
  isShrinking: (event: Event) => boolean;
  /** Pump duration; should be ≥ the CSS transition it tracks. */
  durationMs: number;
  stickyBottomRef: React.MutableRefObject<boolean>;
  itemCountRef: React.MutableRefObject<number>;
  lastScrollOffsetRef: React.MutableRefObject<number>;
  scrollToRealBottom: () => void;
  suppressAutoScrollRef?: React.RefObject<boolean>;
}): void {
  const {
    eventName,
    isShrinking,
    durationMs,
    stickyBottomRef,
    itemCountRef,
    lastScrollOffsetRef,
    scrollToRealBottom,
    suppressAutoScrollRef,
  } = options;

  useEffect(() => {
    let rafId: number | null = null;
    let stopTimerId: ReturnType<typeof setTimeout> | null = null;

    const animateScrollToBottom = () => {
      runProgrammaticScroll(lastScrollOffsetRef, scrollToRealBottom);
      rafId = requestAnimationFrame(animateScrollToBottom);
    };

    const stopAnimation = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // One final scroll after the transition ends to land exactly at the bottom.
      runProgrammaticScroll(lastScrollOffsetRef, scrollToRealBottom);
    };

    const handler = (event: Event) => {
      if (!stickyBottomRef.current || itemCountRef.current <= 0) return;
      if (suppressAutoScrollRef?.current) return;

      // Cancel any in-flight animation from a previous event.
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stopTimerId !== null) clearTimeout(stopTimerId);

      if (isShrinking(event)) {
        // Viewport shrinking — animate for the duration of the CSS transition.
        rafId = requestAnimationFrame(animateScrollToBottom);
        stopTimerId = setTimeout(stopAnimation, durationMs);
      } else {
        // Viewport growing — single scroll is enough, the list grows downward.
        runProgrammaticScroll(lastScrollOffsetRef, scrollToRealBottom);
      }
    };

    window.addEventListener(eventName, handler);
    return () => {
      window.removeEventListener(eventName, handler);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stopTimerId !== null) clearTimeout(stopTimerId);
    };
  }, [
    eventName,
    isShrinking,
    durationMs,
    scrollToRealBottom,
    stickyBottomRef,
    itemCountRef,
    lastScrollOffsetRef,
    suppressAutoScrollRef,
  ]);
}

function useStickyBottomResizeObservers(options: {
  vlistRef: RefObject<VListHandle | null>;
  itemCountRef: React.MutableRefObject<number>;
  stickyBottomRef: React.MutableRefObject<boolean>;
  lastScrollOffsetRef: React.MutableRefObject<number>;
  resolveScrollElement: () => HTMLElement | null;
  suppressAutoScrollRef?: React.RefObject<boolean>;
}): void {
  const {
    vlistRef,
    itemCountRef,
    stickyBottomRef,
    lastScrollOffsetRef,
    resolveScrollElement,
    suppressAutoScrollRef,
  } = options;

  useEffect(() => {
    const vlist = vlistRef.current;
    if (!vlist) return undefined;

    const scrollElement = resolveScrollElement();
    if (!scrollElement) return undefined;

    const contentElement = scrollElement.firstElementChild;
    if (!contentElement) return undefined;

    let prevContentHeight = contentElement.getBoundingClientRect().height;
    let prevContainerWidth = scrollElement.getBoundingClientRect().width;
    let prevContainerHeight = scrollElement.getBoundingClientRect().height;
    let scrollRafId: number | null = null;

    const scheduleScrollToEnd = () => {
      if (scrollRafId !== null) return;
      if (suppressAutoScrollRef?.current) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        const currentVlist = vlistRef.current;
        const count = itemCountRef.current;
        if (currentVlist && count > 0) {
          runProgrammaticScroll(lastScrollOffsetRef, () => {
            scrollViewportToRealBottom({
              itemCount: count,
              vlist: currentVlist,
              scrollElement,
              bottomOffset: getScrollBottomPaddingOffset(scrollElement),
            });
          });
        }
      });
    };

    const contentObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        const delta = newHeight - prevContentHeight;
        prevContentHeight = newHeight;

        if (delta !== 0 && stickyBottomRef.current) {
          scheduleScrollToEnd();
        }
      }
    });

    const containerObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        const newHeight = entry.contentRect.height;
        if (newWidth !== prevContainerWidth || newHeight !== prevContainerHeight) {
          prevContainerWidth = newWidth;
          prevContainerHeight = newHeight;
          if (stickyBottomRef.current) {
            scheduleScrollToEnd();
          }
        }
      }
    });

    contentObserver.observe(contentElement);
    containerObserver.observe(scrollElement);
    return () => {
      contentObserver.disconnect();
      containerObserver.disconnect();
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
    };
  }, [
    itemCountRef,
    lastScrollOffsetRef,
    resolveScrollElement,
    stickyBottomRef,
    vlistRef,
    suppressAutoScrollRef,
  ]);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useStickyScroll({
  sessionId,
  vlistRef,
  scrollRootRef,
  itemCount,
  contentChangeKey,
  scrollContainerClass,
  onAtBottomChange,
  suppressAutoScrollRef,
}: UseStickyScrollOptions): UseStickyScrollResult {
  // ── State & refs ─────────────────────────────────────────────────────────

  const [stickyBottom, setStickyBottom] = useState(true);
  const scrollElementRef = useRef<HTMLElement | null>(null);

  // Ref mirror for use in ResizeObserver / effects without re-subscriptions.
  const stickyBottomRef = useRef(stickyBottom);
  useEffect(() => {
    stickyBottomRef.current = stickyBottom;
  }, [stickyBottom]);

  // Ref mirror for itemCount so ResizeObserver can access current value.
  const itemCountRef = useRef(itemCount);
  useEffect(() => {
    itemCountRef.current = itemCount;
  }, [itemCount]);

  // Track last scroll offset to detect scroll direction.
  // Set to -1 after programmatic scrolls so the next event computes delta=0.
  const lastScrollOffsetRef = useRef<number>(PROGRAMMATIC_SCROLL_BASELINE);

  // Whether initial scroll position has been restored from cache.
  const initialScrollRestoredRef = useRef(false);

  const resolveScrollElement = useCallback((): HTMLElement | null => {
    const currentVlist = vlistRef.current;
    if (!currentVlist) {
      return scrollElementRef.current;
    }

    const scrollElement = resolveVListScrollElement(
      currentVlist,
      scrollContainerClass,
      scrollRootRef.current
    );
    if (scrollElement) {
      scrollElementRef.current = scrollElement;
    }
    return scrollElement ?? scrollElementRef.current;
  }, [scrollContainerClass, scrollRootRef, vlistRef]);

  const scrollToRealBottom = useCallback(() => {
    const scrollElement = resolveScrollElement();
    scrollViewportToRealBottom({
      itemCount,
      vlist: vlistRef.current,
      scrollElement,
      bottomOffset: getScrollBottomPaddingOffset(scrollElement),
    });
  }, [itemCount, resolveScrollElement, vlistRef]);

  // ── Scroll position restoration ──────────────────────────────────────────

  // Restore cached sticky state on mount.
  useLayoutEffect(() => {
    const cachedPosition = getScrollPosition(sessionId);
    const nextStickyBottom = getInitialStickyScrollState(cachedPosition);
    setStickyBottom(nextStickyBottom);
    initialScrollRestoredRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore scroll position when VList and items are ready.
  useEffect(() => {
    if (initialScrollRestoredRef.current) return;
    if (itemCount === 0) return;

    const vlist = vlistRef.current;
    if (!vlist) return;

    const cachedState = getScrollPosition(sessionId);

    requestAnimationFrame(() => {
      const currentVlist = vlistRef.current;
      if (!currentVlist) return;

      if (!cachedState || cachedState.type === 'end') {
        scrollToRealBottom();
      } else {
        currentVlist.scrollTo(cachedState.scrollOffset);
      }
      lastScrollOffsetRef.current = resolveScrollElement()?.scrollTop ?? currentVlist.scrollOffset;
      initialScrollRestoredRef.current = true;
    });
  }, [resolveScrollElement, scrollToRealBottom, sessionId, itemCount, vlistRef]);

  // ── scrollToBottom ───────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    if (!stickyBottomRef.current) {
      stickyBottomRef.current = true;
      setStickyBottom(true);
    }
    saveScrollPosition(sessionId, { type: 'end' });
    if (itemCount > 0) {
      runProgrammaticScroll(lastScrollOffsetRef, scrollToRealBottom);
    }
  }, [sessionId, itemCount, scrollToRealBottom]);

  // ── handleScroll (Virtua onScroll callback) ──────────────────────────────

  const handleScroll = useCallback(
    (offset: number) => {
      const vlist = vlistRef.current;
      if (!vlist) return;

      const scrollElement = resolveScrollElement();
      const { scrollOffset, distanceFromBottom } = getStickyScrollMetrics({
        scrollElement,
        vlist,
        fallbackOffset: offset,
      });
      const lastScrollOffset = lastScrollOffsetRef.current;
      lastScrollOffsetRef.current = scrollOffset;
      const transition = reduceStickyScrollState({
        previousSticky: stickyBottomRef.current,
        distanceFromBottom,
        scrollOffset,
        lastScrollOffset,
      });

      if (transition.didStickyChange) {
        stickyBottomRef.current = transition.nextSticky;
        setStickyBottom(transition.nextSticky);
        onAtBottomChange?.(transition.nextSticky);
      }

      saveScrollPosition(sessionId, transition.cacheState);
    },
    [resolveScrollElement, sessionId, onAtBottomChange, vlistRef]
  );

  useStickyBottomResizeObservers({
    vlistRef,
    itemCountRef,
    stickyBottomRef,
    lastScrollOffsetRef,
    resolveScrollElement,
    suppressAutoScrollRef,
  });

  // ── Auto-scroll on content change ────────────────────────────────────────

  useEffect(() => {
    if (stickyBottomRef.current && itemCount > 0 && !suppressAutoScrollRef?.current) {
      runProgrammaticScroll(lastScrollOffsetRef, scrollToRealBottom);
    }
    // contentChangeKey encodes all triggers (items.length, agentActivity, etc.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentChangeKey, scrollToRealBottom, suppressAutoScrollRef]);

  // ── Native keyboard resize: scroll to bottom when keyboard opens ────────
  // The native mobile app dispatches 'lody:keyboard-resize' when the soft
  // keyboard shows/hides. If we're in sticky mode, pump scrollToBottom on
  // every animation frame for the duration of the root layout's 250ms CSS
  // padding transition so the messages track the shrinking viewport smoothly.
  usePumpStickyScrollDuringResize({
    eventName: 'lody:keyboard-resize',
    isShrinking: keyboardEventIsShrinking,
    durationMs: 260,
    stickyBottomRef,
    itemCountRef,
    lastScrollOffsetRef,
    scrollToRealBottom,
    suppressAutoScrollRef,
  });

  // Desktop terminal dock open/close resizes the chat viewport over a 200ms
  // height transition; pump scroll-to-bottom for its duration when sticky so the
  // latest messages track the shrinking viewport instead of getting covered.
  usePumpStickyScrollDuringResize({
    eventName: 'lody:terminal-dock-resize',
    isShrinking: terminalDockEventIsShrinking,
    durationMs: 240,
    stickyBottomRef,
    itemCountRef,
    lastScrollOffsetRef,
    scrollToRealBottom,
    suppressAutoScrollRef,
  });

  return { isSticky: stickyBottom, scrollToBottom, handleScroll };
}
