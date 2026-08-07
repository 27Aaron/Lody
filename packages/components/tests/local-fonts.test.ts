// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  applyInterfaceFontFamily,
  buildInterfaceFontFamily,
  INTERFACE_FONT_CSS_VARIABLE,
  listSystemFontFamilies,
} from '../src/lib/local-fonts';

describe('listSystemFontFamilies', () => {
  it('returns unique, sorted font family names', async () => {
    const families = await listSystemFontFamilies(async () => [
      { family: 'Maple Mono' },
      { family: '  Fira Code  ' },
      { family: 'maple mono' },
      { family: '' },
      { family: 'SF Mono' },
    ]);

    expect(families).toEqual(['Fira Code', 'Maple Mono', 'SF Mono']);
  });

  it('quotes an interface font and preserves the bundled fallback stack', () => {
    expect(buildInterfaceFontFamily('Atkinson "UI"')).toBe(
      '"Atkinson \\"UI\\"", var(--font-sans-default)'
    );
    expect(buildInterfaceFontFamily('')).toBe('var(--font-sans-default)');
  });

  it('applies and clears the interface font without changing terminal fonts', () => {
    const root = document.createElement('div');
    root.style.setProperty('--font-terminal', 'Terminal Fallback');

    applyInterfaceFontFamily(root, 'Atkinson Hyperlegible');
    expect(root.style.getPropertyValue(INTERFACE_FONT_CSS_VARIABLE)).toBe(
      '"Atkinson Hyperlegible", var(--font-sans-default)'
    );
    expect(root.style.getPropertyValue('--font-terminal')).toBe('Terminal Fallback');

    applyInterfaceFontFamily(root, '');
    expect(root.style.getPropertyValue(INTERFACE_FONT_CSS_VARIABLE)).toBe('');
    expect(root.style.getPropertyValue('--font-terminal')).toBe('Terminal Fallback');
  });
});
