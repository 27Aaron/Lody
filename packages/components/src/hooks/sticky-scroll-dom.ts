import type { VListHandle } from 'virtua';

/** Ignore sub-pixel differences when clamping to the true DOM bottom. */
const SCROLL_EPSILON = 1;

export type ScrollElementLike = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>;

/**
 * Get the underlying scroll DOM element from a VList handle.
 *
 * Virtua's VList doesn't expose the scroll element publicly (scrollRef is only
 * on Virtualizer, not VList). We access the private _scrollElement field with a
 * fallback to querySelector. This is fragile — if Virtua changes internals,
 * update this single function.
 */
export function resolveVListScrollElement(
  vlist: VListHandle,
  fallbackClass: string,
  fallbackRoot?: ParentNode | null
): HTMLElement | null {
  const privateScrollElement = (vlist as unknown as { _scrollElement?: HTMLElement })
    ._scrollElement;
  if (privateScrollElement instanceof HTMLElement) {
    return privateScrollElement;
  }

  // Session detail keeps parent and child chats mounted at the same time.
  // Keep the fallback scoped so a hidden tab cannot bind its sticky-scroll
  // logic to the visible tab's `.chat-scrollbar` element.
  const el = fallbackRoot?.querySelector(`.${fallbackClass}`);
  return el instanceof HTMLElement ? el : null;
}

export function getScrollElementDistanceFromBottom(scrollElement: ScrollElementLike): number {
  return Math.max(
    0,
    scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
  );
}

export function getScrollElementMaxOffset(scrollElement: ScrollElementLike): number {
  return Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
}

export function getScrollBottomPaddingOffset(scrollElement: HTMLElement | null): number {
  if (!scrollElement || typeof getComputedStyle !== 'function') {
    return 0;
  }
  const paddingBottom = Number.parseFloat(getComputedStyle(scrollElement).paddingBottom);
  return Number.isFinite(paddingBottom) ? Math.max(0, paddingBottom) : 0;
}

export function scrollViewportToRealBottom(options: {
  itemCount: number;
  vlist: Pick<VListHandle, 'scrollToIndex'> | null;
  scrollElement: ScrollElementLike | null;
  bottomOffset?: number;
}): void {
  const { itemCount, vlist, scrollElement, bottomOffset = 0 } = options;
  if (itemCount <= 0) return;

  vlist?.scrollToIndex(itemCount - 1, { align: 'end', offset: bottomOffset });

  if (!scrollElement) return;

  const maxScrollTop = getScrollElementMaxOffset(scrollElement);
  if (Math.abs(scrollElement.scrollTop - maxScrollTop) > SCROLL_EPSILON) {
    scrollElement.scrollTop = maxScrollTop;
  }
}
