// @vitest-environment jsdom

import React, { type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import lodyLogo from '../src/assets/lody-icon.png';
import { LoroSidebar, type LoroSidebarProps } from '../src/components/loro-sidebar';
import { MobileHomeScreen } from '../src/components/mobile/mobile-home-screen';
import { initI18n } from '../src/i18n';
import { resolveWorkspaceIdentityLogo } from '../src/lib/workspace-identity';

const sidebarProps: LoroSidebarProps = {
  workspaceName: 'Lody',
  userEmail: 'local@lody.invalid',
  workspaces: [{ id: 'local-workspace', name: 'Lody', logo: lodyLogo }],
  currentWorkspaceId: 'local-workspace',
  repoSections: [],
  chats: [],
};

describe('workspace identity capability boundary', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(node: ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => root?.render(node));
  }

  it('uses the Lody brand logo only for the implicit local workspace', () => {
    expect(resolveWorkspaceIdentityLogo('https://example.com/org.png', false)).toBe(lodyLogo);
    expect(resolveWorkspaceIdentityLogo('https://example.com/org.png', true)).toBe(
      'https://example.com/org.png'
    );
    expect(resolveWorkspaceIdentityLogo(null, true)).toBeNull();
  });

  it('renders the desktop local workspace as a static nameplate', () => {
    render(<LoroSidebar {...sidebarProps} workspaceSwitcherEnabled={false} />);

    const identity = container?.querySelector('[data-workspace-identity]');
    expect(identity?.tagName).toBe('DIV');
    expect(identity?.textContent).toContain('Lody');
    expect(container?.querySelector('[data-workspace-switcher-trigger]')).toBeNull();
  });

  it('keeps the desktop cloud workspace trigger enabled by default', () => {
    render(<LoroSidebar {...sidebarProps} />);

    expect(container?.querySelector('[data-workspace-switcher-trigger]')?.tagName).toBe('BUTTON');
    expect(container?.querySelector('[data-workspace-identity]')).toBeNull();
  });

  it('renders the mobile local workspace identity without a dialog trigger', () => {
    render(
      <MobileHomeScreen
        workspace={{ id: 'local-workspace', name: 'Lody', avatarUrl: lodyLogo }}
        machines={[]}
        selectedTab="chat"
        localProjects={[]}
        githubRepositories={[]}
        chats={[]}
      />
    );

    const identity = container?.querySelector('[data-workspace-identity]');
    expect(identity?.tagName).toBe('DIV');
    expect(container?.querySelector('[aria-haspopup="dialog"]')).toBeNull();
  });
});
