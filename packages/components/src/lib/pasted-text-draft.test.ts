import { describe, expect, it } from 'vitest';

import {
  arePastedTextDraftsEqual,
  getPastedTextCharacterCount,
  getPastedTextClipboardTextForSelection,
  getPastedTextLineCount,
  insertPastedTextDraft,
  isLargePastedText,
  normalizePastedTextDraft,
  restorePastedTextDraftsToValue,
  sanitizePastedTextDrafts,
  shouldCapturePastedTextDraft,
  updatePastedTextDraftContent,
} from './pasted-text-draft';

describe('normalizePastedTextDraft', () => {
  it('normalizes CRLF line endings', () => {
    expect(normalizePastedTextDraft('a\r\nb\r\n')).toBe('a\nb\n');
  });
});

describe('isLargePastedText', () => {
  it('treats text over 1024 characters as large', () => {
    expect(isLargePastedText('a'.repeat(1025))).toBe(true);
  });

  it('does not treat text at or below 1024 characters as large', () => {
    expect(isLargePastedText('a'.repeat(1024))).toBe(false);
    expect(
      isLargePastedText(Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n'))
    ).toBe(false);
  });
});

describe('shouldCapturePastedTextDraft', () => {
  const largeText = Array.from({ length: 10 }, () => '0123456789'.repeat(40)).join('\n');

  it('captures large pasted text', () => {
    expect(shouldCapturePastedTextDraft(largeText)).toBe(true);
  });

  it('does not capture short pasted text', () => {
    expect(shouldCapturePastedTextDraft('short text')).toBe(false);
  });
});

describe('pasted text summaries', () => {
  it('reports characters and lines from normalized content', () => {
    const text = '  first line\r\nsecond line\r\n\r\nthird line  ';
    expect(getPastedTextCharacterCount(text)).toBe('first line\nsecond line\n\nthird line'.length);
    expect(getPastedTextLineCount(text)).toBe(4);
  });
});

describe('insertPastedTextDraft', () => {
  it('replaces the active selection with an inline pasted-text label', () => {
    expect(
      insertPastedTextDraft({
        currentValue: 'Report: replace me please',
        pastedText: '  alpha\nbeta  ',
        displayText: '[Pasted 10 characters]',
        id: 'paste-1',
        selectionStart: 'Report: '.length,
        selectionEnd: 'Report: replace me please'.length,
      })
    ).toEqual({
      nextValue: 'Report: [Pasted 10 characters]',
      draft: {
        id: 'paste-1',
        text: 'alpha\nbeta',
        displayText: '[Pasted 10 characters]',
        start: 'Report: '.length,
        end: 'Report: '.length + '[Pasted 10 characters]'.length,
      },
    });
  });
});

describe('restorePastedTextDraftsToValue', () => {
  it('restores full pasted text into the visible inline prompt', () => {
    expect(
      restorePastedTextDraftsToValue('Error [Pasted 10 characters], please help', [
        {
          id: 'paste-1',
          text: 'alpha\nbeta',
          displayText: '[Pasted 10 characters]',
          start: 'Error '.length,
          end: 'Error '.length + '[Pasted 10 characters]'.length,
        },
      ])
    ).toBe('Error alpha\nbeta, please help');
  });

  it('preserves edited leading and trailing line breaks when restoring', () => {
    expect(
      restorePastedTextDraftsToValue('Before [Pasted 5 characters] after', [
        {
          id: 'paste-1',
          text: '\nalpha\n',
          displayText: '[Pasted 5 characters]',
          start: 'Before '.length,
          end: 'Before '.length + '[Pasted 5 characters]'.length,
        },
      ])
    ).toBe('Before \nalpha\n after');
  });
});

describe('getPastedTextClipboardTextForSelection', () => {
  const firstLabel = '[Pasted 12 characters]';
  const secondLabel = '[Pasted 20 characters]';
  const prefix = 'Before ';
  const between = ' and ';
  const suffix = ' after';
  const value = `${prefix}${firstLabel}${between}${secondLabel}${suffix}`;
  const firstStart = prefix.length;
  const firstEnd = firstStart + firstLabel.length;
  const secondStart = firstEnd + between.length;
  const drafts = [
    {
      id: 'paste-1',
      text: 'first pasted\nbody',
      displayText: firstLabel,
      start: firstStart,
      end: firstEnd,
    },
    {
      id: 'paste-2',
      text: 'second pasted body',
      displayText: secondLabel,
      start: secondStart,
      end: secondStart + secondLabel.length,
    },
  ];

  it('expands every pasted draft intersecting the copied selection', () => {
    expect(
      getPastedTextClipboardTextForSelection({
        value,
        drafts,
        selectionStart: prefix.length,
        selectionEnd: value.length - suffix.length,
      })
    ).toBe('first pasted\nbody and second pasted body');
  });

  it('preserves normal selected text around pasted drafts', () => {
    expect(
      getPastedTextClipboardTextForSelection({
        value,
        drafts,
        selectionStart: 0,
        selectionEnd: value.length,
      })
    ).toBe('Before first pasted\nbody and second pasted body after');
  });

  it('treats a partially selected pasted draft as the full pasted content', () => {
    expect(
      getPastedTextClipboardTextForSelection({
        value,
        drafts,
        selectionStart: firstStart + '[Pasted'.length,
        selectionEnd: secondStart + '[Pasted'.length,
      })
    ).toBe('first pasted\nbody and second pasted body');
  });

  it('keeps native copy behavior when the selection does not include pasted drafts', () => {
    expect(
      getPastedTextClipboardTextForSelection({
        value,
        drafts,
        selectionStart: firstEnd,
        selectionEnd: secondStart,
      })
    ).toBeNull();
  });
});

describe('arePastedTextDraftsEqual', () => {
  it('compares complete draft identity and ranges', () => {
    const draft = {
      id: 'paste-1',
      text: 'alpha',
      displayText: '[Pasted 5 characters]',
      start: 6,
      end: 27,
    };

    expect(arePastedTextDraftsEqual([draft], [draft])).toBe(true);
    expect(arePastedTextDraftsEqual([draft], [{ ...draft, end: draft.end + 1 }])).toBe(false);
  });
});

describe('sanitizePastedTextDrafts', () => {
  it('drops invalid entries and normalizes surviving drafts without trimming text', () => {
    expect(
      sanitizePastedTextDrafts([
        {
          id: 'paste-1',
          text: '  alpha\r\nbeta  \n',
          displayText: '[Pasted 10 characters]',
          start: 5,
          end: 27,
        },
        { id: 'bad-entry', text: 'missing range' },
      ])
    ).toEqual([
      {
        id: 'paste-1',
        text: '  alpha\nbeta  \n',
        displayText: '[Pasted 10 characters]',
        start: 5,
        end: 27,
      },
    ]);
  });
});

describe('updatePastedTextDraftContent', () => {
  it('keeps a newline inserted at the end of an edited draft', () => {
    expect(
      updatePastedTextDraftContent({
        currentValue: 'See [Pasted 5 characters] please',
        drafts: [
          {
            id: 'paste-1',
            text: 'alpha',
            displayText: '[Pasted 5 characters]',
            start: 'See '.length,
            end: 'See '.length + '[Pasted 5 characters]'.length,
          },
        ],
        draftId: 'paste-1',
        text: 'alpha\n',
        displayText: '[Pasted 5 characters]',
      })
    ).toEqual({
      nextValue: 'See [Pasted 5 characters] please',
      nextDrafts: [
        {
          id: 'paste-1',
          text: 'alpha\n',
          displayText: '[Pasted 5 characters]',
          start: 'See '.length,
          end: 'See '.length + '[Pasted 5 characters]'.length,
        },
      ],
    });
  });
});
