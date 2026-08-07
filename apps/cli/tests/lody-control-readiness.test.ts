import { describe, expect, it, vi } from 'vitest';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { Logger } from '../src/utils/logger';

vi.mock('@/pkg', () => ({
  // Both named (instrument.ts) and default (analytics poster / lody-fleet) importers
  // resolve to this file, so the mock must expose both shapes.
  name: 'lody',
  version: '0.0.0-test',
  default: {
    name: 'lody',
    version: '0.0.0-test',
  },
}));

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

describe('Lody control readiness', () => {
  it('tracks streams recovery, not the raw aggregate transport status', async () => {
    const { Lody } = await import('../src/lib/lody');
    // The aggregate transport status reads `connecting` while any room is
    // lazily joining, so a workspace with many rooms is rarely fully
    // `connected`. Readiness must follow the recovery signal instead.
    let connected = false;
    let recovering = true;
    const documentManager = {
      isTransportConnected: () => connected,
      isTransportRecovering: () => recovering,
    } as unknown as LoroDocumentManager;

    const lody = new Lody(
      {
        logger: createSilentLogger(),
        workspaceId: 'workspace-1',
        token: 'token',
        userId: 'user-1',
        machineId: 'machine-1',
        machineName: 'machine-name',
      },
      documentManager
    );

    expect(lody.isControlPlaneReady()).toBe(false);

    // Still recovering even though the aggregate happens to read `connected`.
    connected = true;
    expect(lody.isControlPlaneReady()).toBe(false);

    recovering = false;
    expect(lody.isControlPlaneReady()).toBe(true);

    // Rooms joining (aggregate `connecting`) is not a degraded control plane.
    connected = false;
    expect(lody.isControlPlaneReady()).toBe(true);
  });
});
