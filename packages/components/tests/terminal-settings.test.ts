import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TERMINAL_FONT_SIZE,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSize,
  TERMINAL_FONT_FAMILY_MAX_LENGTH,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '../src/atoms/settings';
import {
  buildTerminalFontLoadSpec,
  buildTerminalFontPreviewFamily,
} from '../src/components/terminal/terminal-theme';

describe('terminal appearance settings', () => {
  it('normalizes persisted font values to bounded settings', () => {
    expect(normalizeTerminalFontFamily('  Maple Mono  ')).toBe('Maple Mono');
    expect(
      normalizeTerminalFontFamily('a'.repeat(TERMINAL_FONT_FAMILY_MAX_LENGTH + 10))
    ).toHaveLength(TERMINAL_FONT_FAMILY_MAX_LENGTH);
    expect(normalizeTerminalFontFamily(null)).toBe('');

    expect(normalizeTerminalFontSize(undefined)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    expect(normalizeTerminalFontSize(TERMINAL_FONT_SIZE_MIN - 4)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(normalizeTerminalFontSize(TERMINAL_FONT_SIZE_MAX + 4)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(normalizeTerminalFontSize(14.7)).toBe(15);
  });

  it('quotes custom font names and retains the app fallback in previews', () => {
    expect(buildTerminalFontLoadSpec('Maple "Mono"', 15)).toBe('15px "Maple \\"Mono\\""');
    expect(buildTerminalFontPreviewFamily('Maple Mono')).toBe('"Maple Mono", var(--font-terminal)');
    expect(buildTerminalFontPreviewFamily('')).toBe('var(--font-terminal)');
  });
});
