import type { Meta, StoryObj } from '@storybook/react';
import type { ElectronCliState } from '@lody/shared';
import { CliDaemonSetting } from '@/components/settings/cli-daemon-setting';
import { CompactSection } from '@/components/settings/compact-layout';

function installElectronApiMock(state: ElectronCliState): void {
  if (typeof window === 'undefined') return;
  window.__LODY_ELECTRON__ = true;
  window.api = {
    ...(window.api ?? {}),
    cliState: {
      getState: async () => state,
      restart: async () => ({ ok: true }),
      terminate: async () => ({ ok: true }),
      onState: (handler) => {
        handler(state);
        return () => {};
      },
    },
  };
}

function Harness({ cliState }: { cliState: ElectronCliState }) {
  installElectronApiMock(cliState);
  return (
    <div className="w-[640px] bg-background p-4">
      <CompactSection title="Startup">
        <CliDaemonSetting />
      </CompactSection>
    </div>
  );
}

const runningCliState: ElectronCliState = {
  phase: 'running',
  desiredState: 'running',
  updatedAtMs: 0,
  preventSleepEnabled: true,
  connectivity: 'online',
};

const meta = {
  title: 'Desktop/CliDaemonSetting',
  component: Harness,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  args: { cliState: runningCliState },
};

export const Stopped: Story = {
  args: {
    cliState: { phase: 'stopped', desiredState: 'stopped', updatedAtMs: 0, preventSleepEnabled: true },
  },
};

export const Degraded: Story = {
  args: {
    cliState: { ...runningCliState, phase: 'degraded' },
  },
};
