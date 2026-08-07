import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import {
  MobileChatList,
  type MobileChatGroupBy,
  type MobileChatListRowActions,
} from '@/components/mobile/mobile-chat-list';
import type { MobileConversationItem } from '@/components/mobile/mobile-project-screen';

const hour = 60 * 60 * 1000;
const now = Date.now();

const baseChats: MobileConversationItem[] = [
  {
    id: 'pr-154',
    title: '重构评估 UI',
    kind: 'github',
    branchName: 'feat/eval-ui-overhaul',
    prNumber: 154,
    prStatus: 'open',
    prUrl: 'https://github.com/loro-dev/lody/pull/154',
    /* CI running — the PR glyph carries a static verdict dot. */
    prCiState: 'p',
    addedLines: 156,
    deletedLines: 8,
    latestMessageAt: now - 0.5 * hour,
    ageLabel: '30m',
    isWorking: true,
    machineId: 'zx-macbook',
    projectKey: 'loro-dev/lody',
    projectLabel: 'loro-dev/lody',
  },
  {
    id: 'pr-152',
    title: '合并就绪的会话',
    kind: 'github',
    branchName: 'feat/ready-to-merge',
    prNumber: 152,
    prStatus: 'open',
    prUrl: 'https://github.com/loro-dev/lody/pull/152',
    prCiState: 's',
    /* Clean merge state + green CI: the row swaps its line diff for the
       Mergeable pill (the diff numbers below are deliberately still set, to
       show that the pill takes that slot). */
    prReadiness: 'y',
    addedLines: 88,
    deletedLines: 21,
    latestMessageAt: now - 2 * hour,
    ageLabel: '2h',
    machineId: 'zx-macbook',
    projectKey: 'loro-dev/lody',
    projectLabel: 'loro-dev/lody',
  },
  {
    id: 'pr-149',
    title: 'PR 看板对齐',
    kind: 'github',
    branchName: 'fix/board-alignment',
    prNumber: 149,
    prStatus: 'merged',
    prUrl: 'https://github.com/loro-dev/lody/pull/149',
    prCiState: 's',
    /* Stale readiness left behind after the merge — the pill must not linger
       next to a merged PR. */
    prReadiness: 'y',
    addedLines: 42,
    deletedLines: 10,
    latestMessageAt: now - 5 * hour,
    ageLabel: '5h',
    machineId: 'zx-macbook',
    projectKey: 'loro-dev/lody',
    projectLabel: 'loro-dev/lody',
  },
  {
    id: 'pr-151',
    title: 'WIP 草稿评审',
    kind: 'github',
    branchName: 'feat/draft-review',
    prNumber: 151,
    prStatus: 'draft',
    /* No poller CI record yet — plain PR glyph, no verdict badge. */
    prUrl: 'https://github.com/loro-dev/lody/pull/151',
    addedLines: 73,
    deletedLines: 4,
    latestMessageAt: now - 12 * hour,
    ageLabel: '12h',
    machineId: 'zx-macbook',
    projectKey: 'loro-dev/lody',
    projectLabel: 'loro-dev/lody',
  },
  {
    id: 'pr-148',
    title: '权限对话框关闭',
    kind: 'github',
    branchName: 'fix/permission-close',
    prNumber: 148,
    prStatus: 'closed',
    prUrl: 'https://github.com/anthropic/claude-code/pull/148',
    prCiState: 'f',
    latestMessageAt: now - 28 * hour,
    ageLabel: '1d',
    machineId: 'zx-macbook',
    projectKey: 'anthropic/claude-code',
    projectLabel: 'anthropic/claude-code',
  },
  {
    id: 'local-1',
    title: '同步进度提示',
    kind: 'local',
    branchName: 'feat/sync-progress',
    latestMessageAt: now - 18 * hour,
    ageLabel: '18h',
    hasUnreadMessages: true,
    machineId: 'lab-m2',
    projectKey: 'lab-m2:experimental-app',
    projectLabel: 'experimental-app',
  },
  {
    id: 'local-2',
    title: '权限审批弹窗',
    kind: 'local',
    branchName: 'fix/permission-modal',
    latestMessageAt: now - 2 * 24 * hour,
    ageLabel: '2d',
    isWaitingPermission: true,
    machineId: 'zx-macbook',
    projectKey: 'zx-macbook:lody-cli',
    projectLabel: 'lody-cli',
  },
  {
    id: 'chat-1',
    title: '随手问 Claude 关于 fzf 配置',
    kind: 'chat',
    latestMessageAt: now - 3 * 24 * hour,
    ageLabel: '3d',
    isOffline: true,
    machineId: 'lab-m2',
  },
  {
    id: 'pinned',
    title: '🌟 旗舰会话(已置顶)',
    kind: 'github',
    branchName: 'main',
    prNumber: 142,
    prStatus: 'open',
    prUrl: 'https://github.com/loro-dev/lody/pull/142',
    /* Checks expected but not reported yet. */
    prCiState: 'x',
    isPinned: true,
    machineId: 'zx-macbook',
    projectKey: 'loro-dev/lody',
    projectLabel: 'loro-dev/lody',
  },
];

function StoryShell({
  groupBy,
  rowActions,
  flatHeading,
  archived = false,
}: {
  groupBy: MobileChatGroupBy;
  rowActions?: MobileChatListRowActions;
  flatHeading?: string;
  archived?: boolean;
}) {
  const [chats, setChats] = useState(baseChats);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const actions: MobileChatListRowActions | undefined = rowActions
    ? {
        onTogglePin: (id, nextPinned) => {
          setChats((prev) => prev.map((c) => (c.id === id ? { ...c, isPinned: nextPinned } : c)));
        },
        onArchive: (id) => {
          setChats((prev) => prev.filter((c) => c.id !== id));
        },
        /* Archived list: restore drops the row out of the archived
           view (here we just remove it from the mock list). */
        onRestore: (id) => {
          setChats((prev) => prev.filter((c) => c.id !== id));
          fn()(id);
        },
      }
    : undefined;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-200 p-0 sm:p-6">
      <div className="h-dvh w-full overflow-y-auto bg-background pb-12 shadow-2xl sm:h-[852px] sm:w-[393px] sm:rounded-[34px]">
        <div className="px-5 pb-1 pt-6 text-xl font-semibold">对话</div>
        <MobileChatList
          chats={chats}
          groupBy={groupBy}
          flatHeading={flatHeading}
          archived={archived}
          groupLabels={{
            chat: 'Chat',
            local: 'Local',
            github: 'GitHub',
            open: 'Open',
            merged: 'Merged',
            closed: 'Closed',
            'no-pr': 'No PR',
            working: 'Working',
            waiting: 'Waiting permission',
            idle: 'Idle',
            offline: 'Offline',
          }}
          selectedConversationId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            fn()(id);
          }}
          rowActions={actions}
          /* In archived mode, swipe delete + multi-select both route
             through this; remove the confirmed ids from the mock list. */
          onPermanentDelete={
            archived
              ? (ids) => {
                  setChats((prev) => prev.filter((c) => !ids.includes(c.id)));
                  ids.forEach((id) => fn()(id));
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

const meta = {
  title: 'Mobile/MobileChatList',
  component: StoryShell,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof StoryShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flat: Story = {
  args: { groupBy: 'none' },
};

export const GroupByProject: Story = {
  args: { groupBy: 'project' },
};

export const GroupByDate: Story = {
  args: { groupBy: 'date' },
};

export const WithSwipeActions: Story = {
  args: { groupBy: 'project', rowActions: {} },
};

/* Archived list: swipe a row left to reveal 恢复 (restore) + 删除
   (delete) instead of 置顶 / 归档. Delete routes through the shared
   confirm dialog; long-press still enters multi-select. */
export const Archived: Story = {
  args: { groupBy: 'none', flatHeading: '归档对话', rowActions: {}, archived: true },
};
