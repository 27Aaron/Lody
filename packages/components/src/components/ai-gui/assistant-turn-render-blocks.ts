import type { MessageContent } from '@lody/shared';
import {
  buildAssistantMessageRenderItems,
  type AssistantMessageRenderItem,
} from './assistant-message-render-items';
import { shouldCollapseAssistantMessageItem } from './message-copy';

type ToolCallMessage = Extract<MessageContent, { type: 'tool_call' }>;
type ThoughtMessage = Extract<MessageContent, { type: 'thought' }>;

export type AssistantToolCallRenderItem = Omit<AssistantMessageRenderItem, 'content'> & {
  content: ToolCallMessage;
};

export type AssistantThoughtRenderItem = Omit<AssistantMessageRenderItem, 'content'> & {
  content: ThoughtMessage;
};

export type AssistantActivityRenderItem = AssistantToolCallRenderItem | AssistantThoughtRenderItem;

export type AssistantActivitySummary = {
  hasThought: boolean;
  commandCount: number;
  readFileCount: number;
  editFileCount: number;
  searchCount: number;
  fetchCount: number;
  otherCount: number;
};

export type AssistantTurnRenderBlock =
  | {
      kind: 'content';
      key: string;
      entry: AssistantMessageRenderItem;
    }
  | {
      kind: 'activity_group';
      key: string;
      entries: AssistantActivityRenderItem[];
      summary: AssistantActivitySummary;
    };

export type AssistantTurnRenderLayout = {
  blocks: AssistantTurnRenderBlock[];
  workBlockKeys: ReadonlySet<string>;
  firstWorkBlockIndex: number;
  entries: readonly AssistantMessageRenderItem[];
};

const getToolFilePaths = (toolCall: ToolCallMessage): string[] => {
  const paths = new Set<string>();
  for (const location of toolCall.locations ?? []) {
    if (location.path) paths.add(location.path);
  }
  for (const block of toolCall.content ?? []) {
    if (block.type === 'diff' && block.path) paths.add(block.path);
  }
  return [...paths];
};

export const summarizeAssistantActivity = (
  entries: readonly AssistantActivityRenderItem[]
): AssistantActivitySummary => {
  const readPaths = new Set<string>();
  const editPaths = new Set<string>();
  let readCallsWithoutPaths = 0;
  let editCallsWithoutPaths = 0;
  let commandCount = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let otherCount = 0;

  let hasThought = false;

  for (const { content } of entries) {
    if (content.type === 'thought' || content.kind === 'think') {
      hasThought = true;
      continue;
    }
    const toolCall = content;
    const paths = getToolFilePaths(toolCall);
    switch (toolCall.kind) {
      case 'execute':
      case 'bash':
        commandCount += 1;
        break;
      case 'read':
        if (paths.length === 0) {
          readCallsWithoutPaths += 1;
        } else {
          for (const path of paths) readPaths.add(path);
        }
        break;
      case 'edit':
      case 'write':
      case 'delete':
      case 'move':
        if (paths.length === 0) {
          editCallsWithoutPaths += 1;
        } else {
          for (const path of paths) editPaths.add(path);
        }
        break;
      case 'search':
        searchCount += 1;
        break;
      case 'fetch':
        fetchCount += 1;
        break;
      default: {
        const hasTerminalContent = toolCall.content?.some(
          (block) => block.type === 'terminal_command' || block.type === 'terminal_output'
        );
        if (hasTerminalContent) {
          commandCount += 1;
        } else {
          otherCount += 1;
        }
      }
    }
  }

  return {
    hasThought,
    commandCount,
    readFileCount: readPaths.size + readCallsWithoutPaths,
    editFileCount: editPaths.size + editCallsWithoutPaths,
    searchCount,
    fetchCount,
    otherCount,
  };
};

const isActivityGroupEntry = (
  entry: AssistantMessageRenderItem
): entry is AssistantActivityRenderItem =>
  entry.content.type === 'thought' ||
  (entry.content.type === 'tool_call' &&
    entry.content.kind !== 'switch_mode' &&
    entry.content.activityKind === undefined);

const buildActivityGroupKey = (messageId: string, first: AssistantActivityRenderItem): string => {
  const suffix = first.content.type === 'tool_call' ? first.content.toolCallId : first.itemIndex;
  return `activity-group:${messageId}:${first.itemIndex}:${suffix}`;
};

const buildAssistantTurnRenderBlocksFromEntries = (
  messageId: string,
  entries: readonly AssistantMessageRenderItem[]
): AssistantTurnRenderBlock[] => {
  const blocks: AssistantTurnRenderBlock[] = [];
  let pendingActivityEntries: AssistantActivityRenderItem[] = [];

  const flushActivityGroup = () => {
    const first = pendingActivityEntries[0];
    if (!first) return;
    blocks.push({
      kind: 'activity_group',
      key: buildActivityGroupKey(messageId, first),
      entries: pendingActivityEntries,
      summary: summarizeAssistantActivity(pendingActivityEntries),
    });
    pendingActivityEntries = [];
  };

  for (const entry of entries) {
    if (entry.content.type === 'available_commands') {
      continue;
    }
    if (isActivityGroupEntry(entry)) {
      pendingActivityEntries.push(entry);
      continue;
    }

    flushActivityGroup();
    blocks.push({
      kind: 'content',
      key: `content:${messageId}:${entry.itemIndex}:${entry.content.type}`,
      entry,
    });
  }

  flushActivityGroup();
  return blocks;
};

export const buildAssistantTurnRenderBlocks = (
  messageId: string,
  items: readonly MessageContent[]
): AssistantTurnRenderBlock[] =>
  buildAssistantTurnRenderBlocksFromEntries(messageId, buildAssistantMessageRenderItems(items));

export const buildAssistantTurnRenderLayout = (
  messageId: string,
  items: readonly MessageContent[],
  isTurnFinished: boolean
): AssistantTurnRenderLayout => {
  const entries = buildAssistantMessageRenderItems(items);
  const blocks = buildAssistantTurnRenderBlocksFromEntries(messageId, entries);
  if (!isTurnFinished) {
    return { blocks, workBlockKeys: new Set(), firstWorkBlockIndex: -1, entries };
  }

  const contentItems = entries.map((entry) => entry.content);
  const collapsibleItemIndexes = new Set<number>();
  for (const entry of entries) {
    if (
      shouldCollapseAssistantMessageItem({
        content: entry.content,
        index: entry.displayIndex,
        items: contentItems,
        isTurnFinished,
      })
    ) {
      collapsibleItemIndexes.add(entry.itemIndex);
    }
  }

  const workBlockKeys = new Set<string>();
  for (const block of blocks) {
    if (block.kind === 'activity_group' || collapsibleItemIndexes.has(block.entry.itemIndex)) {
      workBlockKeys.add(block.key);
    }
  }

  return {
    blocks,
    workBlockKeys,
    firstWorkBlockIndex: blocks.findIndex((block) => workBlockKeys.has(block.key)),
    entries,
  };
};
