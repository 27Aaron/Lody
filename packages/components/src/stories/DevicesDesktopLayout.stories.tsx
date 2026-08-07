import type { Meta, StoryObj } from '@storybook/react';
import { useMemo, useState } from 'react';
import { fn } from 'storybook/test';
import type {
  AgentConfigId,
  AgentConfigMeta,
  MachineId,
  MachineMonitorSnapshot,
  SessionId,
  SessionMeta,
} from '@lody/shared';
import { MachineTabList, type MachineTabItem } from '@/components/settings/machine-tab-list';
import { MachineDetailPane } from '@/components/settings/machine-detail-pane';
import { resolveDesktopMachineSelection } from '@/components/settings/machine-selection';
import type { MachineSettingsFilter } from '@/atoms/settings-machine-tab';

/**
 * Composed preview of the desktop Devices settings tab: machines get their own
 * left column with per-row share status, and the selected machine renders a
 * detail pane whose header exposes rename/share/restart/revoke/delete inline
 * (no ⋮ menu on desktop). Mirrors `MachineAgentSettings` mode="devices".
 */

type FixtureMachine = {
  id: MachineId;
  name: string;
  os: string;
  cliVersion: string;
  isOwn: boolean;
  isOnline: boolean;
  sharedWithTeam: boolean;
  ownerName: string | null;
};

const fixtureMachines: FixtureMachine[] = [
  {
    id: 'machine-mbp' as MachineId,
    name: 'MacBook-Pro.local',
    os: 'macOS 15.2',
    cliVersion: '0.57.1-next.47',
    isOwn: true,
    isOnline: true,
    sharedWithTeam: true,
    ownerName: null,
  },
  {
    id: 'machine-mini' as MachineId,
    name: 'zxdeMac-mini.local',
    os: 'macOS 15.1',
    cliVersion: '0.57.1-next.47',
    isOwn: true,
    isOnline: true,
    sharedWithTeam: false,
    ownerName: null,
  },
  {
    id: 'machine-beast' as MachineId,
    name: 'loro-beast',
    os: 'Linux',
    cliVersion: '0.57.0',
    isOwn: false,
    isOnline: false,
    sharedWithTeam: true,
    ownerName: 'Bob Smith',
  },
  {
    id: 'machine-hel' as MachineId,
    name: 'ubuntu-8gb-hel1-1',
    os: 'Ubuntu 24.04',
    cliVersion: '0.56.3',
    isOwn: true,
    isOnline: false,
    sharedWithTeam: false,
    ownerName: null,
  },
];

const resource = {
  memoryBytes: 768 * 1024 * 1024,
  cpuCores: 0.72,
  cpuPercentOfMachine: 9,
  processCount: 6,
  memoryKind: 'cgroup-current' as const,
  quality: 'exact-cgroup' as const,
};

const monitorSnapshot = (machineId: MachineId): MachineMonitorSnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  machineId,
  instanceId: 'cli-story',
  updatedAtMs: Date.now(),
  sampleWindowMs: 2_000,
  platform: 'darwin',
  cpuLogicalCores: 12,
  deviceCpuCores: 1.4,
  effectiveMemoryBytes: 32 * 1024 * 1024 * 1024,
  availableMemoryBytes: 22 * 1024 * 1024 * 1024,
  sessionAccounting: 'process-tree',
  cliControlPlane: {
    ...resource,
    memoryBytes: 180 * 1024 * 1024,
    cpuCores: 0.04,
    processCount: 1,
    memoryKind: 'physical-footprint',
    quality: 'exact-process',
  },
  sessionsAggregate: {
    ...resource,
    memoryBytes: 3.4 * 1024 * 1024 * 1024,
    cpuCores: 1.36,
    processCount: 29,
    memoryKind: 'physical-footprint-sum',
    quality: 'estimated-tree',
  },
  sessions: [
    {
      sessionId: 'session-launch-video' as SessionId,
      parentSessionId: null,
      agentCliType: 'builtin',
      agentType: 'kimi',
      status: 'running',
      lastActivityAtMs: Date.now(),
      startedAtMs: Date.now() - 90_000,
      resource: {
        ...resource,
        memoryBytes: 2.3 * 1024 * 1024 * 1024,
        cpuCores: 1.36,
        processCount: 15,
        memoryKind: 'physical-footprint-sum',
        quality: 'estimated-tree',
      },
    },
    {
      sessionId: 'session-stream-sync' as SessionId,
      parentSessionId: null,
      agentCliType: 'builtin',
      agentType: 'kimi',
      status: 'running',
      lastActivityAtMs: Date.now() - 5_000,
      startedAtMs: Date.now() - 300_000,
      resource: {
        ...resource,
        memoryBytes: 398 * 1024 * 1024,
        cpuCores: 0.017,
        processCount: 2,
        memoryKind: 'physical-footprint-sum',
        quality: 'estimated-tree',
      },
    },
    {
      sessionId: 'session-onboarding' as SessionId,
      parentSessionId: null,
      agentCliType: 'builtin',
      agentType: 'codex',
      status: 'running',
      lastActivityAtMs: Date.now() - 120_000,
      startedAtMs: Date.now() - 600_000,
      resource: {
        ...resource,
        memoryBytes: 392 * 1024 * 1024,
        cpuCores: 0.01,
        processCount: 6,
        memoryKind: 'physical-footprint-sum',
        quality: 'estimated-tree',
      },
    },
  ],
  sessionsTruncated: false,
  warnings: [],
});

const agentConfigs = (machineId: MachineId): AgentConfigMeta[] => [
  {
    id: 'config-kimi' as AgentConfigId,
    machineId,
    name: 'Kimi Code',
    description: undefined,
    cliType: 'builtin',
    agentType: 'kimi',
    env: {},
  },
  {
    id: 'config-codex' as AgentConfigId,
    machineId,
    name: 'Codex',
    description: undefined,
    cliType: 'builtin',
    agentType: 'codex',
    env: {},
  },
];

const sessionMetas = (machineId: MachineId): SessionMeta[] => [
  {
    id: 'session-launch-video' as SessionId,
    machineId,
    createdAt: new Date().toISOString(),
    title: 'Lody Product Launch Video',
    userId: 'user-story',
    cliType: 'builtin',
    agentType: 'kimi',
    agentConfigId: 'config-kimi' as AgentConfigId,
  },
  {
    id: 'session-stream-sync' as SessionId,
    machineId,
    createdAt: new Date().toISOString(),
    title: '桌面端 stream 加载不显示 Syncing',
    userId: 'user-story',
    cliType: 'builtin',
    agentType: 'kimi',
    agentConfigId: 'config-kimi' as AgentConfigId,
  },
  {
    id: 'session-onboarding' as SessionId,
    machineId,
    createdAt: new Date().toISOString(),
    title: 'Lody 多平台 onboarding 登录方式评估',
    userId: 'user-story',
    cliType: 'builtin',
    agentType: 'codex',
    agentConfigId: 'config-codex' as AgentConfigId,
  },
];

function DevicesDesktopLayout({ initialSelectedId }: { initialSelectedId?: MachineId }) {
  const [filter, setFilter] = useState<MachineSettingsFilter>({
    onlineOnly: false,
    mineOnly: false,
  });
  const [selectedId, setSelectedId] = useState<MachineId>(
    initialSelectedId ?? fixtureMachines[0]!.id
  );

  const allItems: MachineTabItem[] = useMemo(
    () =>
      fixtureMachines.map((machine) => ({
        machine: {
          id: machine.id,
          name: machine.name,
          os: machine.os,
          cliVersion: machine.cliVersion,
          sessions: [],
          raceLimits: {},
          ownerUserId: machine.isOwn ? 'user-story' : 'user-teammate',
        },
        isOwn: machine.isOwn,
        isOnline: machine.isOnline,
        sharedWithTeam: machine.sharedWithTeam,
      })),
    []
  );
  const items = useMemo(
    () =>
      allItems
        .filter((item) => {
          if (filter.onlineOnly && !item.isOnline) return false;
          if (filter.mineOnly && !item.isOwn) return false;
          return true;
        })
        .sort((a, b) => {
          if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
          return a.machine.name.localeCompare(b.machine.name);
        }),
    [allItems, filter]
  );

  // Mirror the desktop invariant from MachineAgentSettings: the detail pane can
  // only render a machine that is visible in the (filtered) list; a filtered-out
  // selection falls back to a visible machine.
  const { resolved: resolvedMachine } = resolveDesktopMachineSelection({
    pool: items,
    selectedMachineId: selectedId,
    localMachineId: fixtureMachines[0]!.id,
  });
  const selected =
    fixtureMachines.find((machine) => machine.id === resolvedMachine?.id) ?? null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">Devices</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Resource usage and running agents on each connected device.
        </p>
      </div>
      <div className="flex min-w-0 items-start gap-5">
        <aside className="w-60 shrink-0">
          <MachineTabList
            items={items}
            selectedMachineId={selected?.id ?? null}
            onSelect={setSelectedId}
            filter={filter}
            onFilterChange={setFilter}
            totalBeforeFilter={allItems.length}
          />
        </aside>
        <div className="min-w-0 flex-1">
          {selected ? (
            <MachineDetailPane
              key={selected.id}
              mode="devices"
              machine={{
                id: selected.id,
                name: selected.name,
                os: selected.os,
                cliVersion: selected.cliVersion,
                sessions: [],
                raceLimits: {},
                ownerUserId: selected.isOwn ? 'user-story' : 'user-teammate',
              }}
              configs={agentConfigs(selected.id)}
              isOwn={selected.isOwn}
              isLocal={selected.id === fixtureMachines[0]!.id}
              ownerName={selected.ownerName}
              sharedWithTeam={selected.sharedWithTeam}
              canDelete={!selected.isOnline && selected.isOwn}
              onRename={fn(async () => {})}
              onDelete={fn(async () => {})}
              onSharedWithTeamChange={selected.isOwn ? fn(async () => {}) : undefined}
              onAddConfig={fn()}
              onEditConfig={fn()}
              onDeleteConfig={fn(async () => {})}
              onRefreshConfig={fn(async () => {})}
              onPing={fn(async () => 18)}
              onRestartDaemon={selected.isOnline ? fn(async () => {}) : undefined}
              canRevokeCredentials={selected.isOwn}
              onRevokeCredentials={selected.isOwn ? fn(async () => {}) : undefined}
              monitorSnapshot={selected.isOnline ? monitorSnapshot(selected.id) : null}
              monitorState={selected.isOnline ? 'active' : 'disabled'}
              monitorSessionMetas={sessionMetas(selected.id)}
              onOpenMonitorSession={fn()}
              onTerminateMonitorSession={fn(async () => {})}
            />
          ) : (
            <div className="px-1 py-8 text-center text-sm text-muted-foreground">
              Select a device.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: 'Settings/DevicesDesktopLayout',
  component: DevicesDesktopLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background px-6 py-6 text-foreground">
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof DevicesDesktopLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OwnSharedMachine: Story = {};

export const TeammateMachine: Story = {
  args: { initialSelectedId: 'machine-beast' as MachineId },
};

export const OfflinePrivateMachine: Story = {
  args: { initialSelectedId: 'machine-hel' as MachineId },
};
