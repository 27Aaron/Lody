// @vitest-environment jsdom

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubCheckRunsSummary, GitHubPullRequestDetails } from '@lody/shared';

import {
  PrTabView,
  type PrTabViewData,
  type PrTabViewState,
} from '../src/components/sessions/pr-tab-view';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const pullRequest: GitHubPullRequestDetails = {
  number: 42,
  nodeId: 'PR_kwDO_test',
  title: 'Fix refresh button',
  body: '',
  state: 'open',
  merged: false,
  draft: false,
  htmlUrl: 'https://github.com/loro-dev/lody/pull/42',
  baseRef: 'main',
  headRef: 'fix/pr-refresh-button',
  headSha: 'abc123',
  user: null,
  createdAt: '2026-05-04T00:00:00.000Z',
  updatedAt: '2026-05-04T00:05:00.000Z',
  mergedAt: null,
  closedAt: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commits: 1,
  mergeable: true,
  mergeableState: 'clean',
};

const checkRuns: GitHubCheckRunsSummary = {
  status: 'none',
  conclusion: null,
  total: 0,
  runs: [],
};

const data: PrTabViewData = {
  pullRequest,
  reviewThreads: [],
  reviews: [],
  issueComments: [],
  checkRuns,
};

describe('PrTabView refresh button', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  const renderView = (props: {
    state: PrTabViewState;
    isRefreshing?: boolean;
    data?: PrTabViewData | null;
  }) => {
    const onRefresh = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        createElement(PrTabView, {
          repoFullName: 'loro-dev/lody',
          prNumber: 42,
          state: props.state,
          data: 'data' in props ? props.data : data,
          isRefreshing: props.isRefreshing,
          onRefresh,
        })
      );
    });

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]');
    if (!button) {
      throw new Error('Expected refresh button to be rendered');
    }
    return { button, onRefresh };
  };

  it('keeps the top refresh button clickable while the initial load is spinning', () => {
    const { button, onRefresh } = renderView({ state: 'loading', data: null });

    expect(button.disabled).toBe(false);
    expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);

    flushSync(() => {
      button.click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the top refresh button clickable while revalidating cached PR data', () => {
    const { button, onRefresh } = renderView({ state: 'ready', isRefreshing: true });

    expect(button.disabled).toBe(false);
    expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);

    flushSync(() => {
      button.click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
