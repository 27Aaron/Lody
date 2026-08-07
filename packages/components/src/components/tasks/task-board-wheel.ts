/**
 * Wheel → horizontal scroll for the Kanban board.
 *
 * The board is the only horizontally scrolling surface in the app, and a plain
 * mouse wheel only produces `deltaY`. Browsers do not translate that delta for
 * us here: every column body is itself an `overflow-y-auto` scroller, so the
 * wheel latches onto the column under the pointer and a wheel over the board
 * simply does nothing once that column has no vertical overflow left.
 *
 * So we translate it, but only when nothing else wants the delta — the column
 * under the pointer must not be able to scroll vertically in that direction,
 * and the board itself must have room left in the matching horizontal
 * direction (otherwise we would trap the wheel at the end of the board).
 */

/** A vertical scroller between the wheel target and the board root. */
export type BoardWheelScroller = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** The board's own horizontal scroll geometry. */
export type BoardWheelViewport = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/**
 * Sub-pixel slack. Fractional device pixel ratios leave `scrollHeight` a hair
 * above `clientHeight` on surfaces that visually do not scroll; treating that
 * as "can consume" would swallow the delta and leave the wheel dead again.
 */
const SCROLL_EPSILON = 1;

const canScrollVertically = (node: BoardWheelScroller, deltaY: number): boolean =>
  deltaY < 0
    ? node.scrollTop > SCROLL_EPSILON
    : node.scrollHeight - node.clientHeight - node.scrollTop > SCROLL_EPSILON;

const canScrollHorizontally = (board: BoardWheelViewport, delta: number): boolean =>
  delta < 0
    ? board.scrollLeft > SCROLL_EPSILON
    : board.scrollWidth - board.clientWidth - board.scrollLeft > SCROLL_EPSILON;

/**
 * How far to scroll the board horizontally for one wheel event, or `null` to
 * leave the event to the browser.
 *
 * @param scrollers vertical scrollers from the wheel target up to (excluding)
 *   the board root, innermost first.
 */
export function resolveBoardWheelScroll(input: {
  deltaX: number;
  deltaY: number;
  scrollers: readonly BoardWheelScroller[];
  board: BoardWheelViewport;
}): number | null {
  const { deltaX, deltaY, scrollers, board } = input;
  // A horizontal delta (trackpad swipe, shift+wheel on most platforms) is
  // already what the board wants — the browser applies it correctly.
  if (deltaX !== 0) return null;
  if (deltaY === 0) return null;
  if (scrollers.some((scroller) => canScrollVertically(scroller, deltaY))) return null;
  if (!canScrollHorizontally(board, deltaY)) return null;
  return deltaY;
}
