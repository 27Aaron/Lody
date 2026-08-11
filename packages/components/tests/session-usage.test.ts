import { describe, expect, it } from 'vitest';
import { CODEX_SPARK_LIMIT_ID, getRateLimitEntryKey } from '@lody/shared';

import {
  canShowSubscriptionRateLimits,
  formatRateLimitWindowShortLabel,
  getAgentRateLimitWindows,
  getContextWindowUsageData,
  getRateLimitRemainingPercent,
  resolveAgentRateLimitForModel,
  type MachineRateLimits,
} from '../src/lib/session-usage';

const usage = (overrides: Partial<MachineRateLimits[string]> = {}): MachineRateLimits[string] => ({
  planName: null,
  fiveHour: 25,
  sevenDay: 40,
  fiveHourResetAt: null,
  sevenDayResetAt: null,
  ...overrides,
});

describe('session usage', () => {
  it('derives remaining context tokens and clamps over-capacity usage', () => {
    expect(getContextWindowUsageData({ size: 128_000, used: 32_000 })).toMatchObject({
      remainingTokens: 96_000,
      usedPercentage: 25,
      remainingPercentage: 75,
    });
    expect(getContextWindowUsageData({ size: 100, used: 120 })).toMatchObject({
      remainingTokens: 0,
      usedPercentage: 100,
      remainingPercentage: 0,
    });
    expect(getContextWindowUsageData({ size: 0, used: 0 })).toBeNull();
  });

  it('normalizes provider-specific usage scales before showing remaining quota', () => {
    expect(getRateLimitRemainingPercent(25, 'codex')).toBe(75);
    expect(getRateLimitRemainingPercent(0.55, 'claude')).toBeCloseTo(45);
    expect(getRateLimitRemainingPercent(1, 'claude')).toBe(0);
    expect(getRateLimitRemainingPercent(1, 'codex')).toBe(99);
    expect(getRateLimitRemainingPercent(0.5, 'grok')).toBe(99.5);
  });

  it('uses provider-reported window durations instead of positional 5h/7d labels', () => {
    const windows = getAgentRateLimitWindows(
      usage({
        schemaVersion: 2,
        windows: [
          {
            usedPercent: 29,
            windowDurationMins: 7 * 24 * 60,
            resetsAt: 1784505071,
          },
        ],
        // Dynamic windows are authoritative even if stale legacy fields exist.
        fiveHour: 29,
        sevenDay: null,
      }),
      'codex'
    );

    expect(windows).toEqual([
      {
        usedPercent: 29,
        remainingPercent: 71,
        windowDurationMins: 10_080,
        resetsAt: 1784505071,
      },
    ]);
    expect(formatRateLimitWindowShortLabel(windows[0]!.windowDurationMins)).toBe('7d');
  });

  it('keeps legacy fixed windows readable for persisted Claude and Codex data', () => {
    expect(getAgentRateLimitWindows(usage(), 'codex')).toMatchObject([
      { usedPercent: 25, windowDurationMins: 300 },
      { usedPercent: 40, windowDurationMins: 10_080 },
    ]);
  });

  it('keeps sub-one-percent Grok usage on the percentage scale', () => {
    expect(
      getAgentRateLimitWindows(
        usage({ fiveHour: null, sevenDay: 0.5, sevenDayResetAt: 1784505071 }),
        'grok'
      )
    ).toEqual([
      {
        usedPercent: 0.5,
        remainingPercent: 99.5,
        windowDurationMins: 10_080,
        resetsAt: 1784505071,
      },
    ]);
  });

  it('treats a persisted single Codex primary window as weekly', () => {
    expect(
      getAgentRateLimitWindows(
        usage({
          fiveHour: 29,
          sevenDay: null,
          fiveHourResetAt: 1784505071,
          sevenDayResetAt: null,
        }),
        'codex'
      )
    ).toEqual([
      {
        usedPercent: 29,
        remainingPercent: 71,
        windowDurationMins: 10_080,
        resetsAt: 1784505071,
      },
    ]);
  });

  it('selects the quota tier that matches the current Codex model', () => {
    const rateLimits: MachineRateLimits = {
      [getRateLimitEntryKey('codex', 'codex')]: usage({ limitId: 'codex' }),
      [getRateLimitEntryKey('codex', CODEX_SPARK_LIMIT_ID)]: usage({
        limitId: CODEX_SPARK_LIMIT_ID,
        limitName: 'GPT-5.3-Codex-Spark',
        sevenDay: 88,
      }),
    };

    expect(
      resolveAgentRateLimitForModel({
        rateLimits,
        agentType: 'codex',
        modelId: 'gpt-5.3-codex-spark',
      })?.limitId
    ).toBe(CODEX_SPARK_LIMIT_ID);
    expect(
      resolveAgentRateLimitForModel({
        rateLimits,
        agentType: 'codex',
        modelId: 'gpt-5.4',
      })?.limitId
    ).toBe('codex');
  });

  it('does not show a model-specific tier beside a different selected model', () => {
    const rateLimits: MachineRateLimits = {
      [getRateLimitEntryKey('codex', CODEX_SPARK_LIMIT_ID)]: usage({
        limitId: CODEX_SPARK_LIMIT_ID,
        limitName: 'GPT-5.3-Codex-Spark',
      }),
    };

    expect(
      resolveAgentRateLimitForModel({
        rateLimits,
        agentType: 'codex',
        modelId: 'gpt-5.4',
      })
    ).toBeNull();
  });

  it('hides subscription limits for custom providers and configured endpoints', () => {
    expect(
      canShowSubscriptionRateLimits({
        cliType: 'builtin',
        agentType: 'codex',
        config: { env: {} },
      })
    ).toBe(true);
    expect(
      canShowSubscriptionRateLimits({
        cliType: 'builtin',
        agentType: 'grok',
        config: { env: {} },
      })
    ).toBe(true);
    expect(
      canShowSubscriptionRateLimits({
        cliType: 'builtin',
        agentType: 'claude',
        config: { env: { ANTHROPIC_BASE_URL: 'https://example.com' } },
      })
    ).toBe(false);
    expect(
      canShowSubscriptionRateLimits({
        cliType: 'custom',
        agentType: 'custom-agent',
      })
    ).toBe(false);
  });
});
