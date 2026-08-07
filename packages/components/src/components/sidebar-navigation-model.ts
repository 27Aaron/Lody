import type { SidebarNavItem } from '@/atoms/focus-layer';
import type { SidebarOrganizeMode } from '@/atoms/sidebar-state';
import {
  buildGroups,
  getVisibleSessionGroupRows,
  MAX_VISIBLE_SESSIONS,
  type SessionRowGroup,
  type SessionListRepoState,
  type SessionListRow,
} from '@/components/session-list';
import {
  getVisibleUpdatedItems,
  sortUpdatedItems,
  type SidebarUpdatedItem,
} from '@/components/sidebar-updated-session-list';

type SidebarNavigationLocalProject = {
  machineId: string;
  localProjectId: string;
  collapsed: boolean;
  sessions: Array<{ id: string }>;
};

export type SidebarNavigationLocalSection = {
  collapsed: boolean;
  projects: SidebarNavigationLocalProject[];
};

export type SidebarNavigationModelOptions = {
  organizeMode: SidebarOrganizeMode;
  showFullSessionGroups: Record<string, boolean>;
  pinnedItems: SidebarUpdatedItem[];
  pinnedSectionCollapsed: boolean;
  workspace: {
    localSections: SidebarNavigationLocalSection[];
    githubSectionCollapsed: boolean;
    repoSessions: SessionListRow[];
    repos: SessionListRepoState[];
    chatSessions: SessionListRow[];
    chatsCollapsed: boolean;
  };
  updated: {
    items: SidebarUpdatedItem[];
    collapsed: boolean;
    showFull: boolean;
  };
};

function emitSessionGroup(
  items: SidebarNavItem[],
  group: SessionRowGroup,
  showFullSessionGroups: Record<string, boolean>
): void {
  items.push({ kind: 'group-header', groupKey: group.key, collapsed: group.collapsed });
  if (group.collapsed) return;

  const showFull = showFullSessionGroups[group.key] ?? false;
  for (const session of getVisibleSessionGroupRows(group, showFull)) {
    items.push({ kind: 'session', sessionId: session.sessionId, groupKey: group.key });
  }

  if (group.sessions.length > MAX_VISIBLE_SESSIONS) {
    items.push({ kind: 'show-more', groupKey: group.key, expanded: showFull });
  }
}

function emitLocalSections(
  items: SidebarNavItem[],
  sections: SidebarNavigationLocalSection[]
): void {
  for (const section of sections) {
    if (section.collapsed) continue;
    for (const project of section.projects) {
      const projectKey = `${project.machineId}:${project.localProjectId}`;
      items.push({
        kind: 'local-project',
        machineId: project.machineId,
        localProjectId: project.localProjectId,
        collapsed: project.collapsed,
      });
      if (project.collapsed) continue;
      for (const session of project.sessions) {
        items.push({ kind: 'session', sessionId: session.id, groupKey: projectKey });
      }
    }
  }
}

export function buildSidebarNavigationItems({
  organizeMode,
  showFullSessionGroups,
  pinnedItems,
  pinnedSectionCollapsed,
  workspace,
  updated,
}: SidebarNavigationModelOptions): SidebarNavItem[] {
  const items: SidebarNavItem[] = [];

  if (!pinnedSectionCollapsed) {
    for (const item of sortUpdatedItems(pinnedItems)) {
      items.push({ kind: 'session', sessionId: item.id, groupKey: '__pinned__' });
    }
  }

  if (organizeMode === 'updated') {
    if (updated.collapsed) return items;
    const orderedItems = sortUpdatedItems(updated.items);
    for (const item of getVisibleUpdatedItems(orderedItems, true, updated.showFull)) {
      items.push({ kind: 'session', sessionId: item.id, groupKey: '__updated__' });
    }
    return items;
  }

  emitLocalSections(items, workspace.localSections);

  if (!workspace.githubSectionCollapsed) {
    for (const group of buildGroups(workspace.repoSessions, workspace.repos, false)) {
      emitSessionGroup(items, group, showFullSessionGroups);
    }
  }

  for (const group of buildGroups(workspace.chatSessions, [], workspace.chatsCollapsed)) {
    emitSessionGroup(items, group, showFullSessionGroups);
  }

  return items;
}
