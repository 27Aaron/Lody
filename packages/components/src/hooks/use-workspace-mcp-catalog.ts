import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { McpServerId, WorkspaceMcpServerMeta } from '@lody/shared';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import {
  acquireWorkspaceMcpCatalog,
  EMPTY_WORKSPACE_MCP_CATALOG,
  type WorkspaceMcpCatalogSnapshot,
} from '@/lib/workspace-mcp-catalog-room';
import {
  deleteWorkspaceMcpServer,
  putWorkspaceMcpServer,
  type WorkspaceMcpWriteResult,
} from '@/lib/workspace-mcp-write';

/**
 * Every consumer in a workspace reads one shared room, so the snapshot object
 * is identity-stable across mounts as well as renders — which is what lets the
 * selection and composer-menu memos downstream actually hit.
 */
export function useWorkspaceMcpCatalog(): WorkspaceMcpCatalogSnapshot {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const [snapshot, setSnapshot] = useState<WorkspaceMcpCatalogSnapshot>(
    EMPTY_WORKSPACE_MCP_CATALOG
  );

  useEffect(() => {
    if (!runtime) {
      setSnapshot(EMPTY_WORKSPACE_MCP_CATALOG);
      return undefined;
    }
    const lease = acquireWorkspaceMcpCatalog(runtime, setSnapshot);
    setSnapshot(lease.snapshot);
    return lease.release;
  }, [runtime]);

  return snapshot;
}

export function useWorkspaceMcpCatalogActions(): {
  upsert: (entry: WorkspaceMcpServerMeta) => Promise<WorkspaceMcpWriteResult>;
  remove: (id: McpServerId) => Promise<WorkspaceMcpWriteResult>;
} {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const upsert = useCallback(
    async (entry: WorkspaceMcpServerMeta) => {
      if (!runtime) throw new Error('Workspace runtime is unavailable');
      return putWorkspaceMcpServer(runtime, entry);
    },
    [runtime]
  );
  const remove = useCallback(
    async (id: McpServerId) => {
      if (!runtime) throw new Error('Workspace runtime is unavailable');
      return deleteWorkspaceMcpServer(runtime, id);
    },
    [runtime]
  );
  return { upsert, remove };
}
