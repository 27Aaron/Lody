import { describe, expect, it } from 'vitest';

import {
  isImeComposingKeyboardEvent,
  resolveDuplicatedImeCommitEcho,
} from '../src/lib/ime';

describe('isImeComposingKeyboardEvent', () => {
  it('returns true when native isComposing is true', () => {
    expect(
      isImeComposingKeyboardEvent({
        key: 'Enter',
        nativeEvent: { isComposing: true },
      })
    ).toBe(true);
  });

  it('returns true for Process key events', () => {
    expect(
      isImeComposingKeyboardEvent({
        key: 'Process',
        nativeEvent: {},
      })
    ).toBe(true);
  });

  it('returns true when keyCode is 229', () => {
    expect(
      isImeComposingKeyboardEvent({
        key: 'Enter',
        nativeEvent: { keyCode: 229 },
      })
    ).toBe(true);
  });

  it('returns true when which is 229', () => {
    expect(
      isImeComposingKeyboardEvent({
        key: 'Enter',
        nativeEvent: { which: 229 },
      })
    ).toBe(true);
  });

  it('returns false for regular keydown events', () => {
    expect(
      isImeComposingKeyboardEvent({
        key: 'Enter',
        nativeEvent: {},
      })
    ).toBe(false);
  });
});

describe('resolveDuplicatedImeCommitEcho', () => {
  it('resolves duplicated insertFromComposition echo while composing', () => {
    expect(
      resolveDuplicatedImeCommitEcho({
        nextValue: 'tokentoken',
        lastStableComposingValue: 'token',
        inputType: 'insertFromComposition',
        isComposing: true,
      })
    ).toBe('token');
  });

  it('prefers committed data when last composing snapshot is stale', () => {
    expect(
      resolveDuplicatedImeCommitEcho({
        nextValue: '你好你好',
        lastStableComposingValue: 'ni h',
        inputType: 'insertFromComposition',
        isComposing: true,
        committedData: '你好',
      })
    ).toBe('你好');
  });

  it('returns null for non-matching input types', () => {
    expect(
      resolveDuplicatedImeCommitEcho({
        nextValue: 'tokentoken',
        lastStableComposingValue: 'token',
        inputType: 'insertCompositionText',
        isComposing: true,
      })
    ).toBeNull();
  });

  it('returns null when event is not composing', () => {
    expect(
      resolveDuplicatedImeCommitEcho({
        nextValue: 'tokentoken',
        lastStableComposingValue: 'token',
        inputType: 'insertFromComposition',
        isComposing: false,
      })
    ).toBeNull();
  });
});


