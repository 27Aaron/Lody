import {
  getWorkspaceFlockDocId,
  workspaceFlockKeys,
  type McpServerId,
  type WorkspaceId,
  type WorkspaceMcpServerMeta,
} from '@lody/shared';
import type { WorkspaceRuntime } from '@/atoms/runtime';

export type WorkspaceMcpWriteResult = { synced: boolean; syncError?: string };

export type WorkspaceMcpWriteDeps = {
  workspaceId: WorkspaceId;
  writer: Pick<WorkspaceRuntime['writer'], 'flockRowPut' | 'flockRowDelete'>;
  repo: Pick<WorkspaceRuntime['repo'], 'openFlockDoc'>;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const uploadWorkspaceDoc = async (
  deps: WorkspaceMcpWriteDeps
): Promise<WorkspaceMcpWriteResult> => {
  try {
    const handle = await deps.repo.openFlockDoc(getWorkspaceFlockDocId(deps.workspaceId));
    await handle.syncOnce();
    return { synced: true };
  } catch (error) {
    return { synced: false, syncError: getErrorMessage(error) };
  }
};

export const putWorkspaceMcpServer = async (
  deps: WorkspaceMcpWriteDeps,
  entry: WorkspaceMcpServerMeta
): Promise<WorkspaceMcpWriteResult> => {
  await deps.writer.flockRowPut(
    getWorkspaceFlockDocId(deps.workspaceId),
    workspaceFlockKeys.mcpServer(entry.id),
    entry
  );
  return uploadWorkspaceDoc(deps);
};

export const deleteWorkspaceMcpServer = async (
  deps: WorkspaceMcpWriteDeps,
  id: McpServerId
): Promise<WorkspaceMcpWriteResult> => {
  await deps.writer.flockRowDelete(
    getWorkspaceFlockDocId(deps.workspaceId),
    workspaceFlockKeys.mcpServer(id)
  );
  return uploadWorkspaceDoc(deps);
};
