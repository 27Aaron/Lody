# React hooks

Root and `packages/components/AGENTS.md` also apply. `CLAUDE.md` is a symlink to
this file; edit `AGENTS.md` only.

- Conversation virtualization and bottom-following are separate concerns.
  `virtua` owns mounted rows, measurement, and index navigation.
  `use-sticky-scroll.ts` adapts `use-stick-to-bottom` to Virtua's viewport and
  content elements; do not restore a content-token effect or a distance-based
  upward-scroll threshold. Any real upward wheel, touch, selection, or scrollbar
  movement must release streaming follow immediately.
- Sticky-scroll binds through the real scroll viewport's React callback ref. Keep
  the conversation on Virtua's public `Virtualizer` primitive with that explicit
  viewport; never recover the element from a `VList` handle, DOM query, item-count
  effect, observer retry, or timer. Empty-to-populated conversations must attach
  on the viewport's actual mount commit and detach on its unmount commit.
- Treat `use-stick-to-bottom`'s `state.isAtBottom` as the follow-lock truth. Its
  returned `isAtBottom` also includes near-bottom tolerance, while
  `escapedFromLock` is escape history and does not become false merely because an
  explicit `scrollToBottom` restored the lock.
- Follow viewport-size changes from the viewport's `ResizeObserver` records.
  Keyboard and terminal transitions resize that same element, so do not restore
  custom resize-event pumps, guessed transition durations, or stop timers.
- Group expansion scrolls after Virtua descendants finish their layout effects,
  and releases sticky suppression in the later parent layout effect of the same
  commit. Do not reintroduce frame retries or guessed settle timers.
- Preserve the app-specific adapters around the library: per-session scroll
  restoration, search/group-expansion suppression, and viewport resize handling
  for the mobile keyboard and terminal dock. The library observes content growth;
  it does not replace Virtua or own those product-level behaviors.
- `use-workspace-mcp-catalog.ts` reads a ref-counted per-workspace room in
  `lib/workspace-mcp-catalog-room.ts`; it must not open the Flock document,
  subscribe, or join the room per mount. The catalog is ONE small document, but
  a consumer mounts for every visible session plus every hidden child tab and
  side chat, so per-mount leases multiply room joins and duplicate row maps for
  one list — the same problem `use-machine-flock-rows.ts` ref-counts away. The
  shared snapshot is also identity-stable across mounts, which is what lets the
  selection and composer-menu memos built on it actually hit.
