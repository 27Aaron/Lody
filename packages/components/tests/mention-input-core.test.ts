import { describe, expect, it } from 'vitest';

import {
  applyTextEditToMentions,
  findAdjacentMentionForHorizontalNavigation,
  findMentionBeforeCursorForDeletion,
  getMentionValuesFromMentions,
  getTextDiff,
  removeMentionText,
} from '../src/ui/mention/mention-input-core';

describe('mention-input-core', () => {
  it('computes diff and shifts mentions after insertion', () => {
    const prev = 'hello @src/file.ts world';
    const next = 'hello !!! @src/file.ts world';
    const diff = getTextDiff(prev, next);

    expect(diff).toEqual({
      start: 6,
      prevEnd: 6,
      nextEnd: 10,
      removedLen: 0,
      insertedLen: 4,
      delta: 4,
    });

    const mentions = [{ value: 'src/file.ts', start: 6, end: 18 }];
    const shifted = applyTextEditToMentions(mentions, diff!.start, diff!.prevEnd, diff!.delta);

    expect(shifted).toEqual([{ value: 'src/file.ts', start: 10, end: 22 }]);
  });

  it('removes intersected mentions when text edit overlaps mention range', () => {
    const mentions = [
      { value: 'src/file.ts', start: 4, end: 16 },
      { value: '#1284', start: 25, end: 30 },
    ];

    const next = applyTextEditToMentions(mentions, 10, 20, -6);

    expect(next).toEqual([{ value: '#1284', start: 19, end: 24 }]);
  });

  it('deduplicates mention values while preserving first appearance order', () => {
    const values = getMentionValuesFromMentions([
      { value: 'src/a.ts', start: 0, end: 8 },
      { value: '#1284', start: 10, end: 15 },
      { value: 'src/a.ts', start: 20, end: 28 },
    ]);

    expect(values).toEqual(['src/a.ts', '#1284']);
  });

  it('finds adjacent mention for horizontal navigation', () => {
    const mentions = [
      { value: 'src/a.ts', start: 6, end: 15 },
      { value: '#1284', start: 17, end: 22 },
    ];
    const value = 'hello @src/a.ts  #1284 done';

    const left = findAdjacentMentionForHorizontalNavigation({
      mentions,
      value,
      cursorPosition: 16,
      direction: 'left',
      isWordJump: false,
    });

    const right = findAdjacentMentionForHorizontalNavigation({
      mentions,
      value,
      cursorPosition: 16,
      direction: 'right',
      isWordJump: false,
    });

    expect(left?.value).toBe('src/a.ts');
    expect(right?.value).toBe('#1284');
  });

  it('finds deletable mention for regular and ctrl/cmd backspace', () => {
    const mentions = [
      { value: 'src/a.ts', start: 6, end: 15 },
      { value: '#1284', start: 16, end: 21 },
    ];
    const value = 'hello @src/a.ts #1284';

    const regular = findMentionBeforeCursorForDeletion({
      mentions,
      value,
      cursorPosition: 21,
      isCtrlOrCmd: false,
    });

    const ctrl = findMentionBeforeCursorForDeletion({
      mentions,
      value,
      cursorPosition: 22,
      isCtrlOrCmd: true,
    });

    expect(regular?.value).toBe('#1284');
    expect(ctrl?.value).toBe('#1284');
  });

  it('removes mention text and optional trailing space', () => {
    const mention = { value: 'src/a.ts', start: 6, end: 15 };
    const value = 'hello @src/a.ts world';

    expect(removeMentionText(value, mention, true)).toBe('hello world');
    expect(removeMentionText(value, mention, false)).toBe('hello  world');
  });
});
