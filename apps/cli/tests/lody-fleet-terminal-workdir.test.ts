import { describe, expect, it } from 'vitest';
import { type MachineId, type SessionId } from '@lody/shared';
import { LodyFleet } from '../src/lib/lody-fleet';
import type { Logger } from '../src/utils/logger';
import { createLocalCloudPort } from '@lody/platform';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

type LodyFleetTerminalInternals = {
  resolveActiveTerminalSessionWorkdir: (sessionId: SessionId) => Promise<string | null>;
};

function createFleet(): LodyFleetTerminalInternals {
  return new LodyFleet({
    logger: createSilentLogger(),
    builtinAgentConfigCliTypes: [],
    cliToken: 'token',
    userId: 'user-1',
    machineId: 'machine-1' as MachineId,
    machineName: 'machine',
    machineLifecycleCapability: {
      launchMode: 'foreground',
      canRemoteRestart: false,
      canRemoteUpgrade: false,
      reason: 'not_daemon',
    },
    runtimeStateReporter: {} as never,
    cloudPort: createLocalCloudPort({ identity: { userId: 'user-1' }, workspaces: [] }),
  }) as unknown as LodyFleetTerminalInternals;
}

describe('LodyFleet terminal workdir resolution', () => {
  it('lets non-active sessions fall through to metadata workdir resolution', async () => {
    const fleet = createFleet();

    await expect(
      fleet.resolveActiveTerminalSessionWorkdir('session-inactive' as SessionId)
    ).resolves.toBeNull();
  });
});
