import type { McpServerId, WorkspaceId } from './ids';
import {
  isWorkspaceMcpServerMeta,
  type WorkspaceMcpServerMeta,
} from './workspace-mcp';

export const WORKSPACE_FLOCK_DOC_STREAM_SEGMENT = 'wf';
const WORKSPACE_FLOCK_DOC_NAME = 'workspace';

export const getWorkspaceFlockDocId = (workspaceId: WorkspaceId): string =>
  `${workspaceId}:${WORKSPACE_FLOCK_DOC_STREAM_SEGMENT}:${WORKSPACE_FLOCK_DOC_NAME}`;

export type WorkspaceFlockMcpServerKey = ['mcpServer', McpServerId];
export type WorkspaceFlockKey = WorkspaceFlockMcpServerKey;

export const workspaceFlockKeys = {
  mcpServer: (id: McpServerId): WorkspaceFlockMcpServerKey => ['mcpServer', id],
} as const;

export type ParsedWorkspaceFlockKey = {
  kind: 'mcpServer';
  key: WorkspaceFlockMcpServerKey;
  mcpServerId: McpServerId;
};

export const parseWorkspaceFlockKey = (
  key: readonly unknown[]
): ParsedWorkspaceFlockKey | undefined => {
  if (key.length !== 2 || key[0] !== 'mcpServer' || typeof key[1] !== 'string') {
    return undefined;
  }
  const id = key[1].trim();
  if (!id) {
    return undefined;
  }
  const mcpServerId = id as McpServerId;
  return { kind: 'mcpServer', key: workspaceFlockKeys.mcpServer(mcpServerId), mcpServerId };
};

export type WorkspaceFlockMcpServerRow = {
  key: WorkspaceFlockMcpServerKey;
  value: WorkspaceMcpServerMeta;
};
export type WorkspaceFlockRow = WorkspaceFlockMcpServerRow;
export type WorkspaceFlockRowId = string & { __brand: 'WorkspaceFlockRowId' };
export type WorkspaceFlockRowMap = Record<WorkspaceFlockRowId, WorkspaceFlockRow>;

export type WorkspaceFlockScanRow = {
  readonly key: readonly unknown[];
  readonly value?: unknown;
};
export type WorkspaceFlockEvent = WorkspaceFlockScanRow;
export type WorkspaceFlockScanOptions = { readonly prefix?: readonly unknown[] };
export type WorkspaceFlockReadableFlock = {
  scan(options?: WorkspaceFlockScanOptions): Iterable<WorkspaceFlockScanRow>;
};
export type WorkspaceFlockWritableFlock = WorkspaceFlockReadableFlock & {
  set(key: WorkspaceFlockKey, value: unknown, timestamp?: number): void;
  delete(key: WorkspaceFlockKey, timestamp?: number): void;
  commit(): void;
};

export const serializeWorkspaceFlockKey = (key: WorkspaceFlockKey): WorkspaceFlockRowId =>
  JSON.stringify(key) as WorkspaceFlockRowId;

export const parseWorkspaceFlockRow = (
  key: readonly unknown[],
  value: unknown
): WorkspaceFlockRow | undefined => {
  const parsedKey = parseWorkspaceFlockKey(key);
  if (!parsedKey || !isWorkspaceMcpServerMeta(value) || value.id !== parsedKey.mcpServerId) {
    return undefined;
  }
  return { key: parsedKey.key, value };
};

export const readWorkspaceFlockRowsFromFlock = (
  flock: WorkspaceFlockReadableFlock
): WorkspaceFlockRowMap => {
  const rows: WorkspaceFlockRowMap = {};
  for (const row of flock.scan({ prefix: ['mcpServer'] })) {
    const parsed = parseWorkspaceFlockRow(row.key, row.value);
    if (parsed) {
      rows[serializeWorkspaceFlockKey(parsed.key)] = parsed;
    }
  }
  return rows;
};

export const getWorkspaceMcpCatalog = (
  rows: WorkspaceFlockRowMap
): Record<McpServerId, WorkspaceMcpServerMeta> => {
  const catalog = {} as Record<McpServerId, WorkspaceMcpServerMeta>;
  for (const row of Object.values(rows)) {
    catalog[row.key[1]] = row.value;
  }
  return catalog;
};

export const listWorkspaceMcpServers = (rows: WorkspaceFlockRowMap): WorkspaceMcpServerMeta[] =>
  Object.values(rows)
    .map((row) => row.value)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

const workspaceFlockRowsEqual = (
  left: WorkspaceFlockRow | undefined,
  right: WorkspaceFlockRow | undefined
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
};

export const writeWorkspaceMcpServerToFlock = (
  flock: WorkspaceFlockWritableFlock,
  entry: WorkspaceMcpServerMeta
): boolean => {
  const row = parseWorkspaceFlockRow(workspaceFlockKeys.mcpServer(entry.id), entry);
  if (!row) {
    return false;
  }
  const rowId = serializeWorkspaceFlockKey(row.key);
  const previous = readSingleRow(flock, row.key)[rowId];
  if (workspaceFlockRowsEqual(previous, row)) {
    return false;
  }
  flock.set(row.key, row.value);
  flock.commit();
  return true;
};

export const deleteWorkspaceMcpServerFromFlock = (
  flock: WorkspaceFlockWritableFlock,
  id: McpServerId
): boolean => {
  const key = workspaceFlockKeys.mcpServer(id);
  const rowId = serializeWorkspaceFlockKey(key);
  if (!readSingleRow(flock, key)[rowId]) {
    return false;
  }
  flock.delete(key);
  flock.commit();
  return true;
};

export const applyWorkspaceFlockRowEvents = (
  previous: WorkspaceFlockRowMap,
  events: readonly WorkspaceFlockEvent[]
): WorkspaceFlockRowMap => {
  let next: WorkspaceFlockRowMap | null = null;
  const mutableNext = (): WorkspaceFlockRowMap => {
    next ??= { ...previous };
    return next;
  };

  for (const event of events) {
    const parsedKey = parseWorkspaceFlockKey(event.key);
    if (!parsedKey) continue;
    const rowId = serializeWorkspaceFlockKey(parsedKey.key);
    const current = next ?? previous;
    if (event.value === undefined) {
      if (Object.prototype.hasOwnProperty.call(current, rowId)) {
        delete mutableNext()[rowId];
      }
      continue;
    }
    const parsed = parseWorkspaceFlockRow(event.key, event.value);
    if (!parsed) {
      if (Object.prototype.hasOwnProperty.call(current, rowId)) {
        delete mutableNext()[rowId];
      }
      continue;
    }
    if (!workspaceFlockRowsEqual(current[rowId], parsed)) {
      mutableNext()[rowId] = parsed;
    }
  }
  return next ?? previous;
};

const readSingleRow = (
  flock: WorkspaceFlockReadableFlock,
  key: WorkspaceFlockKey
): WorkspaceFlockRowMap => {
  const rows: WorkspaceFlockRowMap = {};
  for (const candidate of flock.scan({ prefix: key })) {
    const row = parseWorkspaceFlockRow(candidate.key, candidate.value);
    if (row) rows[serializeWorkspaceFlockKey(row.key)] = row;
  }
  return rows;
};
