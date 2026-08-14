# React hooks

Root and `packages/components/AGENTS.md` also apply. `CLAUDE.md` is a symlink to
this file; edit `AGENTS.md` only.

- Conversation virtualization and bottom-following are separate concerns.
  `virtua` owns mounted rows, measurement, and index navigation.
  `use-sticky-scroll.ts` adapts `use-stick-to-bottom` to Virtua's viewport and
  content elements; do not restore a content-token effect or a distance-based
  upward-scroll threshold. Any real upward wheel, touch, selection, or scrollbar
  movement must release streaming follow immediately.
- Preserve the app-specific adapters around the library: per-session scroll
  restoration, search/group-expansion suppression, and viewport resize handling
  for the mobile keyboard and terminal dock. The library observes content growth;
  it does not replace Virtua or own those product-level behaviors.
