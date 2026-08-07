import type { Meta, StoryObj } from '@storybook/react-vite';
import { getRateLimitEntryKey, getServerNow } from '@lody/shared';

import { SessionUsagePopover } from '@/components/sessions/session-usage-popover';

const codexLimits = {
  [getRateLimitEntryKey('codex', 'codex')]: {
    schemaVersion: 2 as const,
    planName: 'ChatGPT Plus',
    limitId: 'codex',
    windows: [
      {
        usedPercent: 18,
        windowDurationMins: 5 * 60,
        resetsAt: getServerNow() + 2 * 60 * 60 * 1000,
      },
      {
        usedPercent: 42,
        windowDurationMins: 7 * 24 * 60,
        resetsAt: getServerNow() + 4 * 24 * 60 * 60 * 1000,
      },
    ],
    fiveHour: 18,
    sevenDay: 42,
    fiveHourResetAt: getServerNow() + 2 * 60 * 60 * 1000,
    sevenDayResetAt: getServerNow() + 4 * 24 * 60 * 60 * 1000,
  },
};

const meta = {
  title: 'Sessions/SessionUsagePopover',
  component: SessionUsagePopover,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    agentType: 'codex',
    modelId: 'gpt-5.4',
    modelLabel: 'GPT-5.4',
  },
} satisfies Meta<typeof SessionUsagePopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContextAndQuota: Story = {
  args: {
    contextWindowUsage: { size: 256_000, used: 81_920 },
    rateLimits: codexLimits,
  },
};

export const ContextOnly: Story = {
  args: {
    contextWindowUsage: { size: 200_000, used: 168_000 },
  },
};

export const Compacting: Story = {
  args: {
    contextWindowUsage: { size: 200_000, used: 168_000 },
    rateLimits: codexLimits,
    isContextCompacting: true,
  },
};

export const QuotaOnly: Story = {
  args: {
    rateLimits: codexLimits,
    showRateLimitWithoutContext: true,
  },
};

export const WeeklyOnly: Story = {
  args: {
    contextWindowUsage: { size: 258_000, used: 119_000 },
    rateLimits: {
      [getRateLimitEntryKey('codex', 'codex')]: {
        schemaVersion: 2,
        planName: 'ChatGPT Plus',
        limitId: 'codex',
        windows: [
          {
            usedPercent: 29,
            windowDurationMins: 7 * 24 * 60,
            resetsAt: getServerNow() + 5 * 24 * 60 * 60 * 1000,
          },
        ],
        fiveHour: null,
        sevenDay: 29,
        fiveHourResetAt: null,
        sevenDayResetAt: getServerNow() + 5 * 24 * 60 * 60 * 1000,
      },
    },
  },
};

export const LegacyCodexWeeklyOnly: Story = {
  args: {
    modelId: 'gpt-5.5',
    modelLabel: '5.5',
    contextWindowUsage: { size: 258_000, used: 152_000 },
    rateLimits: {
      [getRateLimitEntryKey('codex', 'codex')]: {
        planName: 'ChatGPT Plus',
        limitId: 'codex',
        fiveHour: 29,
        sevenDay: null,
        fiveHourResetAt: getServerNow() + 5 * 24 * 60 * 60 * 1000,
        sevenDayResetAt: null,
      },
    },
  },
};

export const Unavailable: Story = {
  args: {
    contextWindowUsage: undefined,
    rateLimits: {
      [getRateLimitEntryKey('codex', 'codex')]: {
        planName: null,
        limitId: 'codex',
        fiveHour: null,
        sevenDay: null,
        fiveHourResetAt: null,
        sevenDayResetAt: null,
        apiUnavailable: true,
      },
    },
  },
};
