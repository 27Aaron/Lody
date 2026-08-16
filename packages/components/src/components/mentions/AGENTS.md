# src/components/mentions

Product-level mention sources built on `src/ui/mention`.

## Invariants

- `@` reaches every mention type through the two-level menu. Skills also retain
  their direct `$` menu for compatibility, and `/` still opens commands
  directly because a slash command must own the whole prompt. `#` does not open
  a menu, but its hydrator remains so hand-typed or pasted `#123` is highlighted
  and expands before send.
- Desktop mention menus should render through `MentionContent` and cap width with
  `var(--mention-input-width)` so menus stay inside the composer/input range.
- `$` skill tokens must remain whitespace-free; hydration scans from `$` to the
  next whitespace.
- `$` skill candidates come from `useProjectSkills`, not Codex's runtime skill
  registry. One CLI `list-global-skills` home scan returns two scopes: `global`
  (user-authored, over `ALL_KNOWN_GLOBAL_SKILL_DIRS`) and `system` (agent
  built-ins, over `ALL_KNOWN_SYSTEM_SKILL_DIRS`, e.g. `~/.codex/skills/.system`),
  each filtered by the provider's `getRegisteredGlobalSkillDirs` /
  `getRegisteredSystemSkillDirs`. `~/.agents/skills` is a provider-specific
  alias, not a universal fallback: only providers with verified support register
  it. The scanner handles flat `~/<agent>/skills/<skill>/SKILL.md` and catalog
  `~/<agent>/skills/<category>/<skill>/SKILL.md`; paths outside the provider's
  registered roots (e.g. plugin caches) appear only once their dirs are added.
- Before send, known `$` skill tokens are expanded in prompt text to
  `use /token [Skill Path](path)`. Project skills use their project-relative
  `SKILL.md` path; home-scoped (`global` + `system`) skills use the CLI-provided
  absolute `SKILL.md` path. Display order is project → global → system
  (`compareProjectSkillScope`).
- Hydrators should only add ranges for known tokens/items and should preserve
  existing external `pasted_text` mention ranges. Every hydrator must record a
  `kind` — `HydratedMentions` requires it — because both the chip resolver and
  the before-send rewrite dispatch on it, so a kindless range renders without
  its icon and, for sessions, silently stops expanding.
- A composer stores its mention ranges with its draft and restores them through
  `PersistedMentionHydrator`. Rebuilding from text is the fallback, not the
  mechanism: it needs the source loaded, so a mention spent every return looking
  like plain text and never came back at all if the source never loaded. Store
  the narrow `PersistedMentionRange`, never the live range — that carries
  callbacks, which `JSON.stringify` writes as `{}`. What makes it a fallback is
  `mergeHydratedMentions`: a hydrated range that OVERLAPS one already present is
  dropped, not just an exact duplicate. Since a session and a path are now the
  same shape, two sources can each claim `@fix-ci` at different ends, and only
  rejecting overlaps keeps the restored range authoritative.
- A composer that swaps drafts in place (the session one does — it switches
  session without remounting) must pass `draftKey`. Otherwise a swap is
  indistinguishable from a very large edit: the outgoing draft's ranges stay
  committed and land on the incoming text at their old offsets, and hydration —
  which arms once per mount — has already fired, so the incoming draft's own
  mentions never appear. The reset runs during render, so the stale ranges are
  never painted, not even for a frame.
- Hydration latches the first NON-EMPTY text, not the first render's. A
  persisted draft is not there on mount: `atomWithStorage` initialises with its
  default and reads storage in `onMount`, so latching at mount latches `''` and
  the "only hydrate the text I measured" guard never passes again.
- A `MentionCandidate`'s `insertText` must keep its type's existing prompt form
  (`@path`, `#123`, `$token`, `/cmd`). Reaching a type through `@` must not
  change what the agent receives.
- `MentionCategory.getCandidates` stays lazy. Ranking the file index is the
  expensive one, so a query scoped to another category must never call it, and a
  bare `@` must call none of them. Its `limit` is a hint a source may honour to
  stop early; `selectMentionMenuView` still enforces the cap, so a source that
  ignores it stays correct.
- Issues and PRs rank over their own slice of the shared cache. The shared
  ranking caps its result set, so ranking the merged list first lets a long issue
  list starve every PR out of the PR category. The slices are partitioned once by
  `useMentionCategories` and shared with the Fuse indexes, not re-derived per
  keystroke.
- Every category caps its candidate count. A row is a registered collection item
  that arrow-key movement walks, so an uncapped source degrades navigation, not
  just render time.
- Lazy work is `MentionCategory.activation`; category navigation starts its
  destination synchronously through `MentionItem.onMentionNavigate`, while
  `selectMentionViewActivations` covers typed/pasted prefixes, direct triggers,
  and aggregate views. It says which sources a view needs (scoped and aggregate
  do; the category index does not). Both routes share the menu's "once per
  menu-open cycle" latch; the menu owns no source-specific rule.
  Categories on one source share its `sourceKey`, so the pair activates once
  despite `activate` being an identity-churning callback. Skills activate this
  way too; the draft-contains-`$` scan remains only for the hydrator.
- Activation means "make sure this is loaded", not "revalidate": an aggregate
  query activates every category, so an unconditional refetch bills a mention
  aimed elsewhere. Issues/PRs gate on `ISSUE_PR_FRESH_FOR_MS`; explicit gestures
  pass `refresh({ force: true })`. The fetch timestamp rides on the cached entry,
  like the file source's `fetchedAt`, so it survives the IndexedDB round trip —
  beside it, every reload would look unfetched and refetch on the first `@`. An
  unasked source reports `loading`, not `ready` with zero rows.
- `enableAtMentions` is the one list of what `@` reaches, gating both trigger
  registration and mounting `<Mention>`. Every source with its own `enabled`
  rule (sessions: having any) belongs there too, or the composer falls back to a
  plain textarea and drops that type.
- Composer placeholder hints advertise `$` only when the same project-source or
  machine-source conditions enable Skill mentions. Plain-agent chats with a
  machine can therefore advertise `$` without falsely advertising `@`.
- A session mention commits as a plain `@<title-slug>`: no `session:` marker,
  because it was only ever an anchor for the before-send rewrite and the user
  had to read it. The mention range carries the real `sessionId`, and
  `useMentionPromptExpansion` rewrites **the range** — not a text match — into
  an id-bearing MCP instruction on send. It is still the only type whose
  displayed text differs from what the agent receives.
- A session token with no committed range is sent verbatim. A stale token the
  agent can ignore beats a confidently wrong session id, so the rewrite never
  resolves a slug itself.
- Dropping the marker makes a session and a path the same shape, so hydrating a
  reloaded draft has to break the tie: `hydrateSessionMentionsFromText` skips
  any token the file source already knows. Paths are the common case, and
  mistaking one for a session silently turns a file reference into a history
  query, where the reverse only leaves a token unexpanded — which the user can
  see.
- Session slugs resolve through the live list first, then a `localStorage`
  slug -> id map. The store is synchronous on purpose: expansion runs on the
  send path, and an async store would make that whole path async. Its key is
  registered in `lib/clear-local-cache.ts`, and the write is skipped when the
  serialized map is unchanged — the session list ticks several times a second
  while an agent streams, and `setItem` blocks.
- `useSessionMentionItems` is the single owner of the mentionable-session list.
  The composer and `useMentionPromptExpansion` are both mounted on a session
  screen, so deriving items separately re-slugged every visible session twice a
  tick. It reads the child-inclusive `allActiveSessions` projection, not the
  `sessionListAtom` sidebar rows that hide child tabs: mentioning is an
  addressing surface, and review/task child sessions are exactly what gets
  referenced. Archived and the composer's own session stay excluded.
- `useMentionPromptExpansion` is the single before-send text transform. With two
  send paths, per-type expansion hooks must compose here, not be wired into both.
- A candidate describes its side panel through the neutral
  `MentionCandidateDetail` fields, not its own component, so one pane serves
  every category. The pane is desktop-only: the docked mobile strip is too
  narrow and has no hover to preview with. It keeps a fixed height and reserves
  a stable scrollbar gutter so switching between short and overflowing
  descriptions changes neither the menu height nor text width. Its fields
  render verbatim, so a source must put i18n'd text in them — never a raw enum
  such as a skill scope.
- Locale files are flat dotted-key maps: i18next runs `keySeparator: false`, so
  a nested block never resolves and silently falls back to the inline default.
- `@` directory candidates must carry both `navigateText` (`@dir/`, descend) and
  `insertText` (`@dir`, commit without the trailing slash). The primitive no
  longer infers drill-down from a trailing `/`, so dropping either prop silently
  turns directories into plain one-shot mentions.

## Files

- `combined-mention-textarea.tsx` combines sources, hydrators, triggers, and
  `MentionInput` for chat composer usage.
- `file-at-mention.tsx` and `mention-project-file-source.ts` provide file path
  indexing and `@` candidates.
- `mention-registry.ts` holds the two-level menu contract: category definitions,
  candidate building, and `selectMentionMenuView`.
- `mention-two-level-menu.tsx` renders that contract as the single `@` menu and
  owns the activation latch and the `menu_open` -> `category_enter` -> `select`
  funnel, both through `hooks/use-fire-once` rather than private refs.
  `category_enter` is reported from the resolved view, not a row callback: a
  navigation item never fires `onMentionSelect`, and the keyboard route counts.
- `mention-session-source.ts` owns session slugs, candidates, the slug -> id
  cache, hydration, and the before-send expansion.
- `mention-expansion.ts` composes every before-send transform into one hook.
  Which kinds it rewrites is the short list (`REWRITTEN_SPAN_KINDS`); the
  verbatim ones are derived from `MESSAGE_TEXT_SPAN_KINDS` minus it, so a new
  span kind is a type error here rather than a mention that silently stops
  getting a transcript chip.
- `mention-hydration.ts` owns the hydrate-the-initial-text-once effect, the
  range merge every source shares, and `forEachAtTokenSpan` — the single
  definition of where an `@` token ends. Both the file and session hydrators
  scan with it; they have to agree, because the session one decides what it may
  claim by asking the file source which tokens it already knows.
- `mention-chips.tsx` owns the kind -> glyph and kind -> colour tables for BOTH
  chip surfaces. The composer's resolver decides only slot geometry and the
  transcript's chip only its layout, so `@src/a.ts` cannot look like two
  different objects before and after it is sent.
- `mention-fuse.ts` owns the shared, module-cached `fuse.js` import. Keep it
  module-cached and keyed by menu activation, and reuse provider file entries
  when paths/lazy dirs are unchanged — the menu must not rebuild either from
  per-render derived objects. The keying is latched, so closing the menu must
  not drop the constructor and re-index everything on the next `@`.
- `issue-pr-hash-mention.tsx` provides cached GitHub issue/PR lookup, ranking,
  hydration, and post-insert title hints.
- `mention-skill-source.tsx` provides `$` skill discovery, provider directory
  filtering, hydration, and the before-send prompt expansion.
- `mention-analytics.ts` centralizes mention analytics event helpers.
