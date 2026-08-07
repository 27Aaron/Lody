import { describe, expect, it } from 'vitest';

import {
  getPastedTextDraftsAfterInsertion,
  getPastedTextClipboardTextForSelection,
  restorePastedTextDraftsToValue,
  sanitizePastedTextDrafts,
  shouldCapturePastedTextDraft,
  updatePastedTextDraftContent,
} from '../src/lib/pasted-text-draft';

describe('shouldCapturePastedTextDraft', () => {
  it('captures text only when it exceeds 1024 characters', () => {
    expect(shouldCapturePastedTextDraft('a'.repeat(1024))).toBe(false);
    expect(shouldCapturePastedTextDraft('a'.repeat(1025))).toBe(true);
    expect(
      shouldCapturePastedTextDraft(
        Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
      )
    ).toBe(false);
  });
});

describe('getPastedTextDraftsAfterInsertion', () => {
  const existingDraft = {
    id: 'old-paste',
    text: 'old text',
    displayText: '[Pasted 8 characters]',
    start: 'Error '.length,
    end: 'Error '.length + '[Pasted 8 characters]'.length,
  };

  it('removes drafts covered by a full replacement paste', () => {
    const nextDraft = {
      id: 'new-paste',
      text: 'new text',
      displayText: '[Pasted 8 characters]',
      start: 0,
      end: '[Pasted 8 characters]'.length,
    };

    expect(
      getPastedTextDraftsAfterInsertion({
        drafts: [existingDraft],
        draft: nextDraft,
        editStart: 0,
        editEnd: 'Error [Pasted 8 characters], help'.length,
      })
    ).toEqual([nextDraft]);
  });

  it('shifts drafts after an insertion point', () => {
    const insertedDraft = {
      id: 'prefix-paste',
      text: 'prefix',
      displayText: '[Pasted 6 characters]',
      start: 0,
      end: '[Pasted 6 characters]'.length,
    };

    expect(
      getPastedTextDraftsAfterInsertion({
        drafts: [existingDraft],
        draft: insertedDraft,
        editStart: 0,
        editEnd: 0,
      })
    ).toEqual([
      insertedDraft,
      {
        ...existingDraft,
        start: existingDraft.start + insertedDraft.displayText.length,
        end: existingDraft.end + insertedDraft.displayText.length,
      },
    ]);
  });
});

describe('updatePastedTextDraftContent', () => {
  it('updates pasted text content, replaces the inline label, and shifts later drafts', () => {
    const prefix = 'First ';
    const oldLabel = '[Pasted 10 characters]';
    const nextLabel = '[Pasted 5 characters]';
    const middle = ' then ';
    const secondLabel = '[Pasted 20 characters]';
    const currentValue = `${prefix}${oldLabel}${middle}${secondLabel}`;
    const firstStart = prefix.length;
    const firstEnd = firstStart + oldLabel.length;
    const secondStart = firstEnd + middle.length;

    expect(
      updatePastedTextDraftContent({
        currentValue,
        drafts: [
          {
            id: 'paste-1',
            text: 'alpha beta',
            displayText: oldLabel,
            start: firstStart,
            end: firstEnd,
          },
          {
            id: 'paste-2',
            text: 'second pasted content',
            displayText: secondLabel,
            start: secondStart,
            end: secondStart + secondLabel.length,
          },
        ],
        draftId: 'paste-1',
        text: 'gamma',
        displayText: nextLabel,
      })
    ).toEqual({
      nextValue: `${prefix}${nextLabel}${middle}${secondLabel}`,
      nextDrafts: [
        {
          id: 'paste-1',
          text: 'gamma',
          displayText: nextLabel,
          start: firstStart,
          end: firstStart + nextLabel.length,
        },
        {
          id: 'paste-2',
          text: 'second pasted content',
          displayText: secondLabel,
          start: secondStart - 1,
          end: secondStart - 1 + secondLabel.length,
        },
      ],
    });
  });

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

describe('restorePastedTextDraftsToValue', () => {
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

describe('sanitizePastedTextDrafts', () => {
  it('preserves whitespace-only draft text while the inline token still exists', () => {
    expect(
      sanitizePastedTextDrafts([
        {
          id: 'paste-empty',
          text: '   ',
          displayText: '[Pasted 0 characters]',
          start: 0,
          end: '[Pasted 0 characters]'.length,
        },
      ])
    ).toEqual([
      {
        id: 'paste-empty',
        text: '   ',
        displayText: '[Pasted 0 characters]',
        start: 0,
        end: '[Pasted 0 characters]'.length,
      },
    ]);
  });
});
