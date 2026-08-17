import { describe, expect, it, vi } from 'vitest';
import { workspaceFlockKeys, type WorkspaceMcpServerMeta } from '@lody/shared';
import type { WorkspaceRuntime } from '../src/atoms/runtime';
import {
  acquireWorkspaceMcpCatalog,
  type WorkspaceMcpCatalogSnapshot,
} from '../src/lib/workspace-mcp-catalog-room';

const entry = (id: string, name: string): WorkspaceMcpServerMeta => ({
  id: id as WorkspaceMcpServerMeta['id'],
  name,
  transport: 'stdio',
  connection: { transport: 'stdio', command: 'mcp-files' },
  createdAt: 1,
  updatedAt: 1,
});

// The room's startup is a chain of awaits on already-resolved promises, so
// draining microtasks settles it deterministically — no timers, no wall clock.
const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 20; tick += 1) {
    await Promise.resolve();
  }
};

/**
 * Minimal stand-in for the workspace runtime: one Flock document whose rows,
 * events, and first remote sync are driven by the test rather than a transport.
 */
function createRuntime(workspaceId: string, rows: WorkspaceMcpServerMeta[]) {
  const listeners: Array<(batch: unknown) => void> = [];
  let completeFirstSync!: () => void;
  const firstSyncedWithRemote = new Promise<void>((resolve) => {
    completeFirstSync = resolve;
  });
  const unsubscribeRoom = vi.fn();
  const current = [...rows];

  const flock = {
    scan: () => current.map((value) => ({ key: workspaceFlockKeys.mcpServer(value.id), value })),
    subscribe: (listener: (batch: unknown) => void) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    },
  };
  const joinRoom = vi.fn(async () => ({ unsubscribe: unsubscribeRoom, firstSyncedWithRemote }));
  const openFlockDoc = vi.fn(async () => ({ flock, joinRoom }));

  return {
    runtime: { workspaceId, repo: { openFlockDoc } } as unknown as WorkspaceRuntime,
    openFlockDoc,
    joinRoom,
    unsubscribeRoom,
    subscriberCount: () => listeners.length,
    emit: (value: WorkspaceMcpServerMeta) => {
      current.push(value);
      for (const listener of listeners) {
        listener({ events: [{ key: workspaceFlockKeys.mcpServer(value.id), value }] });
      }
    },
    completeFirstSync: () => completeFirstSync(),
  };
}

describe('workspace MCP catalog room', () => {
  it('opens one document, subscription, and room for every consumer of a workspace', async () => {
    const harness = createRuntime('workspace-shared', [entry('server-1', 'Files')]);
    const first: WorkspaceMcpCatalogSnapshot[] = [];
    const second: WorkspaceMcpCatalogSnapshot[] = [];

    const leaseA = acquireWorkspaceMcpCatalog(harness.runtime, (snapshot) => first.push(snapshot));
    const leaseB = acquireWorkspaceMcpCatalog(harness.runtime, (snapshot) => second.push(snapshot));
    await settle();

    expect(harness.openFlockDoc).toHaveBeenCalledTimes(1);
    expect(harness.joinRoom).toHaveBeenCalledTimes(1);
    expect(harness.subscriberCount()).toBe(1);

    // Both consumers get the same snapshot object, so a memo keyed on it holds
    // across every surface that mounted the catalog.
    expect(first.at(-1)?.servers.map(({ name }) => name)).toEqual(['Files']);
    expect(second.at(-1)).toBe(first.at(-1));

    leaseA.release();
    leaseB.release();
  });

  it('keeps the room alive until the last consumer releases', async () => {
    const harness = createRuntime('workspace-refcount', [entry('server-1', 'Files')]);
    const leaseA = acquireWorkspaceMcpCatalog(harness.runtime, vi.fn());
    const leaseB = acquireWorkspaceMcpCatalog(harness.runtime, vi.fn());
    await settle();

    leaseA.release();
    expect(harness.unsubscribeRoom).not.toHaveBeenCalled();
    expect(harness.subscriberCount()).toBe(1);

    leaseB.release();
    expect(harness.unsubscribeRoom).toHaveBeenCalledTimes(1);
    expect(harness.subscriberCount()).toBe(0);
  });

  it('publishes flock events and the authoritative post-sync read to every consumer', async () => {
    const harness = createRuntime('workspace-events', [entry('server-1', 'Files')]);
    const seen: WorkspaceMcpCatalogSnapshot[] = [];
    const lease = acquireWorkspaceMcpCatalog(harness.runtime, (snapshot) => seen.push(snapshot));
    await settle();
    expect(seen.at(-1)?.synced).toBe(false);

    harness.emit(entry('server-2', 'Ada'));
    expect(seen.at(-1)?.servers.map(({ name }) => name)).toEqual(['Ada', 'Files']);

    harness.completeFirstSync();
    await settle();
    expect(seen.at(-1)?.synced).toBe(true);
    expect(seen.at(-1)?.servers.map(({ name }) => name)).toEqual(['Ada', 'Files']);

    lease.release();
  });
});
