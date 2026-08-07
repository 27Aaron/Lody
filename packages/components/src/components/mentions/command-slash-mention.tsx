import * as React from 'react';
import { useAtomValue } from 'jotai';
import { usePostHog } from '@posthog/react';
import type { AcpCommandSummary } from '@lody/shared';
import { currentWorkspaceIdAtom } from '@/atoms';
import { MentionContent, MentionItem, useMentionContext } from '@/ui/mention';
import { filterAndRankSlashCommands } from '@/lib/command-slash-search';
import {
  captureMentionCommandMenuEmpty,
  captureMentionCommandMenuOpen,
  captureMentionCommandSelect,
  type MentionSurface,
} from '@/components/mentions/mention-analytics';

// ============================================================================
// CommandSlashMentionMenu
// ============================================================================

export function CommandSlashMentionMenu({
  commands,
  surface = 'unknown',
}: {
  commands: AcpCommandSummary[];
  surface?: MentionSurface;
}) {
  const context = useMentionContext('CommandSlashMentionMenu');
  const trigger = context.trigger;
  const postHog = usePostHog();
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);

  const searchTerm = trigger === '/' ? context.filterStore.search : '';

  const filtered = React.useMemo(() => {
    if (trigger !== '/') return [];
    return filterAndRankSlashCommands(commands, searchTerm);
  }, [commands, searchTerm, trigger]);

  const analyticsBase = React.useMemo(() => ({ workspaceId, surface }), [workspaceId, surface]);

  // One `menu_open` per open of the /command menu (tier B). Reset when it closes.
  const menuOpenTrackedRef = React.useRef(false);
  React.useEffect(() => {
    if (!context.open || trigger !== '/') {
      menuOpenTrackedRef.current = false;
      return;
    }
    if (menuOpenTrackedRef.current) return;
    menuOpenTrackedRef.current = true;
    captureMentionCommandMenuOpen(postHog, analyticsBase, {
      itemsCount: filtered.length,
      termLength: searchTerm.length,
    });
  }, [analyticsBase, context.open, filtered.length, postHog, searchTerm.length, trigger]);

  // Empty-state once results settle. Debounced and emitted at most once per
  // empty-results episode so typing does not flood PostHog.
  const emptyTrackedForOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (!context.open || trigger !== '/') {
      emptyTrackedForOpenRef.current = false;
      return undefined;
    }
    if (filtered.length > 0) {
      emptyTrackedForOpenRef.current = false;
      return undefined;
    }
    if (emptyTrackedForOpenRef.current) return undefined;
    const timeoutId = window.setTimeout(() => {
      emptyTrackedForOpenRef.current = true;
      captureMentionCommandMenuEmpty(postHog, analyticsBase, {
        termLength: searchTerm.length,
        commandCount: commands.length,
      });
    }, 750);
    return () => window.clearTimeout(timeoutId);
  }, [analyticsBase, commands.length, context.open, filtered.length, postHog, searchTerm, trigger]);

  const autoHighlightKey = `${searchTerm}\0${filtered[0]?.name ?? ''}\0${filtered.length}`;
  const lastAutoHighlightKeyRef = React.useRef<string | null>(null);

  // Auto-highlight the first ranked item when the query/result set changes.
  React.useEffect(() => {
    if (!context.open || trigger !== '/') {
      lastAutoHighlightKeyRef.current = null;
      return;
    }
    if (lastAutoHighlightKeyRef.current === autoHighlightKey) return;
    lastAutoHighlightKeyRef.current = autoHighlightKey;

    const items = context.getEnabledItems();
    if (!items.length) return;
    requestAnimationFrame(() => {
      const first = items[0] ?? null;
      if (first) context.onHighlightedItemChange(first);
    });
  }, [autoHighlightKey, context, trigger]);

  if (trigger !== '/') return null;

  return (
    <MentionContent className="w-max max-w-[min(400px,var(--mention-input-width),calc(100vw-2rem))]">
      {filtered.length > 0 ? (
        <div className="scrollbar-pro max-h-[260px] overflow-auto">
          {filtered.map((cmd, index) => (
            <MentionItem
              key={cmd.name}
              value={cmd.name}
              label={cmd.name}
              onMentionSelect={() => {
                captureMentionCommandSelect(postHog, analyticsBase, {
                  commandName: cmd.name,
                  rank: index,
                  termLength: searchTerm.length,
                });
              }}
            >
              <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
                <span className="text-sm font-medium">/{cmd.name}</span>
                {cmd.description ? (
                  <span className="truncate text-xs text-muted-foreground">{cmd.description}</span>
                ) : null}
              </div>
            </MentionItem>
          ))}
        </div>
      ) : (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">No results</div>
      )}
    </MentionContent>
  );
}
