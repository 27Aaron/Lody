import { describe, expect, it } from 'vitest';

import { ONLY_CHATS_KEY, type SidebarNavItem } from '../src/atoms/focus-layer';
import { buildSidebarNavigationItems } from '../src/components/sidebar-navigation-model';
import type { SidebarUpdatedItem } from '../src/components/sidebar-updated-task-list';
import type { SessionListRow } from '../src/components/session-list';

function sessionRow(sessionId: string, latestMessageAt: string, repoFullName?: string): SessionListRow {
  return {
    sessionId,
    title: sessionId,
    repoFullName,
    branchName: '',
    latestMessageAt,
    addedLines: 0,
    deletedLines: 0,
    isWorking: false,
    hasUnreadMessages: false,
    isOffline: false,
    isWaitingPermission: false,
  };
}

function updatedItem(id: string, latestMessageAt: string): SidebarUpdatedItem {
  return {
    id,
    kind: 'chat',
    title: id,
    sectionLabel: 'Chats',
    latestMessageAt,
  };
}

function sessionIds(items: SidebarNavItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'session' ? [item.sessionId] : []));
}

const baseOptions = {
  organizeMode: 'workspace' as const,
  showFullSessionGroups: {},
  pinnedItems: [] as SidebarUpdatedItem[],
  pinnedSectionCollapsed: false,
  workspace: {
    localSections: [],
    githubSectionCollapsed: false,
    repoSessions: [] as SessionListRow[],
    repos: [],
    chatSessions: [] as SessionListRow[],
    chatsCollapsed: false,
  },
  updated: {
    items: [] as SidebarUpdatedItem[],
    collapsed: false,
    showFull: false,
  },
};

describe('sidebar navigation model', () => {
  it('follows the rendered Workspace order with Chats last', () => {
    const items = buildSidebarNavigationItems({
      ...baseOptions,
      pinnedItems: [updatedItem('pinned', '2026-07-16T12:00:00Z')],
      workspace: {
        localSections: [
          {
            collapsed: false,
            projects: [
              {
                machineId: 'machine',
                localProjectId: 'project',
                collapsed: false,
                sessions: [{ id: 'local-new' }, { id: 'local-old' }],
              },
            ],
          },
        ],
        githubSectionCollapsed: false,
        repoSessions: [
          sessionRow('repo-old', '2026-07-16T08:00:00Z', 'loro-dev/lody'),
          sessionRow('repo-new', '2026-07-16T11:00:00Z', 'loro-dev/lody'),
        ],
        repos: [{ repoFullName: 'loro-dev/lody', collapsed: false }],
        chatSessions: [
          sessionRow('chat-old', '2026-07-16T07:00:00Z'),
          sessionRow('chat-new', '2026-07-16T10:00:00Z'),
        ],
        chatsCollapsed: false,
      },
    });

    expect(sessionIds(items)).toEqual([
      'pinned',
      'local-new',
      'local-old',
      'repo-new',
      'repo-old',
      'chat-new',
      'chat-old',
    ]);
    expect(items.at(-3)).toEqual({
      kind: 'group-header',
      groupKey: ONLY_CHATS_KEY,
      collapsed: false,
    });
  });

  it('uses the Updated projection instead of stale Workspace grouping', () => {
    const items = buildSidebarNavigationItems({
      ...baseOptions,
      organizeMode: 'updated',
      pinnedItems: [updatedItem('pinned', '2026-07-16T09:00:00Z')],
      workspace: {
        ...baseOptions.workspace,
        chatSessions: [sessionRow('workspace-only', '2026-07-16T12:00:00Z')],
      },
      updated: {
        items: [
          updatedItem('updated-old', '2026-07-16T08:00:00Z'),
          updatedItem('updated-new', '2026-07-16T11:00:00Z'),
        ],
        collapsed: false,
        showFull: false,
      },
    });

    expect(sessionIds(items)).toEqual(['pinned', 'updated-new', 'updated-old']);
  });

  it('matches collapsed sections and each list preview limit', () => {
    const repoSessions = Array.from({ length: 6 }, (_, index) =>
      sessionRow(`repo-${index}`, `2026-07-16T${String(index).padStart(2, '0')}:00:00Z`, 'repo')
    );
    const updatedItems = Array.from({ length: 21 }, (_, index) =>
      updatedItem(`updated-${index}`, `2026-07-16T${String(index).padStart(2, '0')}:00:00Z`)
    );

    const workspaceItems = buildSidebarNavigationItems({
      ...baseOptions,
      workspace: {
        localSections: [
          {
            collapsed: true,
            projects: [
              {
                machineId: 'machine',
                localProjectId: 'hidden-project',
                collapsed: false,
                sessions: [{ id: 'hidden-local' }],
              },
            ],
          },
        ],
        githubSectionCollapsed: false,
        repoSessions,
        repos: [{ repoFullName: 'repo', collapsed: false }],
        chatSessions: [sessionRow('hidden-chat', '2026-07-16T12:00:00Z')],
        chatsCollapsed: true,
      },
    });
    expect(sessionIds(workspaceItems)).toEqual(['repo-5', 'repo-4', 'repo-3', 'repo-2', 'repo-1']);

    const updatedPreview = buildSidebarNavigationItems({
      ...baseOptions,
      organizeMode: 'updated',
      updated: { items: updatedItems, collapsed: false, showFull: false },
    });
    expect(sessionIds(updatedPreview)).toHaveLength(20);

    const updatedCollapsed = buildSidebarNavigationItems({
      ...baseOptions,
      organizeMode: 'updated',
      pinnedItems: [updatedItem('pinned', '2026-07-16T12:00:00Z')],
      updated: { items: updatedItems, collapsed: true, showFull: true },
    });
    expect(sessionIds(updatedCollapsed)).toEqual(['pinned']);
  });
});
