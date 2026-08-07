// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type {
  CodeCollabV2FileDigest,
  CodeCollabV2OpenTextOk,
  CodeCollabV2RefreshTextResponse,
  CodeCollabV2SaveTextResponse,
  SessionId,
} from '@lody/shared';
import {
  CodeCollabSessionFileProvider,
  createCodeCollabSessionFileProviderTextState,
  type CodeCollabSessionFileProviderRuntime,
} from '../src/lib/code-collab-session-file-provider';
import { SaveTextConflictError } from '../src/lib/code-collab-save-errors';

const SESSION_ID = 'session-v2' as SessionId;
const DIGEST_1 = `sha256:${'1'.repeat(64)}` as CodeCollabV2FileDigest;
const DIGEST_2 = `sha256:${'2'.repeat(64)}` as CodeCollabV2FileDigest;

function textResult(
  status: 'ok' | 'updated',
  text: string,
  digest: CodeCollabV2FileDigest,
  path = 'src/app.ts'
): CodeCollabV2OpenTextOk | Extract<CodeCollabV2RefreshTextResponse, { status: 'updated' }> {
  return {
    status,
    path,
    digest,
    text: {
      encoding: 'plain',
      text,
      rawBytes: new TextEncoder().encode(text).byteLength,
    },
    format: {
      encoding: 'utf8',
      eol: 'lf',
    },
  };
}

function createRuntime(
  overrides: Partial<CodeCollabSessionFileProviderRuntime> = {}
): CodeCollabSessionFileProviderRuntime {
  return {
    sessionId: SESSION_ID,
    openText: vi.fn(async () => textResult('ok', 'one\n', DIGEST_1) as CodeCollabV2OpenTextOk),
    refreshText: vi.fn(async () => ({
      status: 'up_to_date',
      path: 'src/app.ts',
      digest: DIGEST_1,
    })),
    saveText: vi.fn(async () => ({
      status: 'ok',
      path: 'src/app.ts',
      digest: DIGEST_2,
      rawBytes: 0,
    })),
    openCurrentDiff: vi.fn(async () => ({
      status: 'ok',
      path: 'src/app.ts',
      oldSnapshot: {
        kind: 'text',
        text: {
          encoding: 'plain',
          text: 'one\n',
          rawBytes: 4,
        },
      },
      newSnapshot: {
        kind: 'text',
        text: {
          encoding: 'plain',
          text: 'one\ntwo\n',
          rawBytes: 8,
        },
      },
      add: 1,
      del: 0,
    })),
    openTurnDiff: vi.fn(async () => ({
      status: 'ok',
      path: 'src/app.ts',
      turnId: 'turn-1',
      oldSnapshot: {
        kind: 'text',
        text: {
          encoding: 'plain',
          text: 'turn old\n',
          rawBytes: 9,
        },
      },
      newSnapshot: {
        kind: 'text',
        text: {
          encoding: 'plain',
          text: 'turn new\n',
          rawBytes: 9,
        },
      },
      add: 1,
      del: 1,
    })),
    lspDefinition: vi.fn(async () => ({ status: 'unsupported', code: 'lsp_not_wired' })),
    lspReferences: vi.fn(async () => ({ status: 'unsupported', code: 'lsp_not_wired' })),
    ...overrides,
  };
}

describe('CodeCollabSessionFileProvider v2', () => {
  it('uses workspace path as file id and refreshes opened text by digest', async () => {
    const runtime = createRuntime({
      refreshText: vi
        .fn()
        .mockResolvedValueOnce({ status: 'up_to_date', path: 'src/app.ts', digest: DIGEST_1 })
        .mockResolvedValueOnce(textResult('updated', 'two\n', DIGEST_2)),
    });
    const provider = new CodeCollabSessionFileProvider({
      runtime,
      role: 'write',
      fileTree: {
        'src/app.ts': true,
        src: { kind: 'lazy' },
      },
    });

    expect(await provider.listFiles()).toEqual([
      expect.objectContaining({
        entryType: 'lazy-directory',
        directoryId: 'src',
        path: 'src',
      }),
      expect.objectContaining({
        entryType: 'file',
        fileId: 'src/app.ts',
        path: 'src/app.ts',
        kind: 'text',
      }),
    ]);

    const opened = await provider.openFile('src/app.ts');
    expect(opened).toMatchObject({
      status: 'ready',
      snapshot: { kind: 'text', text: 'one\n', eol: 'lf' },
    });
    expect(runtime.openText).toHaveBeenCalledWith('src/app.ts');

    const same = await provider.openFile('src/app.ts');
    expect(same).toMatchObject({
      status: 'ready',
      snapshot: { kind: 'text', text: 'one\n', eol: 'lf' },
    });
    expect(runtime.refreshText).toHaveBeenCalledWith('src/app.ts', DIGEST_1);

    const updated = await provider.openFile('src/app.ts');
    expect(updated).toMatchObject({
      status: 'ready',
      snapshot: { kind: 'text', text: 'two\n', eol: 'lf' },
    });
  });

  it('evicts least-recently-used opened text by byte size', async () => {
    const textState = createCodeCollabSessionFileProviderTextState({
      maxOpenTextCacheBytes: 8,
    });
    const openText = vi.fn<CodeCollabSessionFileProviderRuntime['openText']>(async (path) =>
      textResult('ok', `${path[0] ?? 'x'}123`, DIGEST_1, path)
    );
    const refreshText = vi.fn<CodeCollabSessionFileProviderRuntime['refreshText']>(
      async (path, digest) => ({ status: 'up_to_date', path, digest })
    );
    const provider = new CodeCollabSessionFileProvider({
      runtime: createRuntime({ openText, refreshText }),
      role: 'write',
      fileTree: {
        'a.ts': true,
        'b.ts': true,
        'c.ts': true,
      },
      textState,
    });

    await provider.openFile('a.ts');
    await provider.openFile('b.ts');
    await provider.openFile('a.ts');
    await provider.openFile('c.ts');
    await provider.openFile('b.ts');

    expect(refreshText).toHaveBeenCalledTimes(1);
    expect(refreshText).toHaveBeenCalledWith('a.ts', DIGEST_1);
    expect(openText).toHaveBeenCalledTimes(4);
    expect(openText.mock.calls.map(([path]) => path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'b.ts']);
    expect(textState.openCache.byteSize).toBeLessThanOrEqual(8);
  });

  it('saves with the cached base digest and updates the local base digest', async () => {
    const saveText = vi
      .fn<CodeCollabSessionFileProviderRuntime['saveText']>()
      .mockResolvedValueOnce({
        status: 'ok',
        path: 'src/app.ts',
        digest: DIGEST_2,
        rawBytes: 5,
      } satisfies CodeCollabV2SaveTextResponse);
    const runtime = createRuntime({ saveText });
    const provider = new CodeCollabSessionFileProvider({
      runtime,
      role: 'write',
      fileTree: { 'src/app.ts': true },
    });
    const emitted: string[] = [];
    provider.subscribeText('src/app.ts', (text) => emitted.push(text));

    await provider.openFile('src/app.ts');
    const saved = await provider.saveText('src/app.ts', 'mine\n');

    expect(saveText).toHaveBeenCalledWith(
      'src/app.ts',
      DIGEST_1,
      { encoding: 'plain', text: 'mine\n', rawBytes: 5 },
      { encoding: 'utf8', eol: 'lf' }
    );
    expect(saved).toMatchObject({
      status: 'ready',
      snapshot: { kind: 'text', text: 'mine\n', eol: 'lf' },
    });
    expect(emitted).toEqual(['mine\n']);
  });

  it('preserves opened text base digest across provider rebuilds with shared text state', async () => {
    const textState = createCodeCollabSessionFileProviderTextState();
    const saveText = vi
      .fn<CodeCollabSessionFileProviderRuntime['saveText']>()
      .mockResolvedValueOnce({
        status: 'ok',
        path: 'src/app.ts',
        digest: DIGEST_2,
        rawBytes: 5,
      } satisfies CodeCollabV2SaveTextResponse);
    const firstRuntime = createRuntime();
    const secondRuntime = createRuntime({ saveText });
    const firstProvider = new CodeCollabSessionFileProvider({
      runtime: firstRuntime,
      role: 'write',
      fileTree: { 'src/app.ts': true },
      textState,
    });
    const secondProvider = new CodeCollabSessionFileProvider({
      runtime: secondRuntime,
      role: 'write',
      fileTree: { 'src/app.ts': true },
      textState,
    });

    await firstProvider.openFile('src/app.ts');
    await secondProvider.saveText('src/app.ts', 'mine\n');

    expect(secondRuntime.openText).not.toHaveBeenCalled();
    expect(saveText).toHaveBeenCalledWith(
      'src/app.ts',
      DIGEST_1,
      { encoding: 'plain', text: 'mine\n', rawBytes: 5 },
      { encoding: 'utf8', eol: 'lf' }
    );
  });

  it('checks remote text changes without replacing the cached save base digest', async () => {
    const textState = createCodeCollabSessionFileProviderTextState();
    const saveText = vi
      .fn<CodeCollabSessionFileProviderRuntime['saveText']>()
      .mockResolvedValueOnce({
        status: 'ok',
        path: 'src/app.ts',
        digest: `sha256:${'3'.repeat(64)}` as CodeCollabV2FileDigest,
        rawBytes: 5,
      } satisfies CodeCollabV2SaveTextResponse);
    const runtime = createRuntime({
      refreshText: vi.fn(async () => textResult('updated', 'disk\n', DIGEST_2)),
      saveText,
    });
    const provider = new CodeCollabSessionFileProvider({
      runtime,
      role: 'write',
      fileTree: { 'src/app.ts': true },
      textState,
    });

    await provider.openFile('src/app.ts');
    await expect(provider.checkTextChanged('src/app.ts')).resolves.toMatchObject({
      status: 'changed',
      path: 'src/app.ts',
      digest: DIGEST_2,
    });
    await provider.saveText('src/app.ts', 'mine\n');

    expect(saveText).toHaveBeenCalledWith(
      'src/app.ts',
      DIGEST_1,
      { encoding: 'plain', text: 'mine\n', rawBytes: 5 },
      { encoding: 'utf8', eol: 'lf' }
    );
  });

  it('keeps user text on save conflict and can discard to disk text', async () => {
    const runtime = createRuntime({
      saveText: vi.fn(async () => ({
        status: 'conflict',
        reason: 'digest_mismatch',
        path: 'src/app.ts',
        baseDigest: DIGEST_1,
        diskDigest: DIGEST_2,
        diskText: {
          encoding: 'plain',
          text: 'disk\n',
          rawBytes: 5,
        },
      })),
    });
    const provider = new CodeCollabSessionFileProvider({
      runtime,
      role: 'write',
      fileTree: { 'src/app.ts': true },
    });
    const emitted: string[] = [];
    provider.subscribeText('src/app.ts', (text) => emitted.push(text));

    await provider.openFile('src/app.ts');
    let conflictId: string | undefined;
    try {
      await provider.saveText('src/app.ts', 'mine\n');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveTextConflictError);
      conflictId = (error as SaveTextConflictError).conflictId;
    }

    expect(conflictId).toBeTruthy();
    expect(emitted).toEqual([]);
    await provider.resolveSaveConflict('src/app.ts', {
      conflictId: conflictId!,
      resolution: 'discard',
    });
    expect(emitted).toEqual(['disk\n']);
  });

  it('loads conflict markers without writing until the user saves the resolved text', async () => {
    const saveText = vi
      .fn<CodeCollabSessionFileProviderRuntime['saveText']>()
      .mockResolvedValueOnce({
        status: 'conflict',
        reason: 'digest_mismatch',
        path: 'src/app.ts',
        baseDigest: DIGEST_1,
        diskDigest: DIGEST_2,
        diskText: {
          encoding: 'plain',
          text: 'disk\n',
          rawBytes: 5,
        },
      } satisfies CodeCollabV2SaveTextResponse)
      .mockResolvedValueOnce({
        status: 'ok',
        path: 'src/app.ts',
        digest: `sha256:${'3'.repeat(64)}` as CodeCollabV2FileDigest,
        rawBytes: 9,
      } satisfies CodeCollabV2SaveTextResponse);
    const runtime = createRuntime({ saveText });
    const provider = new CodeCollabSessionFileProvider({
      runtime,
      role: 'write',
      fileTree: { 'src/app.ts': true },
    });
    const emitted: string[] = [];
    provider.subscribeText('src/app.ts', (text) => emitted.push(text));

    await provider.openFile('src/app.ts');
    let conflictId: string | undefined;
    try {
      await provider.saveText('src/app.ts', 'mine\n');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveTextConflictError);
      conflictId = (error as SaveTextConflictError).conflictId;
    }

    await provider.resolveSaveConflict('src/app.ts', {
      conflictId: conflictId!,
      resolution: 'load_with_conflicts',
    });

    expect(saveText).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([
      ['<<<<<<< disk', 'disk', '=======', 'mine', '>>>>>>> local edits', ''].join('\n'),
    ]);

    await provider.saveText('src/app.ts', 'resolved\n');
    expect(saveText).toHaveBeenLastCalledWith(
      'src/app.ts',
      DIGEST_2,
      { encoding: 'plain', text: 'resolved\n', rawBytes: 9 },
      { encoding: 'utf8', eol: 'lf' }
    );
  });

  it('opens current All Changes and historical turn diffs through CLI RPC', async () => {
    const runtime = createRuntime();
    const provider = new CodeCollabSessionFileProvider({
      runtime,
      fileTree: { 'src/app.ts': true, 'old.ts': true },
      allChanges: {
        'src/app.ts': { diff: [3, 1] },
        'old.ts': { diff: [0, 9], del: true },
      },
    });

    expect(provider.supportsHistoricalDiffs).toBe(true);
    await expect(provider.getDiff('src/app.ts')).resolves.toMatchObject({
      status: 'ready',
      oldSnapshot: { kind: 'text', text: 'one\n' },
      newSnapshot: { kind: 'text', text: 'one\ntwo\n' },
    });
    expect(runtime.openCurrentDiff).toHaveBeenCalledWith('src/app.ts');

    await expect(provider.getDiff('src/app.ts', 'turn-1')).resolves.toMatchObject({
      status: 'ready',
      oldSnapshot: { kind: 'text', text: 'turn old\n' },
      newSnapshot: { kind: 'text', text: 'turn new\n' },
    });
    expect(runtime.openTurnDiff).toHaveBeenCalledWith('src/app.ts', 'turn-1');
    await expect(provider.listChangedFiles()).resolves.toEqual({
      status: 'ready',
      files: [
        expect.objectContaining({ path: 'old.ts', kind: 'deleted', add: 0, del: 9 }),
        expect.objectContaining({ path: 'src/app.ts', kind: 'text', add: 3, del: 1 }),
      ],
    });
  });
});
