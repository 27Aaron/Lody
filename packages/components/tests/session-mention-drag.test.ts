import { describe, expect, it } from 'vitest';

import {
  SESSION_MENTION_DRAG_TYPE,
  hasAcceptableSessionMentionTransfer,
  readSessionMentionDragSessionId,
  startSessionMentionDrag,
} from '../src/lib/session-mention-drag';

/**
 * A DataTransfer stand-in that lowercases type names the way browsers do — the
 * detail the id-in-the-type-name trick has to survive.
 */
function createTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'none' as string,
    get types() {
      return Array.from(data.keys());
    },
    setData(type: string, value: string) {
      data.set(type.toLowerCase(), value);
    },
    getData(type: string) {
      return data.get(type.toLowerCase()) ?? '';
    },
  };
}

describe('session mention drag transfer', () => {
  it('carries the id in the payload and in a type name', () => {
    const transfer = createTransfer();
    startSessionMentionDrag({ dataTransfer: transfer }, { sessionId: 'sess_AbC', title: 'Fix CI' });

    expect(transfer.effectAllowed).toBe('copy');
    expect(transfer.types).toContain(SESSION_MENTION_DRAG_TYPE);
    // The exact-cased id only survives in the payload; the type name is folded.
    expect(readSessionMentionDragSessionId(transfer)).toBe('sess_AbC');
    expect(transfer.getData('text/plain')).toBe('Fix CI');
  });

  it('falls back to the id when the session has no title', () => {
    const transfer = createTransfer();
    startSessionMentionDrag({ dataTransfer: transfer }, { sessionId: 'sess_1', title: '   ' });
    expect(transfer.getData('text/plain')).toBe('sess_1');
  });

  it('ignores drags that are not ours', () => {
    const files = { types: ['Files'] };
    expect(hasAcceptableSessionMentionTransfer(files)).toBe(false);
    expect(hasAcceptableSessionMentionTransfer(null)).toBe(false);
  });

  it('refuses the conversation the surface already is, before the drop', () => {
    const transfer = createTransfer();
    startSessionMentionDrag({ dataTransfer: transfer }, { sessionId: 'sess_AbC' });

    // Case-insensitive: the type name the check reads has been lowercased.
    expect(hasAcceptableSessionMentionTransfer(transfer, { excludeSessionId: 'sess_AbC' })).toBe(
      false
    );
    expect(hasAcceptableSessionMentionTransfer(transfer, { excludeSessionId: 'sess_other' })).toBe(
      true
    );
    expect(hasAcceptableSessionMentionTransfer(transfer)).toBe(true);
  });

  it('reads nothing from a transfer without our payload', () => {
    expect(readSessionMentionDragSessionId(createTransfer())).toBeNull();
  });
});
