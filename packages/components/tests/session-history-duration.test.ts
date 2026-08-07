import { describe, expect, test } from 'vitest';

import { resolveSessionHistoryDurationMs } from '../src/lib/session-history-duration';

describe('resolveSessionHistoryDurationMs', () => {
  test('returns null when endedAt is missing', () => {
    expect(
      resolveSessionHistoryDurationMs({
        endedAt: undefined,
        timestamp: '2026-01-01T00:00:00.000Z',
      })
    ).toBeNull();
  });

  test('uses timestamp/endedAt when present', () => {
    expect(
      resolveSessionHistoryDurationMs({
        endedAt: Date.parse('2026-01-01T00:00:03.000Z'),
        timestamp: '2026-01-01T00:00:00.000Z',
      })
    ).toBe(3_000);
  });

  test('returns null when timestamp is invalid', () => {
    expect(
      resolveSessionHistoryDurationMs({
        endedAt: 10_000,
        timestamp: 'not-a-date',
      })
    ).toBeNull();
  });

  test('returns null when endedAt < timestamp', () => {
    expect(
      resolveSessionHistoryDurationMs({
        endedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        timestamp: '2026-01-01T00:00:03.000Z',
      })
    ).toBeNull();
  });
});
