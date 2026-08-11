// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore, type Store } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineId, ProviderSetupTask, WorkspaceId } from '@lody/shared';

const mocks = vi.hoisted(() => ({
  createGitHubInstallState: vi.fn(),
  getCliState: vi.fn(),
  selectLocalProjectDirectory: vi.fn(),
  onCliState: vi.fn(),
  openExternalUrl: vi.fn(),
  postHog: { capture: vi.fn() },
  useVisibleLocalProjects: vi.fn(),
}));

vi.mock('@posthog/react', () => ({
  usePostHog: () => mocks.postHog,
}));

vi.mock('convex/react', () => ({
  useAction: () => mocks.createGitHubInstallState,
}));

vi.mock('../src/hooks/use-recoverable-convex-query', () => ({
  usePublicConvexQuery: () => undefined,
  useRecoverableConvexQuery: () => [],
}));

vi.mock('../src/hooks/use-authenticated-convex', () => ({
  useAuthenticatedConvex: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock('../src/hooks/use-visible-local-projects', () => ({
  useVisibleLocalProjects: mocks.useVisibleLocalProjects,
}));

vi.mock('../src/lib/native-browser', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

import { localCliStartingAtom, localProbeResultAtom } from '../src/atoms/local-probe';
import { runtimeAtom } from '../src/atoms/runtime';
import { desktopOnboardingPhaseAtom } from '../src/atoms/onboarding';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '../src/atoms/workspace-context';
import { OnboardingOverlay } from '../src/components/onboarding/onboarding-overlay';
import { ProjectsScreen } from '../src/components/onboarding/screens/projects-screen';
import { ProvidersScreenView } from '../src/components/onboarding/screens/providers-screen';
import { initI18n } from '../src/i18n';
import { TestCloudPlatformProvider } from './test-platform';

const workspaceId = 'workspace-1' as WorkspaceId;
const machineId = 'machine-1' as MachineId;

function installElectronWindowApi() {
  mocks.getCliState.mockReturnValue(new Promise(() => undefined));
  mocks.onCliState.mockReturnValue(() => undefined);

  Object.defineProperty(window, '__LODY_ELECTRON__', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cliState: {
        getState: mocks.getCliState,
        onState: mocks.onCliState,
      },
      selectLocalProjectDirectory: mocks.selectLocalProjectDirectory,
    },
  });
}

function uninstallElectronWindowApi() {
  delete (window as unknown as { __LODY_ELECTRON__?: boolean }).__LODY_ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    item.textContent?.includes(label)
  );
  if (!button) {
    throw new Error(`Expected button containing "${label}"`);
  }
  return button;
}

describe('desktop onboarding flow', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let store: Store;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n('en');
    localStorage.clear();
    mocks.createGitHubInstallState.mockResolvedValue({ state: 'github-state-1' });
    mocks.openExternalUrl.mockResolvedValue(true);
    mocks.useVisibleLocalProjects.mockReturnValue({ projects: new Map() });

    installElectronWindowApi();
    store = createStore();
    store.set(currentWorkspaceIdAtom, workspaceId);
    store.set(currentWorkspaceSlugAtom, 'workspace-1');
    store.set(runtimeAtom, {
      workspaceId,
      workspaceSlug: 'workspace-1',
      getMachineAcpBinaryProgress: () => null,
      subscribeMachineAcpBinaryProgress: () => () => undefined,
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
    document.body.innerHTML = '';
    uninstallElectronWindowApi();
    vi.clearAllMocks();
  });

  it('shows the language screen immediately even when Electron CLI state never resolves', async () => {
    await act(async () => {
      root?.render(
        <TestCloudPlatformProvider>
          <Provider store={store}>
            <OnboardingOverlay />
          </Provider>
        </TestCloudPlatformProvider>
      );
    });

    expect(container?.textContent).toContain('Choose your language');
    expect(container?.textContent).not.toContain('Preparing your workspace');
    expect(mocks.getCliState).not.toHaveBeenCalled();
  });

  it('captures the initial and subsequent onboarding steps', async () => {
    await act(async () => {
      root?.render(
        <TestCloudPlatformProvider>
          <Provider store={store}>
            <OnboardingOverlay />
          </Provider>
        </TestCloudPlatformProvider>
      );
    });

    expect(mocks.postHog.capture).toHaveBeenCalledWith('onboarding/desktop_step_viewed', {
      step: 'language',
    });

    await act(async () => {
      store.set(desktopOnboardingPhaseAtom, 'theme');
    });

    expect(mocks.postHog.capture).toHaveBeenLastCalledWith('onboarding/desktop_step_viewed', {
      step: 'theme',
    });
  });

  it.each([
    {
      name: 'the local CLI is still starting',
      localProbeResult: { ok: true, machineId },
      localCliStarting: true,
    },
    {
      name: 'the local machine id is missing',
      localProbeResult: null,
      localCliStarting: false,
    },
  ])(
    'disables only local import while waiting for the local agent when $name',
    async ({ localProbeResult, localCliStarting }) => {
      store.set(localProbeResultAtom, localProbeResult);
      store.set(localCliStartingAtom, localCliStarting);

      await act(async () => {
        root?.render(
          <TestCloudPlatformProvider>
            <Provider store={store}>
              <ProjectsScreen onBack={vi.fn()} onComplete={vi.fn()} />
            </Provider>
          </TestCloudPlatformProvider>
        );
      });

      const addLocalButton = findButton(container!, 'Add a local project');
      const connectGitHubButton = findButton(container!, 'Connect a GitHub repository');

      expect(addLocalButton.disabled).toBe(true);
      expect(container?.textContent).toContain('Waiting for the local agent to connect');
      expect(connectGitHubButton.disabled).toBe(false);

      await act(async () => {
        connectGitHubButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(mocks.createGitHubInstallState).toHaveBeenCalledWith({
        workspaceId,
        workspaceSlug: 'workspace-1',
        returnTarget: 'desktop',
      });
      expect(mocks.selectLocalProjectDirectory).not.toHaveBeenCalled();
    }
  );

  it('enables local import once the local agent is connected and ready', async () => {
    mocks.selectLocalProjectDirectory.mockResolvedValue(null);
    store.set(localProbeResultAtom, { ok: true, machineId });
    store.set(localCliStartingAtom, false);

    await act(async () => {
      root?.render(
        <TestCloudPlatformProvider>
          <Provider store={store}>
            <ProjectsScreen onBack={vi.fn()} onComplete={vi.fn()} />
          </Provider>
        </TestCloudPlatformProvider>
      );
    });

    const addLocalButton = findButton(container!, 'Add a local project');

    expect(addLocalButton.disabled).toBe(false);
    expect(container?.textContent).not.toContain('Waiting for the local agent to connect');

    await act(async () => {
      addLocalButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.selectLocalProjectDirectory).toHaveBeenCalledWith();
  });

  it('allows onboarding to continue while a durable provider setup is running', async () => {
    const onNext = vi.fn();
    const setup: ProviderSetupTask = {
      v: 1,
      id: 'setup-1' as ProviderSetupTask['id'],
      machineId,
      config: {
        id: 'setup-1' as ProviderSetupTask['id'],
        machineId,
        name: 'Codex',
        description: undefined,
        cliType: 'builtin',
        agentType: 'codex',
        env: {},
        prompt: '',
      },
      status: 'preparing-runtime',
      attempt: 1,
      createdAt: 10,
      updatedAt: 20,
    };

    await act(async () => {
      root?.render(
        <TestCloudPlatformProvider>
          <Provider store={store}>
            <ProvidersScreenView
              configs={[]}
              setups={[setup]}
              testStatuses={{}}
              noLocalMachine={false}
              localMachineId={machineId}
              onEdit={vi.fn()}
              onTest={vi.fn()}
              onDelete={vi.fn()}
              onRetrySetup={vi.fn(async () => {})}
              onDeleteSetup={vi.fn(async () => {})}
              onAdd={vi.fn()}
              onBack={vi.fn()}
              onSkip={vi.fn()}
              onNext={onNext}
            />
          </Provider>
        </TestCloudPlatformProvider>
      );
    });

    expect(container?.textContent).toContain('Downloading the agent runtime');
    const nextButton = findButton(container!, 'Next');
    expect(nextButton.disabled).toBe(false);
    await act(async () => {
      nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNext).toHaveBeenCalledOnce();
  });
});
