// @vitest-environment jsdom

import { createElement, useEffect, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Flock } from '@loro-dev/flock-wasm';
import {
  getSessionRoomId,
  readCodeCollabFileIndexFromFlock,
  type MachineId,
  type SessionId,
  type SessionMeta,
} from '@lody/shared';

import {
  materializeCodeCollabV2FileIndexForFileProvider,
  useCodeCollabSessionFileProvider,
  type UseCodeCollabSessionFileProviderResult,
} from '../src/hooks/use-code-collab-session-file-provider';
import { sessionMetaCacheAtom } from '../src/atoms/doc-meta';
import { runtimeAtom, type WorkspaceRuntime } from '../src/atoms/runtime';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root && container) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
});

const makeSyncedFlockRoom = (firstSyncedWithRemote: Promise<void> = Promise.resolve()) => {
  // The hook selects the readiness BINDING's first-sync promise (selection,
  // not merging), so the injected promise must live on the binding too.
  const binding = {
    transportId: 'cloud',
    status: 'joined' as const,
    onStatusChange: vi.fn(() => vi.fn()),
    firstSyncedWithRemote,
    waitUntilSynced: vi.fn(async () => undefined),
    rejoin: vi.fn(async () => undefined),
  };
  return {
    unsubscribe: vi.fn(),
    firstSyncedWithRemote,
    waitUntilSynced: vi.fn(async () => undefined),
    transportIds: () => ['cloud'],
    subscription: vi.fn(() => binding),
    subscriptions: () => [binding],
  };
};

const createRuntime = (overrides: Record<string, unknown>): WorkspaceRuntime =>
  ({
    workspaceId: 'workspace-1',
    workspaceSlug: 'workspace',
    prepareSessionTarget: vi.fn(async () => 'cloud' as const),
    ...overrides,
  }) as unknown as WorkspaceRuntime;

describe('readCodeCollabFileIndexFromFlock', () => {
  it('reads path-keyed file index rows and skips invalid rows', () => {
    const flock = new Flock('test-peer');
    flock.set(['README.md'], { kind: 'text', change: { diff: [1, 0] } });
    flock.set(['assets/logo.png'], { kind: 'binary' });
    flock.set(['nested', 'bad'], { kind: 'text' });
    flock.set(['bad.txt'], { kind: 'unknown' });
    flock.commit();

    expect(readCodeCollabFileIndexFromFlock(flock)).toEqual({
      'README.md': { kind: 'text', change: { diff: [1, 0] } },
      'assets/logo.png': { kind: 'binary' },
    });
  });
});

describe('materializeCodeCollabV2FileIndexForFileProvider', () => {
  it('waits for file-index loading before creating a provider state', () => {
    expect(
      materializeCodeCollabV2FileIndexForFileProvider({
        fileIndex: null,
        revision: 0,
        sourceState: 'live-collaborative',
      })
    ).toBeNull();
  });

  it('accepts an explicitly empty file index', () => {
    const state = materializeCodeCollabV2FileIndexForFileProvider({
      fileIndex: {},
      revision: 1,
      updatedAtMs: 123,
      sourceState: 'live-collaborative',
    });

    expect(state).toMatchObject({
      fileTree: {},
      allChanges: {},
      updatedAtMs: 123,
    });
    expect(state?.files).toEqual([]);
  });

  it('builds file tree entries and All Changes from one path-keyed table', () => {
    const state = materializeCodeCollabV2FileIndexForFileProvider({
      fileIndex: {
        '.git': { kind: 'skipped', reason: 'ignored_directory' },
        'README.md': { kind: 'file', change: { diff: [1, 0] } },
        docs: { kind: 'lazy' },
        'docs/deleted.md': { kind: 'deleted', change: { del: true, diff: [0, 3] } },
        large: true,
      },
      revision: 2,
      sourceState: 'live-collaborative',
    });

    expect(state?.fileTree).toEqual({
      '.git': { kind: 'skipped', reason: 'ignored_directory' },
      'README.md': true,
      docs: { kind: 'lazy' },
      large: true,
    });
    expect(state?.allChanges).toEqual({
      'README.md': { diff: [1, 0] },
      'docs/deleted.md': { del: true, diff: [0, 3] },
    });
    expect(state?.files.map((entry) => entry.path)).toEqual(['.git', 'docs', 'large', 'README.md']);
  });
});

describe('useCodeCollabSessionFileProvider', () => {
  it('publishes the remote file index after a read-only Flock catchup', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-remote-first-sync' as SessionId;
    const machineId = 'machine-1' as MachineId;
    let remoteVisible = false;
    const scan = vi.fn(() =>
      remoteVisible
        ? [{ key: ['README.md'], value: { kind: 'text', change: { diff: [1, 0] } } }]
        : []
    );
    const fakeFlock = {
      scan,
      subscribe: vi.fn(() => vi.fn()),
    };
    const initDirectory = vi.fn(
      () => new Promise<{ status: 'ok'; path: string; publishedEntries: number }>(() => undefined)
    );
    const syncOnce = vi.fn(async () => {
      remoteVisible = true;
    });
    const joinRoom = vi.fn(async () => {
      remoteVisible = true;
      return makeSyncedFlockRoom();
    });
    const openFlockDoc = vi.fn(async () => ({
      flock: fakeFlock,
      syncOnce,
      joinRoom,
    }));
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: initDirectory,
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks();
    expect(openFlockDoc).toHaveBeenCalledWith('workspace-1:fi:session-remote-first-sync');
    expect(syncOnce).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(initDirectory).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)).toMatchObject({
      status: 'ready',
      role: 'write',
    });
    await expect(updates.at(-1)?.provider?.listFiles()).resolves.toEqual([
      expect.objectContaining({ path: 'README.md' }),
    ]);
  });

  it('prepares the remote target and reads the shared file-index Flock', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-remote-file-index' as SessionId;
    const machineId = 'machine-remote' as MachineId;
    const signalFlock = {
      scan: vi.fn(() => [
        {
          key: ['remote.ts'],
          value: { kind: 'text', change: { diff: [2, 0] as [number, number] } },
        },
      ]),
      subscribe: vi.fn(() => vi.fn()),
    };
    const syncSignalOnce = vi.fn(async () => undefined);
    const joinSignalRoom = vi.fn(async () => makeSyncedFlockRoom());
    const openFlockDoc = vi.fn(async (flockDocId: string) => {
      if (flockDocId !== 'workspace-1:fi:session-remote-file-index') {
        throw new Error(`Unexpected Flock doc: ${flockDocId}`);
      }
      return {
        flock: signalFlock,
        syncOnce: syncSignalOnce,
        joinRoom: joinSignalRoom,
      };
    });
    const prepareSessionTarget = vi.fn(async () => 'cloud' as const);
    store.set(
      runtimeAtom,
      createRuntime({
        prepareSessionTarget,
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: vi.fn(),
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks(8);

    expect(prepareSessionTarget).toHaveBeenCalledWith(sessionId, machineId);
    expect(openFlockDoc).toHaveBeenCalledWith('workspace-1:fi:session-remote-file-index');
    expect(syncSignalOnce).not.toHaveBeenCalled();
    expect(joinSignalRoom).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)).toMatchObject({
      status: 'ready',
      role: 'write',
    });
    await expect(updates.at(-1)?.provider?.listFiles()).resolves.toEqual([
      expect.objectContaining({ path: 'remote.ts' }),
    ]);
    await expect(updates.at(-1)?.provider?.listChangedFiles()).resolves.toMatchObject({
      status: 'ready',
      files: [expect.objectContaining({ path: 'remote.ts', add: 2, del: 0 })],
    });
  });

  it('applies remote file-index Flock events without Machine RPC snapshots', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-remote-events' as SessionId;
    const machineId = 'machine-remote' as MachineId;
    let signalListener:
      | ((batch: { events: readonly { key: readonly unknown[]; value?: unknown }[] }) => void)
      | null = null;
    const signalFlock = {
      scan: vi.fn(() => [
        {
          key: ['before.ts'],
          value: { kind: 'text', change: { diff: [1, 0] as [number, number] } },
        },
      ]),
      subscribe: vi.fn((listener) => {
        signalListener = listener;
        return vi.fn();
      }),
    };
    const syncSignalOnce = vi.fn(async () => undefined);
    const joinSignalRoom = vi.fn(async () => makeSyncedFlockRoom());
    const openFlockDoc = vi.fn(async (flockDocId: string) => {
      if (flockDocId !== 'workspace-1:fi:session-remote-events') {
        throw new Error(`Unexpected Flock doc: ${flockDocId}`);
      }
      return {
        flock: signalFlock,
        syncOnce: syncSignalOnce,
        joinRoom: joinSignalRoom,
      };
    });
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: vi.fn(),
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks(8);

    expect(signalListener).not.toBeNull();
    expect(syncSignalOnce).not.toHaveBeenCalled();
    expect(joinSignalRoom).toHaveBeenCalledTimes(1);
    await expect(updates.at(-1)?.provider?.listFiles()).resolves.toEqual([
      expect.objectContaining({ path: 'before.ts' }),
    ]);

    await act(async () => {
      signalListener?.({
        events: [
          { key: ['before.ts'] },
          {
            key: ['after.ts'],
            value: { kind: 'text', change: { diff: [2, 0] as [number, number] } },
          },
        ],
      });
    });
    await flushMicrotasks(8);

    await expect(updates.at(-1)?.provider?.listFiles()).resolves.toEqual([
      expect.objectContaining({ path: 'after.ts' }),
    ]);
    await expect(updates.at(-1)?.provider?.listChangedFiles()).resolves.toMatchObject({
      status: 'ready',
      files: [expect.objectContaining({ path: 'after.ts', add: 2, del: 0 })],
    });
  });

  it('surfaces target resolution failures before opening a Flock room', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-target-unavailable' as SessionId;
    const machineId = 'machine-remote' as MachineId;
    const signalFlock = {
      scan: vi.fn(() => []),
      subscribe: vi.fn(() => vi.fn()),
    };
    const syncSignalOnce = vi.fn(async () => undefined);
    const joinSignalRoom = vi.fn(async () => makeSyncedFlockRoom());
    const openFlockDoc = vi.fn(async (flockDocId: string) => {
      if (flockDocId !== 'workspace-1:fi:session-target-unavailable') {
        throw new Error(`Unexpected Flock doc: ${flockDocId}`);
      }
      return {
        flock: signalFlock,
        syncOnce: syncSignalOnce,
        joinRoom: joinSignalRoom,
      };
    });
    const prepareSessionTarget = vi.fn(async () => {
      throw new Error('remote target unavailable');
    });
    store.set(
      runtimeAtom,
      createRuntime({
        prepareSessionTarget,
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: vi.fn(),
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks(8);

    expect(prepareSessionTarget).toHaveBeenCalledWith(sessionId, machineId);
    expect(openFlockDoc).not.toHaveBeenCalled();
    expect(syncSignalOnce).not.toHaveBeenCalled();
    expect(joinSignalRoom).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: 'error',
      message: 'remote target unavailable',
    });
  });

  it('surfaces remote-machine file-index Flock sync failures', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-remote-sync-failed' as SessionId;
    const machineId = 'machine-remote' as MachineId;
    const signalFlock = {
      scan: vi.fn(() => []),
      subscribe: vi.fn(() => vi.fn()),
    };
    const syncSignalOnce = vi.fn(async () => undefined);
    const joinSignalRoom = vi.fn(async () => {
      throw new Error('file-index sync failed');
    });
    const openFlockDoc = vi.fn(async (flockDocId: string) => {
      if (flockDocId !== 'workspace-1:fi:session-remote-sync-failed') {
        throw new Error(`Unexpected Flock doc: ${flockDocId}`);
      }
      return {
        flock: signalFlock,
        syncOnce: syncSignalOnce,
        joinRoom: joinSignalRoom,
      };
    });
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: vi.fn(),
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks(8);

    expect(syncSignalOnce).not.toHaveBeenCalled();
    expect(joinSignalRoom).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)).toMatchObject({
      status: 'error',
      message: 'file-index sync failed',
    });
  });

  it('publishes an empty file index after read-only catchup without initializing directories', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-empty-catchup' as SessionId;
    const machineId = 'machine-1' as MachineId;
    const scan = vi.fn(() => []);
    const fakeFlock = {
      scan,
      subscribe: vi.fn(() => vi.fn()),
    };
    const initDirectory = vi.fn(async () => ({
      status: 'ok' as const,
      path: '.',
      publishedEntries: 1,
    }));
    const syncOnce = vi.fn(async () => undefined);
    const joinRoom = vi.fn(async () => makeSyncedFlockRoom());
    const openFlockDoc = vi.fn(async () => ({
      flock: fakeFlock,
      syncOnce,
      joinRoom,
    }));
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: initDirectory,
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks();
    expect(syncOnce).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(initDirectory).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)?.status).toBe('empty');
  });

  it('keeps read-only catchup pending until the Flock handle is ready', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-catchup-before-open' as SessionId;
    const machineId = 'machine-1' as MachineId;
    let remoteVisible = false;
    const scan = vi.fn(() =>
      remoteVisible
        ? [{ key: ['package.json'], value: { kind: 'text', change: { diff: [1, 1] } } }]
        : []
    );
    const fakeFlock = {
      scan,
      subscribe: vi.fn(() => vi.fn()),
    };
    let resolveOpenFlockDoc:
      | ((
          value: {
            flock: typeof fakeFlock;
            syncOnce: () => Promise<void>;
            joinRoom: () => Promise<ReturnType<typeof makeSyncedFlockRoom>>;
          }
        ) => void)
      | null = null;
    const syncOnce = vi.fn(async () => {
      remoteVisible = true;
    });
    const initDirectory = vi.fn(async () => ({
      status: 'ok' as const,
      path: '.',
      publishedEntries: 1,
    }));
    const openFlockDoc = vi.fn(
      () =>
        new Promise<{
          flock: typeof fakeFlock;
          syncOnce: () => Promise<void>;
          joinRoom: () => Promise<ReturnType<typeof makeSyncedFlockRoom>>;
        }>((resolve) => {
          resolveOpenFlockDoc = resolve;
        })
    );
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: initDirectory,
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks();
    expect(initDirectory).not.toHaveBeenCalled();
    expect(syncOnce).not.toHaveBeenCalled();

    await act(async () => {
      resolveOpenFlockDoc?.({
        flock: fakeFlock,
        syncOnce,
        joinRoom: async () => {
          remoteVisible = true;
          return makeSyncedFlockRoom();
        },
      });
    });
    await flushMicrotasks();

    expect(scan).toHaveBeenCalledTimes(2);
    expect(syncOnce).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: 'ready',
      role: 'write',
    });
    await expect(updates.at(-1)?.provider?.listFiles()).resolves.toEqual([
      expect.objectContaining({ path: 'package.json' }),
    ]);
  });

  it('applies subscribed file-index events without rescanning the full Flock table', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-incremental' as SessionId;
    const machineId = 'machine-1' as MachineId;
    let listener:
      | ((batch: { events: readonly { key: readonly unknown[]; value?: unknown }[] }) => void)
      | null = null;
    const firstSyncedWithRemote = new Promise<void>(() => undefined);
    const scan = vi.fn(() => [
      { key: ['README.md'], value: { kind: 'text', change: { diff: [1, 0] } } },
    ]);
    const fakeFlock = {
      scan,
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      }),
    };
    const initDirectory = vi.fn(async () => ({
      status: 'ok' as const,
      path: '.',
      publishedEntries: 1,
    }));
    const syncOnce = vi.fn(async () => undefined);
    const joinRoom = vi.fn(async () => makeSyncedFlockRoom(firstSyncedWithRemote));
    const openFlockDoc = vi.fn(async () => ({
      flock: fakeFlock,
      syncOnce,
      joinRoom,
    }));
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: initDirectory,
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(syncOnce).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(initDirectory).not.toHaveBeenCalled();
    expect(listener).not.toBeNull();

    await act(async () => {
      listener?.({
        events: [{ key: ['CHANGELOG.md'], value: { kind: 'text', change: { diff: [2, 0] } } }],
      });
    });

    expect(scan).toHaveBeenCalledTimes(1);
    expect(syncOnce).not.toHaveBeenCalled();
    await expect(updates.at(-1)?.provider?.listFiles()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'CHANGELOG.md' }),
        expect.objectContaining({ path: 'README.md' }),
      ])
    );
  });

  it('renders published v2 file state without root directory activation', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createStore();
    const sessionId = 'session-ready' as SessionId;
    const machineId = 'machine-1' as MachineId;
    const initDirectory = vi.fn(async () => ({
      status: 'error' as const,
      code: 'activation_failed',
      message: 'root activation failed',
    }));
    const flock = new Flock('test-peer');
    flock.set(['README.md'], { kind: 'text', change: { diff: [1, 0] } });
    flock.commit();
    const openFlockDoc = vi.fn(async () => ({
      flock,
      syncOnce: async () => undefined,
      joinRoom: async () => makeSyncedFlockRoom(),
    }));
    store.set(
      runtimeAtom,
      createRuntime({
        repo: { openFlockDoc },
        requestCodeCollabInitDirectory: initDirectory,
      })
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        machineId,
        userId: 'user-1',
      } as SessionMeta,
    });

    const updates: UseCodeCollabSessionFileProviderResult[] = [];
    render(
      createElement(
        Provider,
        { store },
        createElement(ProviderHarness, {
          sessionId,
          machineId,
          onUpdate: (result) => updates.push(result),
        })
      )
    );

    await flushMicrotasks();

    expect(initDirectory).not.toHaveBeenCalled();
    expect(openFlockDoc).toHaveBeenCalledWith('workspace-1:fi:session-ready');
    expect(updates.at(-1)).toMatchObject({
      status: 'ready',
      role: 'write',
    });
    expect(updates.at(-1)?.provider).not.toBeNull();
    const providers = updates
      .map((update) => update.provider)
      .filter((provider): provider is NonNullable<typeof provider> => provider !== null);
    expect(new Set(providers).size).toBe(1);
  });
});

function ProviderHarness({
  sessionId,
  machineId,
  onUpdate,
}: {
  readonly sessionId: SessionId;
  readonly machineId: MachineId;
  readonly onUpdate: (result: UseCodeCollabSessionFileProviderResult) => void;
}) {
  const result = useCodeCollabSessionFileProvider({
    workspaceId: 'workspace-1',
    sessionId,
    enabled: true,
    machineId,
    requestedByUserId: 'user-1',
  });
  useEffect(() => {
    onUpdate(result);
  }, [onUpdate, result]);
  return null;
}

function render(node: ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
