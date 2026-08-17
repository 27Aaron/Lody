import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceMcpServerMeta } from '@lody/shared';
import {
  deleteWorkspaceMcpServer,
  putWorkspaceMcpServer,
  type WorkspaceMcpWriteDeps,
} from '../src/lib/workspace-mcp-write';

const workspaceId = 'workspace-1' as WorkspaceMcpWriteDeps['workspaceId'];
const entry: WorkspaceMcpServerMeta = {
  id: 'server-1' as WorkspaceMcpServerMeta['id'],
  name: 'Files',
  transport: 'stdio',
  connection: { transport: 'stdio', command: 'mcp-files' },
  createdAt: 1,
  updatedAt: 1,
};

function createDeps(options?: { openError?: Error; syncError?: Error }) {
  const calls: string[] = [];
  const syncOnce = vi.fn(async () => {
    calls.push('syncOnce');
    if (options?.syncError) throw options.syncError;
  });
  const deps = {
    workspaceId,
    writer: {
      flockRowPut: vi.fn(async () => {
        calls.push('flockRowPut');
      }),
      flockRowDelete: vi.fn(async () => {
        calls.push('flockRowDelete');
      }),
    },
    repo: {
      openFlockDoc: vi.fn(async () => {
        calls.push('openFlockDoc');
        if (options?.openError) throw options.openError;
        return { syncOnce };
      }),
    },
  } as unknown as WorkspaceMcpWriteDeps;
  return { calls, deps };
}

describe('workspace MCP writes', () => {
  it('uploads only after the authored put completes', async () => {
    const { calls, deps } = createDeps();
    await expect(putWorkspaceMcpServer(deps, entry)).resolves.toEqual({ synced: true });
    expect(calls).toEqual(['flockRowPut', 'openFlockDoc', 'syncOnce']);
  });

  it('reports upload failures without rejecting the durable local write', async () => {
    const { deps } = createDeps({ syncError: new Error('network unavailable') });
    await expect(deleteWorkspaceMcpServer(deps, entry.id)).resolves.toEqual({
      synced: false,
      syncError: 'network unavailable',
    });
  });

  it('reports failures to open the upload handle', async () => {
    const { deps } = createDeps({ openError: new Error('room unavailable') });
    await expect(putWorkspaceMcpServer(deps, entry)).resolves.toEqual({
      synced: false,
      syncError: 'room unavailable',
    });
  });
});
