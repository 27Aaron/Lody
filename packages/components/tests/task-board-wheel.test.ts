import { describe, expect, it } from 'vitest';
import {
  resolveBoardWheelScroll,
  type BoardWheelScroller,
  type BoardWheelViewport,
} from '../src/components/tasks/task-board-wheel';

/** A board with room to scroll in both directions. */
const board: BoardWheelViewport = { scrollLeft: 200, scrollWidth: 2000, clientWidth: 800 };

/** A column whose cards overflow, parked at the top. */
const overflowingColumn: BoardWheelScroller = {
  scrollTop: 0,
  scrollHeight: 900,
  clientHeight: 400,
};

/** A column whose cards fit — nothing for a vertical wheel to do. */
const shortColumn: BoardWheelScroller = { scrollTop: 0, scrollHeight: 400, clientHeight: 400 };

describe('resolveBoardWheelScroll', () => {
  it('turns a wheel over a column with nothing left to scroll into board movement', () => {
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: 120, scrollers: [shortColumn], board })
    ).toBe(120);
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: -120, scrollers: [shortColumn], board })
    ).toBe(-120);
  });

  it('leaves the delta to a column that can still scroll in that direction', () => {
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: 120, scrollers: [overflowingColumn], board })
    ).toBeNull();
    // Same column, now at its bottom: down is spent, so the board takes it.
    const atBottom = { ...overflowingColumn, scrollTop: 500 };
    expect(resolveBoardWheelScroll({ deltaX: 0, deltaY: 120, scrollers: [atBottom], board })).toBe(
      120
    );
    // …but scrolling back up is still the column's.
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: -120, scrollers: [atBottom], board })
    ).toBeNull();
  });

  it('checks every scroller between the pointer and the board, not just the innermost', () => {
    expect(
      resolveBoardWheelScroll({
        deltaX: 0,
        deltaY: 120,
        scrollers: [shortColumn, overflowingColumn],
        board,
      })
    ).toBeNull();
  });

  it('leaves a horizontal delta alone — the browser already applies it', () => {
    expect(
      resolveBoardWheelScroll({ deltaX: -40, deltaY: 0, scrollers: [shortColumn], board })
    ).toBeNull();
    // Diagonal trackpad swipes carry both; the horizontal part is enough.
    expect(
      resolveBoardWheelScroll({ deltaX: -40, deltaY: 8, scrollers: [shortColumn], board })
    ).toBeNull();
  });

  it('releases the wheel at the ends of the board instead of trapping it', () => {
    const atRightEnd: BoardWheelViewport = {
      scrollLeft: 1200,
      scrollWidth: 2000,
      clientWidth: 800,
    };
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: 120, scrollers: [], board: atRightEnd })
    ).toBeNull();
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: -120, scrollers: [], board: atRightEnd })
    ).toBe(-120);

    const atLeftEnd: BoardWheelViewport = { scrollLeft: 0, scrollWidth: 2000, clientWidth: 800 };
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: -120, scrollers: [], board: atLeftEnd })
    ).toBeNull();
  });

  it('does nothing when the board has no horizontal overflow at all', () => {
    const noOverflow: BoardWheelViewport = { scrollLeft: 0, scrollWidth: 800, clientWidth: 800 };
    expect(
      resolveBoardWheelScroll({ deltaX: 0, deltaY: 120, scrollers: [], board: noOverflow })
    ).toBeNull();
  });

  it('ignores sub-pixel overflow so a fractional DPR does not eat the wheel', () => {
    const hairline: BoardWheelScroller = { scrollTop: 0, scrollHeight: 400.5, clientHeight: 400 };
    expect(resolveBoardWheelScroll({ deltaX: 0, deltaY: 120, scrollers: [hairline], board })).toBe(
      120
    );
  });
});
