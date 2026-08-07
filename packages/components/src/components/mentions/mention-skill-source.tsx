import * as React from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Boxes } from 'lucide-react';
import {
  compareProjectSkillScope,
  getRegisteredGlobalSkillDirs,
  getRegisteredSkillDirs,
  getRegisteredSystemSkillDirs,
  type AgentConfigCliType,
  type ProjectSkill,
  type ProjectSkillScope,
} from '@lody/shared';
import { currentWorkspaceIdAtom } from '@/atoms';
import { MentionContent, MentionItem, useMentionContext } from '@/ui/mention';
import { useIsMentionMobile } from '@/ui/mention/mention-mobile-content';
import {
  useProjectSkills,
  type ProjectSkillsSource,
  type ProjectSkillsStatus,
} from '@/hooks/use-project-skills';
import type { MentionProjectSource } from '@/components/mentions/mention-project-file-source';
import {
  SkillScopeBadge,
  SkillSymlinkBadge,
  SkillVersionBadge,
} from '@/components/settings/skill-badges';
import { observeResizeOnAnimationFrame } from '@/lib/resize-observer';
import { cn } from '@/lib/utils';

/**
 * `$`-triggered skill mention (phase 2 of docs/project-skills.md).
 *
 * Reuses the same discovery/SWR core as the Skills display tab via
 * `useProjectSkills`: the mention reads the CURRENT session project's skills
 * (local project root + that machine user's global skills over machine RPC, or
 * GitHub default branch over the API) and inserts a `$<token>` reference into
 * the composer text.
 *
 * What is typed: selecting a candidate inserts the literal text `$<token>` into
 * the composer (same model as `@file` / `#123`). Before send, known `$<token>`
 * references expand to `use /<token> [Skill Path](...)` so the agent receives
 * the provider-filtered skill path while the composer stays compact.
 */
export const SKILL_MENTION_TRIGGER = '$';
const SKILL_MENTION_PROMPT_PREFIX = '/';
/** Label of the expanded `[Skill Path](...)` markdown link. The writer and the
   already-expanded detector both derive from this so they cannot drift. */
const SKILL_MENTION_PATH_LABEL = 'Skill Path';
const SKILL_MENTION_PATH_ANNOTATION_RE = new RegExp(`^\\s*\\[${SKILL_MENTION_PATH_LABEL}\\]\\(`);
const SKILL_MENTION_MENU_TOP_OFFSET_PX = 20;
export type SkillMentionMenuPlacement = 'above-input' | 'caret';
export type SkillMentionAgent = {
  cliType: AgentConfigCliType;
  agentType: string;
  machineId?: string;
};

export type SkillMentionItem = {
  /** The whitespace-free text inserted after `$`. */
  token: string;
  /** The skills directory this candidate came from (used to filter by the
     selected ACP provider's directories). */
  dir: string;
  scope: ProjectSkillScope;
  skill: ProjectSkill;
};

/**
 * The token inserted after `$`. Must be whitespace-free so the primitive's
 * trigger detection and the hydrator can scan `$<token>` up to the next space.
 * Prefers the frontmatter `name`; falls back to the skill directory basename
 * (always a path segment) when the name contains whitespace.
 */
export function getSkillMentionToken(skill: Pick<ProjectSkill, 'name' | 'relativePath'>): string {
  const name = skill.name.trim();
  if (name && /^\S+$/.test(name)) {
    return name;
  }
  const dir = skill.relativePath.replace(/\/SKILL\.md$/i, '');
  const base = dir.split('/').filter(Boolean).pop();
  return (base ?? name).replace(/\s+/g, '-');
}

export function buildSkillMentionItems(
  groups: ReadonlyArray<{ scope: ProjectSkillScope; dir: string; skills: readonly ProjectSkill[] }>
): SkillMentionItem[] {
  // One item per skill (NOT deduped here — duplicates/symlinks are kept so the
  // provider filter and token dedup below run over the full set).
  const items: SkillMentionItem[] = [];
  for (const group of groups) {
    for (const skill of group.skills) {
      const token = getSkillMentionToken(skill);
      if (!token) {
        continue;
      }
      items.push({ token, dir: group.dir, scope: group.scope, skill });
    }
  }
  return items.sort((left, right) => {
    if (left.token !== right.token) {
      return left.token.localeCompare(right.token);
    }
    if (left.scope !== right.scope) {
      return compareProjectSkillScope(left.scope, right.scope);
    }
    return left.dir.localeCompare(right.dir);
  });
}

/**
 * Picks the candidates shown in the `$` menu:
 *  1. Provider filter — when an ACP provider is selected, keep only skills from
 *     the directories that provider uses (`allowedDirs`); null = show all.
 *  2. Dedupe by token — the same `$<token>` surfaced from multiple dirs appears
 *     once (the inserted text is identical either way).
 *  3. Term filter + rank — prefix > substring > path match.
 */
export function selectSkillMentionCandidates(
  items: readonly SkillMentionItem[],
  term: string,
  allowedDirs: ReadonlySet<string> | null
): SkillMentionItem[] {
  const scoped = allowedDirs
    ? items.filter((item) => isSkillMentionDirAllowed(item.dir, allowedDirs))
    : items;
  const seen = new Set<string>();
  const deduped: SkillMentionItem[] = [];
  for (const item of scoped) {
    if (seen.has(item.token)) {
      continue;
    }
    seen.add(item.token);
    deduped.push(item);
  }

  const query = term.trim().toLowerCase();
  if (!query) {
    return deduped;
  }
  return deduped
    .map((item) => {
      const token = item.token.toLowerCase();
      const name = item.skill.name.toLowerCase();
      const path = item.skill.relativePath.toLowerCase();
      let score = -1;
      if (token.startsWith(query) || name.startsWith(query)) {
        score = 0;
      } else if (token.includes(query) || name.includes(query)) {
        score = 1;
      } else if (path.includes(query)) {
        score = 2;
      }
      return { item, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.item.token.localeCompare(b.item.token))
    .map((entry) => entry.item);
}

function isSkillMentionDirAllowed(dir: string, allowedDirs: ReadonlySet<string>): boolean {
  if (allowedDirs.has(dir)) {
    return true;
  }
  for (const allowedDir of allowedDirs) {
    if (dir.startsWith(`${allowedDir}/`)) {
      return true;
    }
  }
  return false;
}

export function getAllowedSkillMentionDirs(
  skillAgent: { cliType?: AgentConfigCliType; agentType?: string } | undefined
): ReadonlySet<string> | null {
  if (!skillAgent?.cliType || !skillAgent.agentType) {
    return null;
  }
  const agent = { cliType: skillAgent.cliType, agentType: skillAgent.agentType };
  return new Set([
    ...getRegisteredSkillDirs([agent]),
    ...getRegisteredGlobalSkillDirs([agent]),
    ...getRegisteredSystemSkillDirs([agent]),
  ]);
}

function getSkillMentionReferencePath(item: SkillMentionItem): string {
  // Home-scoped skills (global + system) expand to their absolute SKILL.md path;
  // project skills use the project-relative path.
  if (item.scope !== 'project') {
    return item.skill.absolutePath ?? item.skill.relativePath;
  }
  return item.skill.relativePath;
}

function formatSkillPathMarkdownDestination(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
}

function buildSkillMentionPathByToken(
  items: readonly SkillMentionItem[],
  allowedDirs: ReadonlySet<string> | null
): Map<string, string> {
  const pathByToken = new Map<string, string>();
  for (const item of selectSkillMentionCandidates(items, '', allowedDirs)) {
    pathByToken.set(item.token, getSkillMentionReferencePath(item));
  }
  return pathByToken;
}

/** Walk every `$<token>` span in `text` (whitespace-free, the shared skill
   mention trigger rule). `visit` returns `true` once it has consumed the token
   so scanning resumes after it, or `false` to advance a single char (so a
   nested `$` inside an unmatched run can still be found). */
function forEachSkillMentionSpan(
  text: string,
  visit: (span: { token: string; start: number; tokenEnd: number }) => boolean
): void {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== SKILL_MENTION_TRIGGER) {
      continue;
    }
    let tokenEnd = index + SKILL_MENTION_TRIGGER.length;
    while (tokenEnd < text.length) {
      const ch = text[tokenEnd];
      if (!ch || ch === ' ' || ch === '\n' || ch === '\t') {
        break;
      }
      tokenEnd += 1;
    }
    const token = text.slice(index + SKILL_MENTION_TRIGGER.length, tokenEnd);
    if (visit({ token, start: index, tokenEnd })) {
      index = tokenEnd - 1;
    }
  }
}

export function expandSkillMentionsInText(
  text: string,
  items: readonly SkillMentionItem[],
  allowedDirs: ReadonlySet<string> | null
): string {
  if (!text.includes(SKILL_MENTION_TRIGGER) || items.length === 0) {
    return text;
  }

  const pathByToken = buildSkillMentionPathByToken(items, allowedDirs);
  if (pathByToken.size === 0) {
    return text;
  }

  let result = '';
  let lastCopiedIndex = 0;

  forEachSkillMentionSpan(text, ({ token, start, tokenEnd }) => {
    const path = token ? pathByToken.get(token) : undefined;
    if (!path) {
      return false;
    }
    // Already expanded (idempotent re-send) — skip the token, leave it as-is.
    if (SKILL_MENTION_PATH_ANNOTATION_RE.test(text.slice(tokenEnd))) {
      return true;
    }
    result += text.slice(lastCopiedIndex, start);
    result += `use ${SKILL_MENTION_PROMPT_PREFIX}${token} [${SKILL_MENTION_PATH_LABEL}](${formatSkillPathMarkdownDestination(path)})`;
    lastCopiedIndex = tokenEnd;
    return true;
  });

  // When nothing matched, lastCopiedIndex stays 0 and this returns `text` verbatim.
  return result + text.slice(lastCopiedIndex);
}

function hasProjectSkillSource(source: MentionProjectSource | undefined): boolean {
  if (source?.kind === 'local') {
    return Boolean(source.localProjectId && source.workspaceId && source.machineId);
  }
  if (source?.kind === 'github') {
    return Boolean(source.repoFullName);
  }
  if (source?.kind === 'provider') {
    return Boolean(source.githubRepoFullName);
  }
  return false;
}

export function useSkillMentionPromptExpansion(
  source: MentionProjectSource | undefined,
  skillAgent: SkillMentionAgent | undefined,
  promptValue: string
): (text: string) => string {
  const enableSkillMentions = hasProjectSkillSource(source) || Boolean(skillAgent?.machineId);
  const enabled = enableSkillMentions && promptValue.includes(SKILL_MENTION_TRIGGER);
  const { skillItems } = useMentionProjectSkills(source, enabled, skillAgent?.machineId);
  const skillAgentCliType = skillAgent?.cliType;
  const skillAgentAgentType = skillAgent?.agentType;
  const allowedDirs = React.useMemo(
    () =>
      getAllowedSkillMentionDirs({ cliType: skillAgentCliType, agentType: skillAgentAgentType }),
    [skillAgentAgentType, skillAgentCliType]
  );

  return React.useCallback(
    (text: string) => expandSkillMentionsInText(text, skillItems, allowedDirs),
    [allowedDirs, skillItems]
  );
}

export function hydrateSkillMentionsFromText(
  text: string,
  knownTokens: ReadonlySet<string>
): { mentions: Array<{ value: string; start: number; end: number }>; values: string[] } {
  const mentions: Array<{ value: string; start: number; end: number }> = [];
  const values = new Set<string>();
  forEachSkillMentionSpan(text, ({ token, start, tokenEnd }) => {
    if (!token || !knownTokens.has(token)) {
      return false;
    }
    mentions.push({ value: token, start, end: tokenEnd });
    values.add(token);
    return true;
  });
  return { mentions, values: Array.from(values) };
}

/** Collapse the project + global SWR states into the single status/error the
   `$` menu renders. `idle` (a disabled source — e.g. global skipped for a local
   chat, or project skipped for a plain-agent chat) is ignored so the menu
   reflects whichever scopes are actually fetching. */
function mergeMentionSkillState(
  states: ReadonlyArray<{ status: ProjectSkillsStatus; error?: string }>
): { status: ProjectSkillsStatus; error?: string } {
  const active = states.filter((state) => state.status !== 'idle');
  if (active.length === 0) {
    return { status: 'idle' };
  }
  if (active.some((state) => state.status === 'loading')) {
    return { status: 'loading' };
  }
  if (active.some((state) => state.status === 'refreshing')) {
    return { status: 'refreshing' };
  }
  if (active.every((state) => state.status === 'error')) {
    return { status: 'error', error: active.find((state) => state.error)?.error };
  }
  return { status: 'ready' };
}

/**
 * Resolves the current chat's skills for the mention.
 *
 * - Project scope: the local project root (machine RPC) or the GitHub default
 *   branch (API), from the mention `source`.
 * - Global scope: the skills of the machine the chat runs on (`globalMachineId`,
 *   e.g. `session.machineId` / the selected agent's machine). Surfaced for ALL
 *   chat kinds so a GitHub-project or plain-agent chat still offers the machine's
 *   global skills — not just local-project chats. For a `local` source we skip
 *   the separate global fetch because its own scan already includes that
 *   machine's globals (avoids double-listing).
 *
 * Gated by `enabled` so we only scan/fetch once the user actually engages the
 * `$` trigger (or a draft already contains a `$` token), mirroring the display
 * tab's lazy SWR.
 */
export function useMentionProjectSkills(
  source: MentionProjectSource | undefined,
  enabled: boolean,
  globalMachineId?: string | null
) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const kind = source?.kind;
  const localWorkspaceId = source?.kind === 'local' ? source.workspaceId : undefined;
  const machineId = source?.kind === 'local' ? source.machineId : undefined;
  const localProjectId = source?.kind === 'local' ? source.localProjectId : undefined;
  const repoFullName =
    source?.kind === 'github'
      ? source.repoFullName
      : source?.kind === 'provider'
        ? source.githubRepoFullName
        : undefined;

  const skillsSource = React.useMemo<ProjectSkillsSource | null>(() => {
    if (!enabled) {
      return null;
    }
    if (kind === 'local') {
      if (!localWorkspaceId || !machineId || !localProjectId) {
        return null;
      }
      return { kind: 'local', workspaceId: localWorkspaceId, machineId, localProjectId };
    }
    if (!repoFullName || !workspaceId) {
      return null;
    }
    return { kind: 'github', workspaceId, repoFullName };
  }, [enabled, kind, localWorkspaceId, machineId, localProjectId, repoFullName, workspaceId]);

  const globalSkillsSource = React.useMemo<ProjectSkillsSource | null>(() => {
    if (!enabled) {
      return null;
    }
    // A local source's own scan already lists its machine's global skills.
    if (kind === 'local') {
      return null;
    }
    const normalizedMachineId = globalMachineId?.trim();
    if (!normalizedMachineId || !workspaceId) {
      return null;
    }
    return { kind: 'global', workspaceId, machineId: normalizedMachineId };
  }, [enabled, kind, globalMachineId, workspaceId]);

  const projectSkillState = useProjectSkills(skillsSource);
  const globalSkillState = useProjectSkills(globalSkillsSource);

  const groups = React.useMemo(
    () => [...projectSkillState.groups, ...globalSkillState.groups],
    [projectSkillState.groups, globalSkillState.groups]
  );
  const skillState = React.useMemo(
    () => mergeMentionSkillState([projectSkillState, globalSkillState]),
    [projectSkillState, globalSkillState]
  );
  const skillItems = React.useMemo(() => buildSkillMentionItems(groups), [groups]);
  // All tokens (provider-agnostic) so hydration keeps an inserted `$token`
  // highlighted even after switching to a provider that wouldn't offer it.
  const knownSkillTokens = React.useMemo(
    () => new Set(skillItems.map((item) => item.token)),
    [skillItems]
  );
  return { skillState, skillItems, knownSkillTokens };
}

// ============================================================================
// Hydrator
// ============================================================================

export function SkillMentionHydrator({
  text,
  knownTokens,
  enabled,
}: {
  text: string;
  knownTokens: ReadonlySet<string>;
  enabled: boolean;
}) {
  const context = useMentionContext('SkillMentionHydrator');
  const initialTextRef = React.useRef(text);
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) return;
    if (hydratedRef.current) return;
    const initialText = initialTextRef.current;
    if (!initialText) return;
    if (text !== initialText) return;
    if (knownTokens.size === 0) return;
    if (context.open) return;

    const hydrated = hydrateSkillMentionsFromText(initialText, knownTokens);
    if (hydrated.mentions.length === 0) return;

    hydratedRef.current = true;
    context.onMentionsChange((prev) => {
      const merged = [...prev, ...hydrated.mentions].sort((a, b) => a.start - b.start);
      const seen = new Set<string>();
      return merged.filter((mention) => {
        const key = `${mention.start}:${mention.end}:${mention.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    context.onValueChange((prev) => Array.from(new Set([...(prev ?? []), ...hydrated.values])));
  }, [context, enabled, knownTokens, text]);

  return null;
}

// ============================================================================
// Menu
// ============================================================================

function SkillDetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground/70">{label}</dt>
      <dd className={cn('min-w-0 break-words text-muted-foreground', mono && 'font-mono')}>
        {value}
      </dd>
    </div>
  );
}

/** Left-hand card: the scrollable name-only candidate list. Its own height so
   it does not share/stretch with the detail card beside it. */
function SkillMentionList({ children }: { children: React.ReactNode }) {
  return (
    <div className="scrollbar-pro max-h-[min(340px,55vh)] w-[184px] min-w-[160px] shrink-0 overflow-y-auto rounded-md rounded-r-none border border-border bg-popover py-1 text-popover-foreground shadow-md">
      {children}
    </div>
  );
}

/** Right-hand card: full content for the highlighted/hovered skill. Independent
   height + scroll from the list card. */
function SkillMentionDetail({ item }: { item: SkillMentionItem }) {
  const { t } = useTranslation();
  const { skill, scope } = item;
  return (
    <div className="scrollbar-pro -ml-px flex max-h-[min(340px,55vh)] min-w-0 flex-1 flex-col overflow-y-auto rounded-md rounded-l-none border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-md">
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{skill.name}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <SkillScopeBadge scope={scope} size="sm" className="shrink-0" />
        {skill.version ? <SkillVersionBadge version={skill.version} size="sm" /> : null}
        {skill.isSymlink ? <SkillSymlinkBadge size="sm" withTooltip={false} /> : null}
      </div>
      {skill.description ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {skill.description}
        </p>
      ) : null}
      <dl className="mt-2.5 flex flex-col gap-1 text-[11px]">
        {skill.author ? (
          <SkillDetailRow
            label={t('workspace.projects.skills.mention.detailAuthor', 'Author')}
            value={skill.author}
          />
        ) : null}
        <SkillDetailRow
          label={t('workspace.projects.skills.mention.detailPath', 'Path')}
          value={skill.relativePath}
          mono
        />
        {skill.symlinkTarget ? (
          <SkillDetailRow
            label={t('workspace.projects.skills.mention.detailLinksTo', 'Links to')}
            value={skill.symlinkTarget}
            mono
          />
        ) : null}
      </dl>
    </div>
  );
}

export function SkillMentionMenu({
  skillItems,
  status,
  error,
  allowedDirs,
  placement = 'above-input',
}: {
  skillItems: SkillMentionItem[];
  status: ReturnType<typeof useProjectSkills>['status'];
  error?: string;
  /** Directories the selected ACP provider uses; null = no provider filter. */
  allowedDirs: ReadonlySet<string> | null;
  /** `caret` uses MentionContent's default bottom/caret placement and top-aligns panes. */
  placement?: SkillMentionMenuPlacement;
}) {
  const context = useMentionContext('SkillMentionMenu');
  const { t } = useTranslation();
  const isMobile = useIsMentionMobile();
  const trigger = context.trigger;
  const searchTerm = trigger === SKILL_MENTION_TRIGGER ? context.filterStore.search : '';

  const filtered = React.useMemo(() => {
    if (trigger !== SKILL_MENTION_TRIGGER) return [];
    return selectSkillMentionCandidates(skillItems, searchTerm, allowedDirs);
  }, [skillItems, searchTerm, trigger, allowedDirs]);

  // Match the desktop popover width to the composer input so the two-pane menu
  // reads as part of the input. Tracked via ResizeObserver; capped to the
  // viewport by `max-w` on the content.
  //
  // Gated on the `$` menu actually being up. This component renders `null` for
  // every other trigger (see the early return below), so an ungated layout
  // effect measured the composer on EVERY composer mount — including each
  // session switch, where it forced a full synchronous style recalc of the
  // freshly mounted conversation (~25ms per switch in a DevTools trace) for a
  // width nothing ever read.
  const inputRef = context.inputRef;
  const menuActive = context.open && trigger === SKILL_MENTION_TRIGGER;
  const [anchorWidth, setAnchorWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!menuActive) return undefined;
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setAnchorWidth(el.getBoundingClientRect().width || null);
    measure();
    return observeResizeOnAnimationFrame(el, () => measure());
  }, [inputRef, menuActive]);

  const autoHighlightKey = `${searchTerm}\0${filtered[0]?.token ?? ''}\0${filtered.length}`;
  const lastAutoHighlightKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!context.open || trigger !== SKILL_MENTION_TRIGGER) {
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

  if (trigger !== SKILL_MENTION_TRIGGER) return null;

  const isInitialLoading = status === 'loading' && skillItems.length === 0;
  let message: string | null = null;
  let messageIsError = false;
  if (isInitialLoading) {
    message = t('workspace.projects.skills.mention.loading', 'Loading skills…');
  } else if (status === 'error' && skillItems.length === 0) {
    message = error ?? t('workspace.projects.skills.mention.error', 'Failed to load skills.');
    messageIsError = true;
  } else if (filtered.length === 0) {
    message = t('workspace.projects.skills.mention.empty', 'No matching skills');
  }

  const desktopPositionProps =
    placement === 'above-input'
      ? {
          positionAnchor: 'input-top' as const,
          side: 'top' as const,
          sideOffset: SKILL_MENTION_MENU_TOP_OFFSET_PX,
          avoidCollisions: false,
        }
      : {};
  const desktopPaneAlignmentClassName = placement === 'caret' ? 'items-start' : 'items-end';

  if (message) {
    return (
      <MentionContent
        {...desktopPositionProps}
        className="w-max max-w-[min(360px,var(--mention-input-width),calc(100vw-2rem))]"
      >
        <div
          className={cn(
            'px-2 py-1.5 text-sm',
            messageIsError ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {message}
        </div>
      </MentionContent>
    );
  }

  // Compact rows: just the skill name. Details live in the desktop side panel;
  // mobile (no hover) shows the plain name list only.
  const listRows = filtered.map((item) => (
    <MentionItem key={item.token} value={item.token} label={item.token}>
      <Boxes className="h-4 w-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.token}</span>
    </MentionItem>
  ));

  // Mobile (docked full-width panel, no hover): a plain name-only list. No side
  // detail panel — it would not fit the narrow docked strip and there is no
  // hover/keyboard affordance to preview it.
  if (isMobile) {
    return (
      <MentionContent className="w-max max-w-[min(var(--mention-input-width),calc(100vw-2rem))]">
        <div className="scrollbar-pro max-h-[min(320px,48vh)] overflow-y-auto">{listRows}</div>
      </MentionContent>
    );
  }

  // Desktop two-pane: compact list on the left, a detail panel on the right
  // that previews the highlighted (hover or keyboard) skill.
  const highlightedToken = context.highlightedItem?.value ?? null;
  const detailItem =
    filtered.find((item) => item.token === highlightedToken) ?? filtered[0] ?? null;

  // Two independent cards (list + detail) side by side: the MentionContent
  // wrapper is neutralized to a transparent flex container so each card carries
  // its own border / shadow / height and the two never share a height.
  return (
    <MentionContent
      {...desktopPositionProps}
      className={cn(
        'flex w-[min(640px,var(--mention-input-width),calc(100vw-2rem))]',
        'max-w-[min(var(--mention-input-width),calc(100vw-2rem))]',
        desktopPaneAlignmentClassName,
        'overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none'
      )}
      style={anchorWidth ? { width: anchorWidth } : undefined}
    >
      <SkillMentionList>{listRows}</SkillMentionList>
      {detailItem ? <SkillMentionDetail item={detailItem} /> : null}
    </MentionContent>
  );
}
