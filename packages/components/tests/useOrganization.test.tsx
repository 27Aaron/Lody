// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-bootstrap', () => ({
  readAuthBootstrapSnapshot: () => null,
  readBootstrappedCurrentUser: () => null,
  readStoredAuthToken: () => null,
}));

const organizationMocks = vi.hoisted(() => ({
  authClient: null as unknown,
  refetchActiveOrganization: vi.fn(),
  refetchOrganizations: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock('../src/providers/convex-provider', () => ({
  useAuthClient: () => organizationMocks.authClient,
}));

vi.mock('../src/lib/app-platform', () => ({
  isLocalAppPlatform: () => false,
}));

const { StableSessionContext } = await import('../src/hooks/useStableSession');
const { useOrganization } = await import('../src/hooks/useOrganization');

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type TestOrganization = {
  id: string;
  slug: string;
  name: string;
  logo: null;
  members: Array<{ userId: string; role: string }>;
};

function createOrganization(id: string, slug: string, name: string): TestOrganization {
  return {
    id,
    slug,
    name,
    logo: null,
    members: [{ userId: 'user-1', role: 'owner' }],
  };
}

function OrganizationProbe({ targetSlug }: { targetSlug: string }) {
  useOrganization({ targetSlug });
  return null;
}

function TestApp({ targetSlug, renderVersion }: { targetSlug: string; renderVersion: number }) {
  void renderVersion;

  return createElement(
    Provider,
    null,
    createElement(
      StableSessionContext.Provider,
      {
        value: {
          data: { user: { id: 'user-1' } },
          rawData: { user: { id: 'user-1' } },
          bootstrapSnapshot: null,
          hasLocalToken: false,
          hasRawUser: true,
          isOptimistic: false,
          isPending: false,
          isRetrying: false,
          error: null,
          confirmedUnauthenticated: false,
        },
      },
      createElement(OrganizationProbe, { targetSlug }),
      createElement(OrganizationProbe, { targetSlug })
    )
  );
}

describe('useOrganization setActive dedupe', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let activeOrganization: TestOrganization;
  let listVersion = 0;

  beforeEach(() => {
    listVersion = 0;
    activeOrganization = createOrganization('workspace-old', 'old-workspace', 'Old Workspace');
    organizationMocks.refetchActiveOrganization.mockReset();
    organizationMocks.refetchOrganizations.mockReset();
    organizationMocks.setActive.mockReset();
    organizationMocks.setActive.mockResolvedValue({
      data: createOrganization('workspace-target', 'target-workspace', 'Target Workspace'),
      error: null,
    });
    organizationMocks.authClient = {
      useListOrganizations: () => ({
        data: [
          createOrganization(
            'workspace-target',
            'target-workspace',
            `Target Workspace ${listVersion}`
          ),
          createOrganization('workspace-old', 'old-workspace', `Old Workspace ${listVersion}`),
        ],
        isPending: false,
        error: null,
        refetch: organizationMocks.refetchOrganizations,
      }),
      useActiveOrganization: () => ({
        data: activeOrganization,
        isPending: false,
        error: null,
        refetch: organizationMocks.refetchActiveOrganization,
      }),
      organization: {
        setActive: organizationMocks.setActive,
      },
    };
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.clearAllMocks();
  });

  async function render(targetSlug: string, renderVersion: number): Promise<void> {
    if (!container) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(TestApp, { targetSlug, renderVersion }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('sends one setActive request for duplicate target workspace switchers', async () => {
    await render('target-workspace', 0);

    expect(organizationMocks.setActive).toHaveBeenCalledTimes(1);
    expect(organizationMocks.setActive).toHaveBeenCalledWith({
      organizationId: 'workspace-target',
    });

    listVersion += 1;
    await render('target-workspace', 1);

    expect(organizationMocks.setActive).toHaveBeenCalledTimes(1);

    activeOrganization = createOrganization(
      'workspace-target',
      'target-workspace',
      'Target Workspace'
    );
    listVersion += 1;
    await render('target-workspace', 2);

    expect(organizationMocks.setActive).toHaveBeenCalledTimes(1);
  });
});
