import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubFileTooLargeError,
  githubFetchCheckRuns,
  githubFetchFileAtCommit,
  githubFetchFileBytesAtCommit,
  githubFetchPRIssueComments,
  githubFetchPRReviewComments,
  githubFetchProjectSkillsAtCommit,
  githubFetchPullRequestDetails,
  githubFetchPullRequestReviews,
} from '../src/github-api';

describe('GitHub PR live reads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards reload mode to every request in a manual refresh', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/pulls/42')) {
        return new Response(
          JSON.stringify({
            number: 42,
            node_id: 'PR_42',
            title: 'Fresh pull request',
            state: 'open',
            html_url: 'https://github.com/owner/repo/pull/42',
            base: { ref: 'main' },
            head: { ref: 'fix/refresh', sha: 'head-sha' },
            user: null,
            created_at: '2026-07-19T00:00:00.000Z',
            updated_at: '2026-07-19T00:01:00.000Z',
          })
        );
      }
      if (url.includes('/check-runs')) {
        return new Response(JSON.stringify({ check_runs: [] }));
      }
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const options = { cache: 'reload' as const };

    await Promise.all([
      githubFetchPullRequestDetails('token', 'owner/repo', 42, options),
      githubFetchPRReviewComments('token', 'owner/repo', 42, options),
      githubFetchPullRequestReviews('token', 'owner/repo', 42, options),
      githubFetchPRIssueComments('token', 'owner/repo', 42, options),
      githubFetchCheckRuns('token', 'owner/repo', 'head-sha', options),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map(([, init]) => init?.cache)).toEqual([
      'reload',
      'reload',
      'reload',
      'reload',
      'reload',
    ]);
  });
});

describe('githubFetchFileAtCommit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects API file bodies larger than the byte cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('hello', { headers: { 'content-length': '5' } }))
    );

    await expect(
      githubFetchFileAtCommit('token', 'owner/repo', 'src/app.ts', 'commit-sha', {
        maxBytes: 4,
      })
    ).rejects.toBeInstanceOf(GitHubFileTooLargeError);
  });

  it('applies the byte cap to raw fallback responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('too large', { status: 403 }))
      .mockResolvedValueOnce(new Response('hello', { headers: { 'content-length': '5' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      githubFetchFileAtCommit('token', 'owner/repo', 'src/app.ts', 'commit-sha', {
        maxBytes: 4,
      })
    ).rejects.toBeInstanceOf(GitHubFileTooLargeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('githubFetchFileBytesAtCommit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns raw bytes intact (no UTF-8 decoding)', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
      )
    );

    const result = await githubFetchFileBytesAtCommit(
      'token',
      'owner/repo',
      'assets/logo.png',
      'commit-sha',
      { maxBytes: 16 }
    );
    expect(Array.from(result)).toEqual(Array.from(bytes));
  });

  it('rejects binary bodies larger than the byte cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(8), { headers: { 'content-length': '8' } }))
    );

    await expect(
      githubFetchFileBytesAtCommit('token', 'owner/repo', 'assets/logo.png', 'commit-sha', {
        maxBytes: 4,
      })
    ).rejects.toBeInstanceOf(GitHubFileTooLargeError);
  });
});

describe('githubFetchProjectSkillsAtCommit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups skills by requested directory while following in-repo symlink directories', async () => {
    const skillMarkdown = `---
name: Review Bot
description: Checks diffs
---
# Review
`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/git/trees/commit-sha?recursive=1')) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: '.agents/skills', type: 'tree', sha: 'tree-agents' },
              { path: '.agents/skills/review', type: 'tree', sha: 'tree-review' },
              {
                path: '.agents/skills/review/SKILL.md',
                type: 'blob',
                sha: 'skill-md',
                mode: '100644',
              },
              { path: '.claude/skills', type: 'blob', sha: 'symlink-1', mode: '120000' },
            ],
          })
        );
      }
      if (url.includes('/git/blobs/symlink-1')) {
        return new Response(
          JSON.stringify({
            content: btoa('../.agents/skills'),
            encoding: 'base64',
            size: '../.agents/skills'.length,
          })
        );
      }
      if (url.includes('/contents/.agents/skills/review/SKILL.md')) {
        return new Response(skillMarkdown);
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await githubFetchProjectSkillsAtCommit('token', 'owner/repo', 'commit-sha', [
      '.agents/skills',
      '.claude/skills',
    ]);

    expect(result.groups).toEqual([
      {
        scope: 'project',
        dir: '.agents/skills',
        skills: [
          {
            id: '.agents/skills/review',
            name: 'Review Bot',
            description: 'Checks diffs',
            relativePath: '.agents/skills/review/SKILL.md',
            isSymlink: false,
            content: '# Review',
          },
        ],
        truncated: false,
      },
      {
        scope: 'project',
        dir: '.claude/skills',
        skills: [
          {
            id: '.claude/skills/review',
            name: 'Review Bot',
            description: 'Checks diffs',
            relativePath: '.claude/skills/review/SKILL.md',
            isSymlink: true,
            symlinkTarget: '.agents/skills/review',
            content: '# Review',
          },
        ],
        truncated: false,
      },
    ]);
    expect(result.contentFingerprint).toBe('commit-sha');
    expect(result.treeTruncated).toBe(false);
  });
});
