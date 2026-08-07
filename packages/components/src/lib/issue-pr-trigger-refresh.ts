export function getIssuePrHashTriggerRefreshDecision(args: {
  trigger: string | null | undefined;
  repoFullName?: string;
  refreshedRepoForCurrentHashTrigger: string | null;
}): {
  shouldRefresh: boolean;
  nextRefreshedRepoForCurrentHashTrigger: string | null;
} {
  if (args.trigger !== '#') {
    return {
      shouldRefresh: false,
      nextRefreshedRepoForCurrentHashTrigger: null,
    };
  }

  if (!args.repoFullName) {
    return {
      shouldRefresh: false,
      nextRefreshedRepoForCurrentHashTrigger: null,
    };
  }

  if (args.refreshedRepoForCurrentHashTrigger === args.repoFullName) {
    return {
      shouldRefresh: false,
      nextRefreshedRepoForCurrentHashTrigger: args.refreshedRepoForCurrentHashTrigger,
    };
  }

  return {
    shouldRefresh: true,
    nextRefreshedRepoForCurrentHashTrigger: args.repoFullName,
  };
}
