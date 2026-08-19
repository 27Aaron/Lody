import {
  CODEX_SPARK_LIMIT_ID,
  parseRateLimitEntryKey,
  resolveAgentBrandId,
  type AgentConfigCliType,
  type AgentConfigMeta,
  type MachineViewMeta,
  type SessionContextWindowUsage,
} from '@lody/shared';
import { clamp } from './clamp';

// Provider rate-limit windows Lody knows by name. Kept here (beside the legacy
// window mapping below) so the duration↔label knowledge has one home instead of
// being re-special-cased with bare magic numbers at each UI call site.
export const FIVE_HOUR_WINDOW_MINS = 5 * 60;
export const SEVEN_DAY_WINDOW_MINS = 7 * 24 * 60;

export type MachineRateLimits = MachineViewMeta['raceLimits'];
export type MachineRateLimitUsage = MachineRateLimits[string];

export type AgentRateLimitEntry = {
  key: string;
  limits: MachineRateLimitUsage;
  cliType: string;
  limitId: string | null;
};

export type ContextWindowUsageData = {
  usedTokens: number;
  remainingTokens: number;
  contextWindow: number;
  usedPercentage: number;
  remainingPercentage: number;
};

export type AgentRateLimitWindow = {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

const clampPercentage = (value: number): number => clamp(value, [0, 100]);

export function normalizeRateLimitUsedPercent(
  value: number | null | undefined,
  cliType: string
): number | null {
  if (value == null || !Number.isFinite(value)) return null;

  // Claude's usage endpoint reports a 0..1 fraction, while Codex reports a
  // 0..100 percentage. Keep accepting old/mock percentage-shaped Claude data.
  if (cliType === 'claude' && value >= 0 && value <= 1) {
    return clampPercentage(value * 100);
  }
  return clampPercentage(value);
}

export function getRateLimitRemainingPercent(
  value: number | null | undefined,
  cliType: string
): number | null {
  const usedPercent = normalizeRateLimitUsedPercent(value, cliType);
  return usedPercent == null ? null : clampPercentage(100 - usedPercent);
}

export function getAgentRateLimitWindows(
  limits: MachineRateLimitUsage,
  cliType: string
): AgentRateLimitWindow[] {
  if (limits.apiUnavailable) return [];

  if (Array.isArray(limits.windows)) {
    return limits.windows.flatMap((window) => {
      if (!Number.isFinite(window.usedPercent)) return [];
      const usedPercent = clampPercentage(window.usedPercent);
      return [
        {
          usedPercent,
          remainingPercent: clampPercentage(100 - usedPercent),
          windowDurationMins:
            window.windowDurationMins != null && Number.isFinite(window.windowDurationMins)
              ? window.windowDurationMins
              : null,
          resetsAt: window.resetsAt,
        },
      ];
    });
  }

  // Older Codex adapters stored the provider's only `primary` window in the
  // fixed `fiveHour` field even when that window was weekly. Dynamic windows
  // are authoritative above; for persisted single-window rows, preserve the
  // provider's current weekly meaning instead of showing a false 5-hour label.
  const hasLegacyCodexWeeklyWindow =
    cliType === 'codex' && limits.fiveHour != null && limits.sevenDay == null;

  const legacyWindows = [
    {
      value: limits.fiveHour,
      windowDurationMins: hasLegacyCodexWeeklyWindow
        ? SEVEN_DAY_WINDOW_MINS
        : FIVE_HOUR_WINDOW_MINS,
      resetsAt: limits.fiveHourResetAt,
    },
    {
      value: limits.sevenDay,
      windowDurationMins: SEVEN_DAY_WINDOW_MINS,
      resetsAt: limits.sevenDayResetAt,
    },
  ];

  return legacyWindows.flatMap((window) => {
    const usedPercent = normalizeRateLimitUsedPercent(window.value, cliType);
    if (usedPercent === null) return [];
    return [
      {
        usedPercent,
        remainingPercent: clampPercentage(100 - usedPercent),
        windowDurationMins: window.windowDurationMins,
        resetsAt: window.resetsAt,
      },
    ];
  });
}

export function formatRateLimitWindowShortLabel(windowDurationMins: number | null): string {
  if (windowDurationMins == null || !Number.isFinite(windowDurationMins)) return 'Usage';
  if (windowDurationMins % (24 * 60) === 0) return `${windowDurationMins / (24 * 60)}d`;
  if (windowDurationMins % 60 === 0) return `${windowDurationMins / 60}h`;
  return `${windowDurationMins}m`;
}

export function getContextWindowUsageData(
  usage: SessionContextWindowUsage | null | undefined
): ContextWindowUsageData | null {
  if (!usage || !Number.isFinite(usage.size) || usage.size <= 0) return null;

  const contextWindow = usage.size;
  const usedTokens = Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  const remainingTokens = Math.max(0, contextWindow - usedTokens);
  const usedPercentage = clampPercentage((usedTokens / contextWindow) * 100);

  return {
    usedTokens,
    remainingTokens,
    contextWindow,
    usedPercentage,
    remainingPercentage: clampPercentage(100 - usedPercentage),
  };
}

export function canShowSubscriptionRateLimits({
  cliType,
  agentType,
  config,
}: {
  cliType: AgentConfigCliType;
  agentType: string;
  config?: Pick<AgentConfigMeta, 'brandId' | 'env'> | null;
}): boolean {
  if (
    cliType !== 'builtin' ||
    (agentType !== 'claude' &&
      agentType !== 'codex' &&
      agentType !== 'grok' &&
      agentType !== 'kimi')
  ) {
    return false;
  }
  if (!config) return true;

  return (
    Object.keys(config.env).length === 0 &&
    !resolveAgentBrandId({ brandId: config.brandId, env: config.env })
  );
}

const normalizeModelName = (value: string | null | undefined): string =>
  value?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';

const modelNamesMatch = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  return (
    left === right ||
    (left.length >= 4 && right.includes(left)) ||
    (right.length >= 4 && left.includes(right))
  );
};

export function getAgentRateLimitEntries(
  rateLimits: MachineRateLimits | null | undefined,
  agentType: string
): AgentRateLimitEntry[] {
  return Object.entries(rateLimits ?? {})
    .map(([key, limits]) => {
      const parsed = parseRateLimitEntryKey(key);
      return {
        key,
        limits,
        cliType: parsed.cliType,
        limitId: parsed.limitId,
      };
    })
    .filter((entry) => entry.cliType === agentType);
}

export function resolveAgentRateLimitForModel({
  rateLimits,
  agentType,
  modelId,
}: {
  rateLimits: MachineRateLimits | null | undefined;
  agentType: string;
  modelId: string | null | undefined;
}): AgentRateLimitEntry | null {
  const entries = getAgentRateLimitEntries(rateLimits, agentType);
  if (entries.length === 0) return null;

  const normalizedModelId = normalizeModelName(modelId);
  if (normalizedModelId) {
    const namedMatch = entries
      .map((entry) => ({ entry, name: normalizeModelName(entry.limits.limitName) }))
      .filter(({ name }) => modelNamesMatch(normalizedModelId, name))
      .sort((left, right) => right.name.length - left.name.length)[0]?.entry;
    if (namedMatch) return namedMatch;

    const exactLimitIdMatch = entries.find(
      (entry) => normalizeModelName(entry.limitId) === normalizedModelId
    );
    if (exactLimitIdMatch) return exactLimitIdMatch;

    const wantsCodexSpark = agentType === 'codex' && normalizedModelId.includes('spark');
    if (wantsCodexSpark) {
      return (
        entries.find(
          (entry) =>
            entry.limitId === CODEX_SPARK_LIMIT_ID ||
            normalizeModelName(entry.limits.limitName).includes('spark')
        ) ?? null
      );
    }
  }

  const genericEntry = entries.find(
    (entry) => entry.limitId === null || entry.limitId === agentType
  );
  if (genericEntry) return genericEntry;

  // With no selected model, a single provider-reported tier is still useful.
  // Once a model is selected, avoid showing a model-specific tier that did not
  // match it (for example, Spark quota beside a standard Codex model).
  return normalizedModelId ? null : (entries[0] ?? null);
}
