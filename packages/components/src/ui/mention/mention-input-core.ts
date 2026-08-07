import type { Mention } from './mention-root';

export type TextDiff = {
  start: number;
  prevEnd: number;
  nextEnd: number;
  removedLen: number;
  insertedLen: number;
  delta: number;
};

export function getTextDiff(prevValue: string, nextValue: string): TextDiff | null {
  if (prevValue === nextValue) return null;

  const prevLen = prevValue.length;
  const nextLen = nextValue.length;

  let start = 0;
  while (start < prevLen && start < nextLen && prevValue[start] === nextValue[start]) {
    start += 1;
  }

  let prevEnd = prevLen;
  let nextEnd = nextLen;
  while (prevEnd > start && nextEnd > start && prevValue[prevEnd - 1] === nextValue[nextEnd - 1]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  return {
    start,
    prevEnd,
    nextEnd,
    removedLen: prevEnd - start,
    insertedLen: nextEnd - start,
    delta: nextEnd - prevEnd,
  };
}

export function getMentionValuesFromMentions(mentions: Mention[]) {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const mention of mentions) {
    if (mention.kind === 'pasted_text') continue;
    if (seen.has(mention.value)) continue;
    seen.add(mention.value);
    values.push(mention.value);
  }

  return values;
}

export function areMentionsEqual(current: Mention[], next: Mention[]) {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let index = 0; index < current.length; index += 1) {
    const currentMention = current[index];
    const nextMention = next[index];

    if (
      !currentMention ||
      !nextMention ||
      currentMention.start !== nextMention.start ||
      currentMention.end !== nextMention.end ||
      currentMention.value !== nextMention.value ||
      currentMention.kind !== nextMention.kind
    ) {
      return false;
    }
  }

  return true;
}

export function areStringArraysEqual(current: string[] | undefined, next: string[]) {
  if (!current) return next.length === 0;
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== next[index]) {
      return false;
    }
  }

  return true;
}

export function applyTextEditToMentions(
  mentions: Mention[],
  start: number,
  prevEnd: number,
  delta: number
) {
  if (mentions.length === 0) {
    return mentions;
  }

  const next: Mention[] = [];
  let hasChanges = false;

  for (const mention of mentions) {
    const intersects = mention.start < prevEnd && mention.end > start;
    if (intersects) {
      hasChanges = true;
      continue;
    }

    if (mention.start >= prevEnd) {
      if (delta !== 0) {
        hasChanges = true;
        next.push({
          ...mention,
          start: mention.start + delta,
          end: mention.end + delta,
        });
      } else {
        next.push(mention);
      }
      continue;
    }

    next.push(mention);
  }

  if (!hasChanges) {
    return mentions;
  }

  next.sort((a, b) => a.start - b.start);
  return next;
}

type HorizontalNavigationOptions = {
  mentions: Mention[];
  value: string;
  cursorPosition: number;
  direction: 'left' | 'right';
  isWordJump: boolean;
};

export function findAdjacentMentionForHorizontalNavigation({
  mentions,
  value,
  cursorPosition,
  direction,
  isWordJump,
}: HorizontalNavigationOptions): Mention | null {
  const isLeftArrow = direction === 'left';

  return (
    mentions.find((mention) => {
      if (isLeftArrow) {
        const textBetween = value.slice(mention.end, cursorPosition);
        const isOnlySpaces = /^\s*$/.test(textBetween);

        if (isWordJump) {
          return (
            cursorPosition > mention.start &&
            (cursorPosition === mention.end || (cursorPosition > mention.end && isOnlySpaces))
          );
        }

        return (
          cursorPosition === mention.end ||
          (cursorPosition > mention.end && cursorPosition <= mention.end + 1 && isOnlySpaces)
        );
      }

      const textBetween = value.slice(cursorPosition, mention.start);
      const isOnlySpaces = /^\s*$/.test(textBetween);

      if (isWordJump) {
        return (
          (cursorPosition >= mention.start && cursorPosition < mention.end) ||
          (cursorPosition < mention.start && isOnlySpaces)
        );
      }

      return (
        cursorPosition === mention.start ||
        (cursorPosition < mention.start && cursorPosition >= mention.start - 1 && isOnlySpaces)
      );
    }) ?? null
  );
}

type BackspaceMentionOptions = {
  mentions: Mention[];
  value: string;
  cursorPosition: number;
  isCtrlOrCmd: boolean;
};

export function findMentionBeforeCursorForDeletion({
  mentions,
  value,
  cursorPosition,
  isCtrlOrCmd,
}: BackspaceMentionOptions): Mention | null {
  return (
    mentions.find((mention) => {
      if (!isCtrlOrCmd) {
        return (
          cursorPosition === mention.end ||
          (cursorPosition === mention.end + 1 && value[mention.end] === ' ') ||
          (cursorPosition > mention.start && cursorPosition <= mention.end)
        );
      }

      const textBetween = value.slice(mention.end, cursorPosition);
      return mention.end <= cursorPosition && /^\s*$/.test(textBetween);
    }) ?? null
  );
}

export function removeMentionText(value: string, mention: Mention, includeTrailingSpace: boolean) {
  return value.slice(0, mention.start) + value.slice(mention.end + (includeTrailingSpace ? 1 : 0));
}
