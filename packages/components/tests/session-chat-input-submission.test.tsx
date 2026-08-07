// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMeta } from '@lody/shared';

vi.mock('@posthog/react', () => ({ usePostHog: () => null }));

vi.mock('../src/components/chat/chat-composer', async () => {
  const React = await import('react');
  return {
    ChatComposer: (props: {
      promptRef?: React.Ref<HTMLTextAreaElement>;
      promptValue: string;
      promptDisabled?: boolean;
      onPromptChange: (value: string) => void;
      onPromptKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
      primaryAction?: React.ReactNode;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement('textarea', {
          ref: props.promptRef,
          value: props.promptValue,
          disabled: props.promptDisabled,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
            props.onPromptChange(event.target.value),
          onKeyDown: props.onPromptKeyDown,
        }),
        props.primaryAction
      ),
  };
});

vi.mock('../src/components/sessions/desktop-run-config-menu', () => ({
  DesktopPermissionModeButton: () => null,
  DesktopRunConfigMenu: () => null,
}));
vi.mock('../src/components/mobile/mobile-session-run-config', () => ({
  MobileSessionRunConfig: () => null,
}));
vi.mock('../src/components/sessions/session-usage-popover', () => ({
  SessionUsagePopover: () => null,
}));
vi.mock('../src/hooks/use-code-collab-requested-role', () => ({
  useCodeCollabRequestedRole: () => null,
}));
vi.mock('../src/hooks/use-code-collab-session-file-provider', () => ({
  useCodeCollabSessionFileProvider: () => ({
    status: 'idle',
    provider: null,
    message: null,
  }),
}));

import { SessionChatInputArea } from '../src/components/sessions/session-chat-input-area';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('SessionChatInputArea submission feedback', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

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
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    Reflect.deleteProperty(window, '__LODY_NATIVE__');
    root = null;
    container?.remove();
    container = null;
  });

  it('clears immediately and restores the preserved draft when acceptance fails', async () => {
    const acceptance = deferredBoolean();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(SessionChatInputArea, {
          session: {
            id: 'session-feedback',
            userId: 'user-1',
            machineId: 'machine-1',
            cliType: 'builtin',
            agentType: 'codex',
            status: { type: 'idle' },
            isArchived: false,
            createdAt: '2026-07-19T00:00:00.000Z',
          } as SessionMeta,
          sessionLocalProjectRootPath: null,
          isMachineRemoved: false,
          isAgentBusy: false,
          isDark: false,
          isEmptyConversation: false,
          selectedModeId: null,
          selectedModelId: null,
          modeOptions: [],
          modelOptions: [],
          onModeChange: () => undefined,
          onModelChange: () => undefined,
          onSendMessage: () => acceptance.promise,
          onStop: () => undefined,
          onRemoveQueueItem: async () => undefined,
          initialInputText: 'preserved draft',
        })
      );
    });

    expect(container.querySelector('textarea')?.value).toBe('preserved draft');

    await act(async () => {
      container?.querySelector('button')?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('textarea')?.value).toBe('');
    expect(container.querySelector('textarea')?.disabled).toBe(true);

    await act(async () => {
      acceptance.resolve(false);
      await acceptance.promise;
    });

    expect(container.querySelector('textarea')?.value).toBe('preserved draft');
    expect(container.querySelector('textarea')?.disabled).toBe(false);
  });

  it('dismisses the mobile keyboard for keyboard and button sends', async () => {
    let acceptance = deferredBoolean();
    Object.defineProperty(window, '__LODY_NATIVE__', {
      configurable: true,
      value: true,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(SessionChatInputArea, {
          session: {
            id: 'session-mobile-keyboard-send',
            userId: 'user-1',
            machineId: 'machine-1',
            cliType: 'builtin',
            agentType: 'codex',
            status: { type: 'idle' },
            isArchived: false,
            createdAt: '2026-07-19T00:00:00.000Z',
          } as SessionMeta,
          sessionLocalProjectRootPath: null,
          isMachineRemoved: false,
          isAgentBusy: false,
          isDark: false,
          isEmptyConversation: false,
          selectedModeId: null,
          selectedModelId: null,
          modeOptions: [],
          modelOptions: [],
          onModeChange: () => undefined,
          onModelChange: () => undefined,
          onSendMessage: () => acceptance.promise,
          onStop: () => undefined,
          onRemoveQueueItem: async () => undefined,
          initialInputText: 'send from keyboard',
        })
      );
    });

    const textarea = container.querySelector('textarea');
    const blurSpy = vi.spyOn(textarea!, 'blur');
    textarea?.focus();
    expect(document.activeElement).toBe(textarea);

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(blurSpy).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(textarea);
    expect(textarea?.value).toBe('');
    expect(textarea?.disabled).toBe(true);

    await act(async () => {
      acceptance.resolve(false);
      await acceptance.promise;
    });

    expect(textarea?.value).toBe('send from keyboard');
    expect(textarea?.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);

    acceptance = deferredBoolean();

    await act(async () => {
      container?.querySelector('button')?.click();
      await Promise.resolve();
    });

    expect(blurSpy).toHaveBeenCalledTimes(2);
    expect(document.activeElement).not.toBe(textarea);
    expect(textarea?.value).toBe('');
    expect(textarea?.disabled).toBe(true);

    await act(async () => {
      acceptance.resolve(true);
      await acceptance.promise;
    });

    expect(textarea?.disabled).toBe(false);
    expect(document.activeElement).not.toBe(textarea);
  });

  it('shows a turn limit without an upgrade action when none is provided', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(SessionChatInputArea, {
          session: {
            id: 'session-limit',
            userId: 'user-1',
            machineId: 'machine-1',
            cliType: 'builtin',
            agentType: 'codex',
            status: { type: 'idle' },
            isArchived: false,
            createdAt: '2026-07-19T00:00:00.000Z',
          } as SessionMeta,
          sessionLocalProjectRootPath: null,
          isMachineRemoved: false,
          isAgentBusy: false,
          isDark: false,
          isEmptyConversation: false,
          selectedModeId: null,
          selectedModelId: null,
          modeOptions: [],
          modelOptions: [],
          onModeChange: () => undefined,
          onModelChange: () => undefined,
          onSendMessage: async () => true,
          onStop: () => undefined,
          onRemoveQueueItem: async () => undefined,
          freeTurnLimitNotice: { current: 20, limit: 20 },
        })
      );
    });

    expect(container.textContent).toContain('limited to 20 turns');
    expect(container.textContent).not.toContain('Upgrade to Plus');
  });
});
