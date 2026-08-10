import { describe, expect, it } from 'vitest';

import { getGitHubOwnerAvatarUrl } from '../src/lib/github-avatar';

describe('getGitHubOwnerAvatarUrl', () => {
  it('builds a by-handle avatars URL for users and orgs', () => {
    expect(getGitHubOwnerAvatarUrl('octocat')).toBe(
      'https://avatars.githubusercontent.com/octocat?size=80'
    );
    expect(getGitHubOwnerAvatarUrl('loro-dev')).toBe(
      'https://avatars.githubusercontent.com/loro-dev?size=80'
    );
  });

  it('encodes handles so they cannot break the URL', () => {
    expect(getGitHubOwnerAvatarUrl('a b/c?')).toBe(
      'https://avatars.githubusercontent.com/a%20b%2Fc%3F?size=80'
    );
  });
});
