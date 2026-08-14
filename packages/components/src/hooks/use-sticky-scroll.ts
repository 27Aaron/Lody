import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';
import type { VListHandle } from 'virtua';
import type { SessionId } from '@lody/shared';
import {
  getScrollBottomPaddingOffset,
  resolveVListScrollElement,
  scrollViewportToRealBottom,
} from './sticky-scroll-dom';
import { getScrollPosition, saveScrollPosition } from './use-scroll-position-cache';

export interface UseStickyScrollOptions {
  sessionId: SessionId;
  vlistRef: RefObject<VListHandle | null>;
  /** Root element for scoped DOM fallback when Virtua internals are unavailable. */
  scrollRootRef: RefObject<HTMLElement | null>;
  /** Total number of items in the list. Used as the scroll-to target index. */
  itemCount: number;
  /** CSS class on the VList scroll container, used as fallback for DOM access. */
  scrollContainerClass: string;
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * When true, releases follow-output before a programmatic jump or expansion
   * can resize the list underneath it.
   */
  suppressAutoScrollRef?: RefObject<boolean>;
}

export interface UseStickyScrollResult {
  /** Whether the view is currently locked to the bottom. */
  isSticky: boolean;
  /** Force-scroll to bottom and re-enable sticky mode. */
  scrollToBottom: () => void;
  /** Pass to VList's onScroll prop. */
  handleScroll: (offset: number) => void;
}

function keyboardEventIsShrinking(event: Event): boolean {
  const height = (event as CustomEvent<{ height: number }>).detail?.height ?? 0;
  return height > 0;
}

function terminalDockEventIsShrinking(event: Event): boolean {
  return (event as CustomEvent<{ open: boolean }>).detail?.open === true;
}

/**
 * A viewport can shrink over several animation frames while its content height
 * stays unchanged (native keyboard and terminal dock transitions). The
 * third-party hook intentionally observes the content element, so keep this
 * app-specific bridge for animated viewport resizes.
 */
function usePumpStickyScrollDuringResize(options: {
  eventName: string;
  isShrinking: (event: Event) => boolean;
  durationMs: number;
  stickyBottomRef: MutableRefObject<boolean>;
  itemCountRef: MutableRefObject<number>;
  scrollToRealBottom: () => void;
  suppressAutoScrollRef?: RefObject<boolean>;
}): void {
  const {
    eventName,
    isShrinking,
    durationMs,
    stickyBottomRef,
    itemCountRef,
    scrollToRealBottom,
    suppressAutoScrollRef,
  } = options;

  useEffect(() => {
    let rafId: number | null = null;
    let stopTimerId: ReturnType<typeof setTimeout> | null = null;

    const animateScrollToBottom = () => {
      scrollToRealBottom();
      rafId = requestAnimationFrame(animateScrollToBottom);
    };

    const stopAnimation = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      scrollToRealBottom();
    };

    const handler = (event: Event) => {
      if (!stickyBottomRef.current || itemCountRef.current <= 0) return;
      if (suppressAutoScrollRef?.current) return;

      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stopTimerId !== null) clearTimeout(stopTimerId);

      if (isShrinking(event)) {
        rafId = requestAnimationFrame(animateScrollToBottom);
        stopTimerId = setTimeout(stopAnimation, durationMs);
      } else {
        scrollToRealBottom();
      }
    };

    window.addEventListener(eventName, handler);
    return () => {
      window.removeEventListener(eventName, handler);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stopTimerId !== null) clearTimeout(stopTimerId);
    };
  }, [
    durationMs,
    eventName,
    isShrinking,
    itemCountRef,
    scrollToRealBottom,
    stickyBottomRef,
    suppressAutoScrollRef,
  ]);
}

/**
 * `use-stick-to-bottom` observes content growth. Observe the viewport too so a
 * flex sibling or window inset shrinking the available height cannot leave a
 * followed conversation floating above the real bottom.
 */
function useStickyViewportResizeObserver(options: {
  itemCountRef: MutableRefObject<number>;
  stickyBottomRef: MutableRefObject<boolean>;
  resolveScrollElement: () => HTMLElement | null;
  scrollToRealBottom: () => void;
  suppressAutoScrollRef?: RefObject<boolean>;
}): void {
  const {
    itemCountRef,
    stickyBottomRef,
    resolveScrollElement,
    scrollToRealBottom,
    suppressAutoScrollRef,
  } = options;

  useEffect(() => {
    const scrollElement = resolveScrollElement();
    if (!scrollElement || typeof ResizeObserver === 'undefined') return undefined;

    let previousWidth = scrollElement.getBoundingClientRect().width;
    let previousHeight = scrollElement.getBoundingClientRect().height;
    let rafId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === previousWidth && height === previousHeight) continue;
        previousWidth = width;
        previousHeight = height;
        if (!stickyBottomRef.current || itemCountRef.current <= 0) continue;
        if (suppressAutoScrollRef?.current || rafId !== null) continue;

        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (stickyBottomRef.current && !suppressAutoScrollRef?.current) {
            scrollToRealBottom();
          }
        });
      }
    });

    observer.observe(scrollElement);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    itemCountRef,
    resolveScrollElement,
    scrollToRealBottom,
    stickyBottomRef,
    suppressAutoScrollRef,
  ]);
}

export function useStickyScroll({
  sessionId,
  vlistRef,
  scrollRootRef,
  itemCount,
  scrollContainerClass,
  onAtBottomChange,
  suppressAutoScrollRef,
}: UseStickyScrollOptions): UseStickyScrollResult {
  const cachedPositionAtMountRef = useRef(getScrollPosition(sessionId));
  const stickToBottom = useStickToBottom({
    initial: cachedPositionAtMountRef.current?.type === 'offset' ? false : 'instant',
    resize: 'instant',
  });
  const {
    contentRef,
    escapedFromLock,
    isAtBottom,
    scrollRef,
    scrollToBottom: scrollToBottomWithLock,
    state,
    stopScroll,
  } = stickToBottom;

  const isSticky = isAtBottom && !escapedFromLock;
  const stickyBottomRef = useRef(isSticky);
  stickyBottomRef.current = isSticky;

  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;

  const scrollElementRef = useRef<HTMLElement | null>(null);
  const initialScrollRestoredRef = useRef(false);

  const resolveScrollElement = useCallback((): HTMLElement | null => {
    const currentVlist = vlistRef.current;
    if (!currentVlist) return scrollElementRef.current;

    const scrollElement = resolveVListScrollElement(
      currentVlist,
      scrollContainerClass,
      scrollRootRef.current
    );
    if (scrollElement) scrollElementRef.current = scrollElement;
    return scrollElement ?? scrollElementRef.current;
  }, [scrollContainerClass, scrollRootRef, vlistRef]);

  const scrollToRealBottom = useCallback(() => {
    const scrollElement = resolveScrollElement();
    scrollViewportToRealBottom({
      itemCount: itemCountRef.current,
      vlist: vlistRef.current,
      scrollElement,
      bottomOffset: getScrollBottomPaddingOffset(scrollElement),
    });
  }, [itemCountRef, resolveScrollElement, vlistRef]);

  // Attach the library to Virtua's actual viewport and total-height content
  // element. VList does not expose these refs publicly, so DOM resolution stays
  // isolated in sticky-scroll-dom.ts until the virtualizer is replaced.
  useLayoutEffect(() => {
    const scrollElement = resolveScrollElement();
    const contentElement = scrollElement?.firstElementChild;
    if (!scrollElement || !(contentElement instanceof HTMLElement)) return undefined;

    // The library walks the CSS `overflow` shorthand to find the wheel's scroll
    // owner. Virtua intentionally uses different x/y overflow values, whose
    // shorthand serializes as two tokens in browsers. Release explicitly on an
    // upward wheel so that shape can never hide the user's intent.
    const handleWheelUp = (event: WheelEvent) => {
      if (event.deltaY < 0) stopScroll();
    };

    scrollRef(scrollElement);
    contentRef(contentElement);
    scrollElement.addEventListener('wheel', handleWheelUp, { passive: true });
    return () => {
      scrollElement.removeEventListener('wheel', handleWheelUp);
      contentRef(null);
      scrollRef(null);
    };
  }, [contentRef, resolveScrollElement, scrollRef, stopScroll]);

  useEffect(() => {
    if (initialScrollRestoredRef.current || itemCount === 0) return;
    if (!vlistRef.current) return;

    const cachedState = cachedPositionAtMountRef.current;
    requestAnimationFrame(() => {
      const currentVlist = vlistRef.current;
      if (!currentVlist) return;

      if (cachedState?.type === 'offset') {
        stopScroll();
        currentVlist.scrollTo(cachedState.scrollOffset);
      } else {
        void scrollToBottomWithLock({ animation: 'instant' });
        scrollToRealBottom();
      }
      initialScrollRestoredRef.current = true;
    });
  }, [itemCount, scrollToBottomWithLock, scrollToRealBottom, stopScroll, vlistRef]);

  // Search jumps and group expansion are deliberate reading-position changes.
  // Release follow in a layout effect so ResizeObserver cannot pull the list to
  // the end between the React commit and the caller's programmatic jump.
  useLayoutEffect(() => {
    if (suppressAutoScrollRef?.current) stopScroll();
  });

  const scrollToBottom = useCallback(() => {
    saveScrollPosition(sessionId, { type: 'end' });
    if (itemCountRef.current <= 0) return;
    void scrollToBottomWithLock({ animation: 'instant' });
    scrollToRealBottom();
  }, [itemCountRef, scrollToBottomWithLock, scrollToRealBottom, sessionId]);

  const handleScroll = useCallback(
    (offset: number) => {
      const scrollOffset = resolveScrollElement()?.scrollTop ?? offset;
      const followingBottom = state.isAtBottom && !state.escapedFromLock;
      saveScrollPosition(
        sessionId,
        followingBottom ? { type: 'end' } : { type: 'offset', scrollOffset }
      );
    },
    [resolveScrollElement, sessionId, state]
  );

  const previousStickyRef = useRef(isSticky);
  useEffect(() => {
    if (previousStickyRef.current === isSticky) return;
    previousStickyRef.current = isSticky;
    onAtBottomChange?.(isSticky);
  }, [isSticky, onAtBottomChange]);

  // The library settles touch, selection, and scrollbar-drag intent after the
  // native scroll event. Persist that settled state as well as the per-event
  // offsets above, otherwise the final event in a gesture can leave the cache
  // saying "end" even though follow mode has been released.
  useEffect(() => {
    if (!initialScrollRestoredRef.current) return;
    const scrollOffset = resolveScrollElement()?.scrollTop ?? 0;
    saveScrollPosition(sessionId, isSticky ? { type: 'end' } : { type: 'offset', scrollOffset });
  }, [isSticky, resolveScrollElement, sessionId]);

  useStickyViewportResizeObserver({
    itemCountRef,
    stickyBottomRef,
    resolveScrollElement,
    scrollToRealBottom,
    suppressAutoScrollRef,
  });

  usePumpStickyScrollDuringResize({
    eventName: 'lody:keyboard-resize',
    isShrinking: keyboardEventIsShrinking,
    durationMs: 260,
    stickyBottomRef,
    itemCountRef,
    scrollToRealBottom,
    suppressAutoScrollRef,
  });

  usePumpStickyScrollDuringResize({
    eventName: 'lody:terminal-dock-resize',
    isShrinking: terminalDockEventIsShrinking,
    durationMs: 240,
    stickyBottomRef,
    itemCountRef,
    scrollToRealBottom,
    suppressAutoScrollRef,
  });

  return { isSticky, scrollToBottom, handleScroll };
}
