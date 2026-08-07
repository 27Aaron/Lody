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

  // Regression guard: the avatar must be served from a CORS-fetchable
  // host so `avatar-cache` can persist it for offline. The `github.com/
  // <handle>.png` form 302s without `Access-Control-Allow-Origin`, which
  // makes the CORS-mode fetch fail and silently disables caching.
  it('uses the CORS-fetchable avatars host, never the github.com redirect', () => {
    const url = getGitHubOwnerAvatarUrl('octocat');
    expect(url.startsWith('https://avatars.githubusercontent.com/')).toBe(true);
    expect(url).not.toContain('github.com/');
    expect(url).not.toContain('.png');
  });
});
