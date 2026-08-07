import type { ScrollPositionState } from './use-scroll-position-cache';

/** Distance from bottom (px) to consider "at bottom" and re-enter sticky mode. */
export const BOTTOM_THRESHOLD = 32;

/**
 * Distance from bottom (px) required to leave sticky mode.
 * Larger than BOTTOM_THRESHOLD to create hysteresis during streaming growth.
 */
export const UNSTICK_THRESHOLD = 200;

/** Minimum negative scroll delta (px) to count as an upward user scroll. */
export const SCROLL_UP_DELTA = -5;

/**
 * Baseline used after a programmatic scroll so the next scroll event is treated
 * as neutral rather than as a user gesture.
 */
export const PROGRAMMATIC_SCROLL_BASELINE = -1;

export interface StickyScrollTransitionInput {
  previousSticky: boolean;
  distanceFromBottom: number;
  scrollOffset: number;
  lastScrollOffset: number;
}

export interface StickyScrollTransition {
  nextSticky: boolean;
  nextLastScrollOffset: number;
  didStickyChange: boolean;
  cacheState: ScrollPositionState;
}

export function getInitialStickyScrollState(
  cachedState: ScrollPositionState | undefined
): boolean {
  return !cachedState || cachedState.type === 'end';
}

export function reduceStickyScrollState(
  input: StickyScrollTransitionInput
): StickyScrollTransition {
  const { previousSticky, distanceFromBottom, scrollOffset, lastScrollOffset } = input;

  const scrollDelta = lastScrollOffset >= 0 ? scrollOffset - lastScrollOffset : 0;
  const userScrolledUp = scrollDelta < SCROLL_UP_DELTA;
  const isAtBottom = distanceFromBottom <= BOTTOM_THRESHOLD;

  let nextSticky = previousSticky;
  if (previousSticky && userScrolledUp && distanceFromBottom > UNSTICK_THRESHOLD) {
    nextSticky = false;
  } else if (!previousSticky && isAtBottom) {
    nextSticky = true;
  }

  return {
    nextSticky,
    nextLastScrollOffset: scrollOffset,
    didStickyChange: nextSticky !== previousSticky,
    cacheState: nextSticky ? { type: 'end' } : { type: 'offset', scrollOffset },
  };
}
