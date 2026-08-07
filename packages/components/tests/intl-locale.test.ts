import { describe, expect, it } from 'vitest';
import { toIntlLocale } from '../src/lib/intl-locale';

describe('toIntlLocale', () => {
  it('converts the app locale zh_CN to a valid Intl locale', () => {
    expect(toIntlLocale('zh_CN')).toBe('zh-CN');
    expect(() => new Intl.DateTimeFormat(toIntlLocale('zh_CN'))).not.toThrow();
  });

  it('returns undefined for an invalid locale', () => {
    expect(toIntlLocale('not valid')).toBeUndefined();
  });
});
