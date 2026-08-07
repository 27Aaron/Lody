/**
 * Deterministic mock data for landing power demos.
 * Fixed timestamps / curves so SSR and client match (no Date.now / Math.random).
 */

import type { SettingsUsageRange } from '@/components/settings/settings-data-cache';
import type { StackedAreaBucket } from '@/components/settings/usage-stacked-area-chart';
import type { PrTabViewData } from '@/components/sessions/pr-tab-view';
import type {
  GitHubCheckRun,
  GitHubIssueComment,
  GitHubPullRequestDetails,
  GitHubReview,
  GitHubUser,
} from '@lody/shared';

// ---- Stats (Settings → Usage) ----------------------------------------------
//
// Simulated 3-person eng team, one work week:
//   - Weekdays: ~100–300M tokens per person; weekend ≈ half a light weekday
//   - Per-person model preferences (Codex vs Claude vs Kimi)
//
// Official list prices (USD / 1M tokens), short-context standard tier:
//   OpenAI  https://developers.openai.com/api/docs/pricing  (as of 2026-07-30)
//     gpt-5.6-sol   input $5.00  cached $0.50  output $30.00
//     gpt-5.6-terra input $2.00  cached $0.20  output $12.00
//     gpt-5.5       input $5.00  cached $0.50  output $30.00
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//     claude-fable-5    input $10.00  cache hit $1.00  output $50.00
//     claude-opus-5     input $5.00   cache hit $0.50  output $25.00
//     claude-opus-4-8   input $5.00   cache hit $0.50  output $25.00
//   Moonshot https://platform.kimi.ai/docs/pricing/chat-k3
//     kimi-k3  cache-miss $3.00  cache-hit $0.30  output $15.00
//
// Blended `usdPerM` for agent coding sessions:
//   75% input / 25% output, and of input 70% cache-hit / 30% cache-miss.

type ModelListPrice = {
  id: string;
  label: string;
  /** USD / 1M uncached (or cache-miss) input tokens */
  input: number;
  /** USD / 1M cached-input / cache-hit tokens */
  cachedInput: number;
  /** USD / 1M output tokens */
  output: number;
};

const AGENT_INPUT_SHARE = 0.75;
const AGENT_OUTPUT_SHARE = 0.25;
const AGENT_CACHE_HIT_SHARE = 0.7; // of input tokens

function blendUsdPerM(price: Pick<ModelListPrice, 'input' | 'cachedInput' | 'output'>): number {
  const inputBlended =
    price.input * (1 - AGENT_CACHE_HIT_SHARE) + price.cachedInput * AGENT_CACHE_HIT_SHARE;
  return inputBlended * AGENT_INPUT_SHARE + price.output * AGENT_OUTPUT_SHARE;
}

/**
 * Official list prices + derived agent-workload blend.
 * Keep ≤5 models so the legend stays readable in the landing card.
 */
const MODEL_LIST_PRICES = [
  {
    id: 'gpt-5.6-sol',
    label: 'gpt-5.6-sol',
    input: 5.0,
    cachedInput: 0.5,
    output: 30.0,
  },
  {
    id: 'claude-opus-5',
    label: 'claude-opus-5',
    input: 5.0,
    cachedInput: 0.5,
    output: 25.0,
  },
  {
    id: 'claude-fable-5',
    label: 'claude-fable-5',
    input: 10.0,
    cachedInput: 1.0,
    output: 50.0,
  },
  {
    id: 'gpt-5.6-terra',
    label: 'gpt-5.6-terra',
    input: 2.0,
    cachedInput: 0.2,
    output: 12.0,
  },
  {
    id: 'kimi-k3',
    label: 'kimi-k3',
    input: 3.0,
    cachedInput: 0.3,
    output: 15.0,
  },
] as const satisfies readonly ModelListPrice[];

/**
 * First-tier coding models (names match product stats style).
 * `usdPerM` = blended effective rate from official list prices + agent mix above.
 */
export const LANDING_USAGE_MODELS = MODEL_LIST_PRICES.map((m) => ({
  id: m.id,
  label: m.label,
  usdPerM: blendUsdPerM(m),
  list: { input: m.input, cachedInput: m.cachedInput, output: m.output },
})) as readonly {
  id: (typeof MODEL_LIST_PRICES)[number]['id'];
  label: string;
  usdPerM: number;
  list: { input: number; cachedInput: number; output: number };
}[];

export type LandingUsageModelId = (typeof LANDING_USAGE_MODELS)[number]['id'];

export const LANDING_USAGE_MEMBERS = [
  { id: 'u1', name: 'Lee', initials: 'L' },
  { id: 'u2', name: 'Zixuan', initials: 'Z' },
  { id: 'u3', name: 'Wibus', initials: 'W' },
] as const;

export type LandingUsageMemberId = (typeof LANDING_USAGE_MEMBERS)[number]['id'];

const MODEL_BY_ID = new Map(LANDING_USAGE_MODELS.map((m) => [m.id, m]));

/**
 * Share of each member’s daily tokens by model (must sum ≈ 1).
 * Preferences:
 *   Lee    — Codex / GPT-5.6 Sol workhorse, Terra for bulk, light Opus
 *   Zixuan — Claude Opus 5 primary, Fable for hard reviews, some Sol
 *   Wibus  — Kimi K3 + Terra value path, occasional frontier
 */
const MEMBER_MODEL_MIX: Record<
  LandingUsageMemberId,
  Readonly<Partial<Record<LandingUsageModelId, number>>>
> = {
  u1: {
    'gpt-5.6-sol': 0.62,
    'gpt-5.6-terra': 0.24,
    'claude-opus-5': 0.1,
    'kimi-k3': 0.04,
  },
  u2: {
    'claude-opus-5': 0.48,
    'claude-fable-5': 0.18,
    'gpt-5.6-sol': 0.22,
    'kimi-k3': 0.07,
    'gpt-5.6-terra': 0.05,
  },
  u3: {
    'kimi-k3': 0.42,
    'gpt-5.6-terra': 0.34,
    'gpt-5.6-sol': 0.14,
    'claude-opus-5': 0.1,
  },
};

/**
 * Personal token totals (raw tokens). Index 0 = Mon … 6 = Sun.
 * Weekdays ~100–300M with large day-to-day swings; weekend ≈ half of a light day
 * but not flat (still some variance).
 */
const WEEK_MEMBER_TOKENS: Record<LandingUsageMemberId, readonly number[]> = {
  // Mon      Tue       Wed       Thu       Fri       Sat         Sun
  // Lee: big Sol push mid-week, slump Monday, partial weekend
  u1: [168_000_000, 292_000_000, 310_000_000, 241_000_000, 175_000_000, 128_000_000, 72_000_000],
  // Zixuan: spike Wed (Fable review day), quiet Fri, uneven weekend
  u2: [142_000_000, 188_000_000, 285_000_000, 196_000_000, 119_000_000, 94_000_000, 51_000_000],
  // Wibus: spikier than before; Thurs low, Tue high, weekend uneven
  u3: [98_000_000, 172_000_000, 145_000_000, 88_000_000, 156_000_000, 71_000_000, 39_000_000],
};

/**
 * Deterministic 0..1 noise from (member, day, salt) — SSR-stable, no Math.random.
 * Produces uneven day curves without looking like a sine wave.
 */
function dayNoise(memberOrdinal: number, dayIndex: number, salt: number): number {
  const x = Math.sin(memberOrdinal * 12.9898 + dayIndex * 78.233 + salt * 43.758) * 43758.5453;
  return x - Math.floor(x);
}

/** Mid-week Fable spikes for Zixuan; plus per-day mix jitter for everyone. */
const FABLE_DAY_BOOST: ReadonlyArray<number> = [0.02, 0.0, 0.14, 0.05, 0.01, 0.03, 0.0];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MEMBER_ORDINAL: Record<LandingUsageMemberId, number> = { u1: 1, u2: 2, u3: 3 };

function mixForMemberDay(
  memberId: LandingUsageMemberId,
  dayIndex: number
): Partial<Record<LandingUsageModelId, number>> {
  const base: Partial<Record<LandingUsageModelId, number>> = { ...MEMBER_MODEL_MIX[memberId] };
  const ord = MEMBER_ORDINAL[memberId];

  // Day-to-day preference wobble: push mass between primary and secondary models.
  if (memberId === 'u1') {
    const wobble = (dayNoise(ord, dayIndex, 1) - 0.5) * 0.28; // ±14pp Sol ↔ Terra
    base['gpt-5.6-sol'] = Math.max(0.32, (base['gpt-5.6-sol'] ?? 0) + wobble);
    base['gpt-5.6-terra'] = Math.max(0.08, (base['gpt-5.6-terra'] ?? 0) - wobble);
    if (dayNoise(ord, dayIndex, 2) > 0.72) {
      // Occasional Opus day
      base['claude-opus-5'] = (base['claude-opus-5'] ?? 0) + 0.12;
      base['gpt-5.6-sol'] = Math.max(0.28, (base['gpt-5.6-sol'] ?? 0) - 0.12);
    }
  } else if (memberId === 'u2') {
    const boost = FABLE_DAY_BOOST[dayIndex] ?? 0;
    if (boost > 0) {
      base['claude-fable-5'] = (base['claude-fable-5'] ?? 0) + boost;
      base['claude-opus-5'] = Math.max(0.12, (base['claude-opus-5'] ?? 0) - boost * 0.55);
      base['gpt-5.6-sol'] = Math.max(0.06, (base['gpt-5.6-sol'] ?? 0) - boost * 0.45);
    }
    const wobble = (dayNoise(ord, dayIndex, 3) - 0.5) * 0.22;
    base['claude-opus-5'] = Math.max(0.15, (base['claude-opus-5'] ?? 0) + wobble);
    base['gpt-5.6-sol'] = Math.max(0.08, (base['gpt-5.6-sol'] ?? 0) - wobble * 0.5);
  } else {
    const wobble = (dayNoise(ord, dayIndex, 4) - 0.5) * 0.3;
    base['kimi-k3'] = Math.max(0.15, (base['kimi-k3'] ?? 0) + wobble);
    base['gpt-5.6-terra'] = Math.max(0.1, (base['gpt-5.6-terra'] ?? 0) - wobble * 0.6);
    if (dayNoise(ord, dayIndex, 5) > 0.78) {
      // Rare Sol sprint day
      base['gpt-5.6-sol'] = (base['gpt-5.6-sol'] ?? 0) + 0.18;
      base['kimi-k3'] = Math.max(0.12, (base['kimi-k3'] ?? 0) - 0.1);
      base['gpt-5.6-terra'] = Math.max(0.08, (base['gpt-5.6-terra'] ?? 0) - 0.08);
    }
  }

  // Renormalize shares to 1.
  let sum = 0;
  for (const m of LANDING_USAGE_MODELS) sum += base[m.id] ?? 0;
  if (sum > 0) {
    for (const m of LANDING_USAGE_MODELS) {
      if (base[m.id] != null) base[m.id] = (base[m.id] as number) / sum;
    }
  }
  return base;
}

function splitTokensByModel(
  totalTokens: number,
  mix: Partial<Record<LandingUsageModelId, number>>
): Record<LandingUsageModelId, number> {
  const out = {} as Record<LandingUsageModelId, number>;
  for (const m of LANDING_USAGE_MODELS) {
    out[m.id] = 0;
  }
  if (totalTokens <= 0) return out;

  let assigned = 0;
  const entries = LANDING_USAGE_MODELS.map((m) => {
    const share = mix[m.id] ?? 0;
    const tokens = Math.round(totalTokens * share);
    return { id: m.id, tokens };
  });
  for (const e of entries) {
    out[e.id] = e.tokens;
    assigned += e.tokens;
  }
  // Fix rounding onto the member’s primary model.
  const primary = entries.reduce((a, b) => (b.tokens > a.tokens ? b : a));
  out[primary.id] += totalTokens - assigned;
  return out;
}

type DaySlice = {
  label: string;
  /** memberId → modelId → tokens */
  byMemberModel: Record<LandingUsageMemberId, Record<LandingUsageModelId, number>>;
};

/** Canonical Mon–Sun week used as the source of truth for all ranges. */
function buildCanonicalWeek(): DaySlice[] {
  return WEEKDAY_LABELS.map((label, dayIndex) => {
    const byMemberModel = {} as DaySlice['byMemberModel'];
    for (const member of LANDING_USAGE_MEMBERS) {
      const total = WEEK_MEMBER_TOKENS[member.id][dayIndex] ?? 0;
      byMemberModel[member.id] = splitTokensByModel(total, mixForMemberDay(member.id, dayIndex));
    }
    return { label, byMemberModel };
  });
}

const CANONICAL_WEEK = buildCanonicalWeek();

function dayTotals(slice: DaySlice): {
  byModel: Record<LandingUsageModelId, number>;
  byMember: Record<LandingUsageMemberId, number>;
  tokens: number;
  costUSD: number;
} {
  const byModel = {} as Record<LandingUsageModelId, number>;
  const byMember = {} as Record<LandingUsageMemberId, number>;
  for (const m of LANDING_USAGE_MODELS) byModel[m.id] = 0;
  for (const u of LANDING_USAGE_MEMBERS) byMember[u.id] = 0;

  let tokens = 0;
  let costUSD = 0;
  for (const member of LANDING_USAGE_MEMBERS) {
    let memberTokens = 0;
    for (const model of LANDING_USAGE_MODELS) {
      const t = slice.byMemberModel[member.id][model.id] ?? 0;
      byModel[model.id] += t;
      memberTokens += t;
      tokens += t;
      costUSD += (t / 1_000_000) * model.usdPerM;
    }
    byMember[member.id] = memberTokens;
  }
  return { byModel, byMember, tokens, costUSD };
}

/** Cost from official blended rates (no artificial scale). */
function costForTokens(modelId: LandingUsageModelId, tokens: number): number {
  const model = MODEL_BY_ID.get(modelId);
  if (!model || tokens <= 0) return 0;
  return (tokens / 1_000_000) * model.usdPerM;
}

/**
 * Work-hour shares of a heavy day (sums ≈ 1). Peaky morning + afternoon,
 * not a smooth bell.
 */
const HOUR_SHARES = [
  0.03, 0.05, 0.09, 0.14, 0.07, 0.04, 0.11, 0.16, 0.13, 0.08, 0.06, 0.04,
] as const;

function slicesForRange(range: SettingsUsageRange): DaySlice[] {
  if (range === 'week') {
    return CANONICAL_WEEK;
  }
  if (range === 'day') {
    // Typical Wednesday (heavy day) across work hours, with uneven hour factors.
    const source = CANONICAL_WEEK[2]!;
    return HOUR_SHARES.map((share, i) => {
      const label = `${String(i * 2 + 8).padStart(2, '0')}:00`;
      const hourJitter = 0.65 + dayNoise(3, i, 13) * 0.75;
      const byMemberModel = {} as DaySlice['byMemberModel'];
      for (const member of LANDING_USAGE_MEMBERS) {
        const memberJitter = 0.75 + dayNoise(MEMBER_ORDINAL[member.id], i, 17) * 0.55;
        const scaled = {} as Record<LandingUsageModelId, number>;
        for (const model of LANDING_USAGE_MODELS) {
          scaled[model.id] = Math.round(
            (source.byMemberModel[member.id][model.id] ?? 0) * share * hourJitter * memberJitter
          );
        }
        byMemberModel[member.id] = scaled;
      }
      return { label, byMemberModel };
    });
  }

  // month / total: repeat the week with per-day intensity noise (not a flat ramp).
  const days = range === 'month' ? 14 : 16;
  const out: DaySlice[] = [];
  for (let i = 0; i < days; i += 1) {
    const weekDay = i % 7;
    const week = Math.floor(i / 7);
    const source = CANONICAL_WEEK[weekDay]!;
    const intensity = 0.82 + week * 0.1 + (dayNoise(7, i, 9) - 0.5) * 0.45;
    const daysAgo = days - 1 - i;
    const label = daysAgo === 0 ? 'Today' : `-${daysAgo}d`;
    const byMemberModel = {} as DaySlice['byMemberModel'];
    for (const member of LANDING_USAGE_MEMBERS) {
      const memberScale = intensity * (0.88 + dayNoise(MEMBER_ORDINAL[member.id], i, 11) * 0.28);
      const scaled = {} as Record<LandingUsageModelId, number>;
      for (const model of LANDING_USAGE_MODELS) {
        scaled[model.id] = Math.round(
          (source.byMemberModel[member.id][model.id] ?? 0) * memberScale
        );
      }
      byMemberModel[member.id] = scaled;
    }
    out.push({ label, byMemberModel });
  }
  return out;
}

export function buildLandingUsageDemo(range: SettingsUsageRange = 'week') {
  const slices = slicesForRange(range);
  const byModelBuckets: StackedAreaBucket[] = [];
  const byMemberBuckets: StackedAreaBucket[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  for (const slice of slices) {
    const totals = dayTotals(slice);
    totalTokens += totals.tokens;
    for (const model of LANDING_USAGE_MODELS) {
      totalCost += costForTokens(model.id, totals.byModel[model.id] ?? 0);
    }

    byModelBuckets.push({
      label: slice.label,
      values: LANDING_USAGE_MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        value: totals.byModel[m.id] ?? 0,
      })),
    });

    byMemberBuckets.push({
      label: slice.label,
      values: LANDING_USAGE_MEMBERS.map((u) => ({
        id: u.id,
        label: u.name,
        value: totals.byMember[u.id] ?? 0,
      })),
    });
  }

  return {
    byModelBuckets,
    byMemberBuckets,
    totals: {
      tokens: totalTokens,
      costUSD: Math.round(totalCost * 100) / 100,
    },
  };
}

// ---- PR tab ----------------------------------------------------------------
//
// Compact thread so the landing PR card matches the usage card height:
//   Zixuan finds an issue → Lee: Fixed. → Wibus LGTM (one approve).

const lee: GitHubUser = {
  login: 'Lee',
  id: 201,
  avatarUrl: '',
  htmlUrl: 'https://github.com/Lee',
};
const zixuan: GitHubUser = {
  login: 'Zixuan',
  id: 202,
  avatarUrl: '',
  htmlUrl: 'https://github.com/Zixuan',
};
const wibus: GitHubUser = {
  login: 'Wibus',
  id: 203,
  avatarUrl: '',
  htmlUrl: 'https://github.com/Wibus',
};

const FIXED_CREATED = '2026-07-30T10:00:00.000Z';
const FIXED_UPDATED = '2026-07-31T08:30:00.000Z';

const landingPr: GitHubPullRequestDetails = {
  number: 3175,
  nodeId: 'PR_landing_demo_3175',
  title: 'feat(tasks): add task list/create MCP tools and property writes',
  body: [
    '## Summary',
    'Add MCP tools so agents can list/create tasks and write properties without pasting a task id into the prompt.',
    '',
    '## Changes',
    '- `list_tasks` / `create_task` tools on the workspace MCP surface',
    '- Property writes on the task document (status, assignee, custom fields)',
    '- Fail closed when the task index is cold or missing — no silent empty lists',
  ].join('\n'),
  state: 'open',
  merged: false,
  draft: false,
  htmlUrl: 'https://github.com/loro-dev/lody/pull/3175',
  baseRef: 'main',
  headRef: 'feat/task-mcp-list-create-properties',
  headSha: 'a1b2c3d4e5f67890',
  user: lee,
  createdAt: FIXED_CREATED,
  updatedAt: FIXED_UPDATED,
  mergedAt: null,
  closedAt: null,
  additions: 1314,
  deletions: 69,
  changedFiles: 9,
  commits: 3,
  mergeable: true,
  mergeableState: 'clean',
};

function checkRun(overrides: Partial<GitHubCheckRun> & Pick<GitHubCheckRun, 'id' | 'name'>): GitHubCheckRun {
  return {
    status: 'completed',
    conclusion: 'success',
    htmlUrl: null,
    startedAt: FIXED_CREATED,
    completedAt: FIXED_UPDATED,
    appName: 'GitHub Actions',
    ...overrides,
  };
}

function issueComment(
  overrides: Pick<GitHubIssueComment, 'id' | 'body' | 'user' | 'createdAt'> &
    Partial<GitHubIssueComment>
): GitHubIssueComment {
  return {
    nodeId: `IC_${overrides.id}`,
    authorAssociation: 'MEMBER',
    updatedAt: overrides.createdAt,
    htmlUrl: `https://github.com/loro-dev/lody/pull/3175#issuecomment-${overrides.id}`,
    issueUrl: 'https://github.com/loro-dev/lody/issues/3175',
    ...overrides,
  };
}

function review(
  overrides: Pick<GitHubReview, 'id' | 'body' | 'state' | 'user' | 'submittedAt'> &
    Partial<GitHubReview>
): GitHubReview {
  return {
    nodeId: `PRR_${overrides.id}`,
    authorAssociation: 'MEMBER',
    commitId: 'a1b2c3d4e5f67890',
    htmlUrl: `https://github.com/loro-dev/lody/pull/3175#pullrequestreview-${overrides.id}`,
    ...overrides,
  };
}

/** One review LGTM only — no extra LGTM comment noise. */
const landingIssueComments: GitHubIssueComment[] = [
  issueComment({
    id: 501,
    user: zixuan,
    createdAt: '2026-07-30T14:20:00.000Z',
    body: 'List path still opens task docs on cold cache — fail closed if the index is missing.',
  }),
  issueComment({
    id: 502,
    user: lee,
    createdAt: '2026-07-30T15:10:00.000Z',
    body: 'Fixed.',
  }),
];

const landingReviews: GitHubReview[] = [
  review({
    id: 601,
    user: wibus,
    state: 'approved',
    submittedAt: '2026-07-30T16:00:00.000Z',
    body: 'LGTM!',
  }),
];

export const LANDING_PR_DEMO_DATA: PrTabViewData = {
  pullRequest: landingPr,
  reviewThreads: [],
  reviews: landingReviews,
  issueComments: landingIssueComments,
  checkRuns: {
    status: 'completed',
    conclusion: 'success',
    total: 3,
    runs: [
      checkRun({ id: 1, name: 'test' }),
      checkRun({ id: 2, name: 'typecheck' }),
      checkRun({ id: 3, name: 'lint' }),
    ],
  },
};

export const LANDING_PR_DEMO_REPO = 'loro-dev/lody';
export const LANDING_PR_DEMO_NUMBER = 3175;
