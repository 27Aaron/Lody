# src/ui/mention

Shared mention primitive used by composer autocomplete surfaces.

## Invariants

- Desktop `MentionContent` is caret-anchored vertically but horizontally constrained
  to the textarea range via its virtual collision boundary and
  `--mention-input-width`.
- `MentionContent positionAnchor="input-top"` places top-side menus against the
  input wrapper's top edge instead of the current caret line.
- Menu callers should include `var(--mention-input-width)` in desktop `max-w`
  classes; viewport-only caps let wide menus escape the composer.
- Mobile mention content bypasses floating-ui and docks through
  `MentionMobilePanel`; desktop positioning classes do not control mobile layout.

## Files

- `mention-root.tsx` owns open state, active trigger, selected values, mention
  ranges, item registration, filtering, and insertion.
- `mention-input.tsx` owns textarea behavior: trigger detection, virtual caret
  anchor creation, controlled value sync, selection restore, and highlighter
  interaction.
- `mention-content.tsx` renders the desktop floating listbox and provides the
  input-width CSS variable; it delegates mobile rendering to `mention-mobile-content.tsx`.
- `mention-mobile-content.tsx` docks the mobile panel above the composer and
  handles drawer-safe portal placement.
- `mention-item.tsx`, `mention-label.tsx`, `mention-highlighter.tsx`, and
  `mention-trigger.ts` provide row selection, accessibility label, inline
  highlighting, and trigger parsing helpers.
