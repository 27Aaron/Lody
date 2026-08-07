import type { ConversationFontSize } from '@/atoms/settings';

// Single source of truth for the conversation font-size scale shared across the
// ai-gui renderers (view.tsx, terminal-component.tsx). markdown-renderer.tsx keeps
// its own map because it also scales heading selectors, not just body text.

/** Body text in message rows, tool content, and the terminal command prompt. */
export const CONVERSATION_TEXT_FONT_SIZE_CLASSES: Record<ConversationFontSize, string> = {
  small: 'text-xs',
  default: 'text-sm',
  large: 'text-base',
};

/** Dense monospace blocks (raw tool output, structured JSON) — one tier smaller. */
export const CONVERSATION_MONO_FONT_SIZE_CLASSES: Record<ConversationFontSize, string> = {
  small: 'text-[10px]',
  default: 'text-[11px]',
  large: 'text-xs',
};

/** Streaming terminal output text — one tier smaller than the prompt. */
export const TERMINAL_TEXT_FONT_SIZE_CLASSES: Record<ConversationFontSize, string> = {
  small: 'text-[11px]',
  default: 'text-xs',
  large: 'text-sm',
};

/** Collapsed-height cap (px) for long user text, scaled so ~the same line count shows. */
export const USER_TEXT_COLLAPSED_HEIGHT_BY_FONT_SIZE: Record<ConversationFontSize, number> = {
  small: 144,
  default: 160,
  large: 192,
};
