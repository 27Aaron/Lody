import type { Meta, StoryObj } from '@storybook/react';
import { UsageCalendarVisualization } from '@/components/settings/usage-calendar-visualization';
import { useState } from 'react';
import type {
  SettingsUsageCalendarData,
  SettingsUsageDayData,
} from '@/components/settings/settings-data-cache';

const DAY_MS = 24 * 60 * 60 * 1000;
const START_MS = Date.UTC(2025, 6, 20);

function wave(index: number): number {
  const primary = Math.sin(index * 0.43) * 0.5 + 0.5;
  const secondary = Math.sin(index * 0.11 + 1.3) * 0.5 + 0.5;
  return primary * secondary;
}

type Shape = 'default' | 'empty' | 'outlier';

function buildCalendar(shape: Shape): SettingsUsageCalendarData {
  return {
    workspaceId: 'workspace-story',
    timezone: 'UTC',
    startMs: START_MS,
    endMs: START_MS + 370 * DAY_MS,
    days: Array.from({ length: 371 }, (_, index) => {
      const dayStartMs = START_MS + index * DAY_MS;
      const activity = shape === 'empty' || index > 364 ? 0 : Math.round(wave(index) * 180_000);
      // One launch-day spike that would flatten the whole ramp under a max-anchored scale.
      const spike = shape === 'outlier' && index === 300 ? 12_000_000 : 0;
      const tokens = index % 9 === 0 ? 0 : activity + spike;
      return {
        dayStartMs,
        date: new Date(dayStartMs).toISOString().slice(0, 10),
        tokens,
        costUSD: tokens * 0.000012,
        isFuture: index > 364,
      };
    }),
  };
}

/** Stand-in for the Convex per-day query so the expanded panel is reviewable. */
function buildDayDetail(dayStartMs: number): SettingsUsageDayData {
  const index = Math.round((dayStartMs - START_MS) / DAY_MS);
  const tokens = Math.max(1_000, Math.round(wave(index) * 180_000));
  return {
    workspaceId: 'workspace-story',
    dayStartMs,
    date: new Date(dayStartMs).toISOString().slice(0, 10),
    totals: {
      tokens,
      costUSD: tokens * 0.000012,
      inputTokens: Math.round(tokens * 0.18),
      outputTokens: Math.round(tokens * 0.12),
      cacheReadInputTokens: Math.round(tokens * 0.55),
      cacheCreationInputTokens: Math.round(tokens * 0.12),
      reasoningOutputTokens: Math.round(tokens * 0.03),
      webSearchRequests: index % 4,
    },
    byModel: [
      { modelId: 'claude-sonnet-5', tokens: Math.round(tokens * 0.52), costUSD: 0 },
      { modelId: 'claude-opus-4-8', tokens: Math.round(tokens * 0.24), costUSD: 0 },
      { modelId: 'gpt-5-codex', tokens: Math.round(tokens * 0.14), costUSD: 0 },
      { modelId: 'claude-haiku-4-5', tokens: Math.round(tokens * 0.06), costUSD: 0 },
      { modelId: 'gemini-2.5-pro', tokens: Math.round(tokens * 0.03), costUSD: 0 },
      { modelId: 'kimi-k2', tokens: Math.round(tokens * 0.01), costUSD: 0 },
    ],
    byUser: [
      { userId: 'u1', tokens: Math.round(tokens * 0.61), costUSD: 0 },
      { userId: 'u2', tokens: Math.round(tokens * 0.29), costUSD: 0 },
      { userId: 'u3', tokens: Math.round(tokens * 0.1), costUSD: 0 },
    ],
    users: {
      u1: { name: 'Ada Lovelace' },
      u2: { name: 'Grace Hopper' },
      u3: { email: 'kat@acme.dev' },
    },
  };
}

function Harness({ shape = 'default' }: { shape?: Shape }) {
  const [selectedDayMs, setSelectedDayMs] = useState<number | null>(null);
  return (
    <div className="mx-auto max-w-5xl p-6">
      <UsageCalendarVisualization
        calendar={buildCalendar(shape)}
        workspaceName="Acme Robotics"
        dayDetail={selectedDayMs === null ? undefined : buildDayDetail(selectedDayMs)}
        onSelectedDayChange={setSelectedDayMs}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: 'Settings/UsageCalendarVisualization',
  component: Harness,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Harness>;

export const Default: Story = { args: {} };
export const Empty: Story = { args: { shape: 'empty' } };
export const SingleDaySpike: Story = { args: { shape: 'outlier' } };
