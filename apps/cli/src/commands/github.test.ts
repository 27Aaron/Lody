import { describe, expect, it } from 'vitest';
import { sortGitHubRepositories } from './github';
import type { WorkspaceGitHubRepository } from '@/lib/workspace';

const createRepository = (
  overrides: Partial<WorkspaceGitHubRepository> = {}
): WorkspaceGitHubRepository => ({
  id: 1,
  name: 'repo',
  fullName: 'owner/repo',
  private: false,
  ...overrides,
});

describe('github command helpers', () => {
  it('sorts repositories by full name, name, then id', () => {
    const repositories = [
      createRepository({ id: 3, name: 'repo-b', fullName: 'beta/repo' }),
      createRepository({ id: 2, name: 'repo-z', fullName: 'alpha/repo' }),
      createRepository({ id: 1, name: 'repo-a', fullName: 'alpha/repo' }),
    ];

    expect(sortGitHubRepositories(repositories).map((repository) => repository.id)).toEqual([
      1, 2, 3,
    ]);
  });
});
