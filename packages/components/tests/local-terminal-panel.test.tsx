// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { terminalFontFamilyAtom, terminalFontSizeAtom } from '../src/atoms/settings';
import { LocalTerminalPanel } from '../src/components/terminal/local-terminal-panel';
import type { TerminalChannel } from '../src/components/terminal/terminal-channel';
import { initI18n } from '../src/i18n';
import { __resetPlatformCacheForTests } from '../src/lib/commands/platform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  terminalInstances: [] as Array<{
    options: Record<string, unknown>;
    selection: string;
    pasted: string[];
    customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  }>,
  fit: vi.fn(),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = mocks.fit;
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    selection = '';
    pasted: string[] = [];
    customKeyEventHandler?: (event: KeyboardEvent) => boolean;

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      mocks.terminalInstances.push(this);
    }

    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.customKeyEventHandler = handler;
    }
    hasSelection() {
      return this.selection.length > 0;
    }
    getSelection() {
      return this.selection;
    }
    paste(text: string) {
      this.pasted.push(text);
    }
    write(_data: string, callback?: () => void) {
      callback?.();
    }
    onData() {
      return { dispose: vi.fn() };
    }
    onResize() {
      return { dispose: vi.fn() };
    }
    onTitleChange() {
      return { dispose: vi.fn() };
    }
  },
}));

vi.mock('../src/lib/resize-observer', () => ({
  observeResizeOnAnimationFrame: () => vi.fn(),
}));

vi.mock('../src/theme-provider', () => ({
  useResolvedTheme: () => 'light',
  useActiveVSCodeThemeId: () => null,
}));

function createChannel(): TerminalChannel {
  return {
    list: vi.fn(async () => []),
    open: vi.fn(async () => ({ terminalId: 'terminal-1', title: 'shell' })),
    attach: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeSession: vi.fn(),
    readClipboardText: vi.fn(() => ''),
    writeClipboardText: vi.fn(),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    onTitle: vi.fn(() => vi.fn()),
  };
}

function openTerminalContextMenu(container: HTMLDivElement | undefined): void {
  const host = container?.querySelector('.lody-terminal-panel');
  if (!host) throw new Error('Terminal host not found');
  host.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    })
  );
}

function getMenuItem(label: string): HTMLElement {
  const menuItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent?.includes(label)
  );
  if (!menuItem) throw new Error(`Menu item not found: ${label}`);
  return menuItem;
}

describe('LocalTerminalPanel', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    __resetPlatformCacheForTests();
    mocks.terminalInstances.length = 0;
    mocks.fit.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    __resetPlatformCacheForTests();
  });

  it('updates and refits the existing xterm instance', async () => {
    const store = createStore();
    const channel = createChannel();

    await act(async () => {
      root?.render(
        <Provider store={store}>
          <LocalTerminalPanel channel={channel} terminalId="terminal-1" />
        </Provider>
      );
      await Promise.resolve();
    });

    expect(mocks.terminalInstances).toHaveLength(1);
    const terminal = mocks.terminalInstances[0];
    const initialFitCount = mocks.fit.mock.calls.length;

    await act(async () => {
      store.set(terminalFontFamilyAtom, 'Maple Mono');
      store.set(terminalFontSizeAtom, 16);
      await Promise.resolve();
    });

    expect(mocks.terminalInstances).toHaveLength(1);
    expect(terminal.options.fontFamily).toContain('"Maple Mono"');
    expect(terminal.options.fontSize).toBe(16);
    expect(mocks.fit.mock.calls.length).toBeGreaterThan(initialFitCount);
  });

  it('copies the active selection with Ctrl+Shift+C without changing Ctrl+C', async () => {
    const channel = createChannel();

    await act(async () => {
      root?.render(<LocalTerminalPanel channel={channel} terminalId="terminal-1" />);
      await Promise.resolve();
    });

    const terminal = mocks.terminalInstances[0];
    terminal.selection = 'selected output';
    const copyEvent = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    expect(terminal.customKeyEventHandler?.(copyEvent)).toBe(false);
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(channel.writeClipboardText).toHaveBeenCalledWith('selected output');

    const interruptEvent = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      cancelable: true,
    });
    expect(terminal.customKeyEventHandler?.(interruptEvent)).toBe(true);
    expect(channel.writeClipboardText).toHaveBeenCalledTimes(1);
  });

  it('copies and pastes through the terminal context menu', async () => {
    const channel = createChannel();
    vi.mocked(channel.readClipboardText).mockReturnValue('clipboard input');

    await act(async () => {
      root?.render(<LocalTerminalPanel channel={channel} terminalId="terminal-1" />);
      await Promise.resolve();
    });

    const terminal = mocks.terminalInstances[0];
    terminal.selection = 'selected output';

    await act(async () => {
      openTerminalContextMenu(container);
    });

    const copyItem = getMenuItem('Copy');
    await act(async () => copyItem.click());
    expect(channel.writeClipboardText).toHaveBeenCalledWith('selected output');

    await act(async () => {
      openTerminalContextMenu(container);
    });
    const pasteItem = getMenuItem('Paste');
    await act(async () => pasteItem.click());
    expect(terminal.pasted).toEqual(['clipboard input']);
  });

  it('shows Cmd+C for the copy action on macOS', async () => {
    vi.stubGlobal('__LODY_PLATFORM__', { os: 'darwin' });
    __resetPlatformCacheForTests();
    const channel = createChannel();

    await act(async () => {
      root?.render(<LocalTerminalPanel channel={channel} terminalId="terminal-1" />);
      await Promise.resolve();
    });

    await act(async () => {
      openTerminalContextMenu(container);
    });

    const copyItem = getMenuItem('Copy');
    expect(copyItem.textContent).toContain('⌘C');
    expect(copyItem.textContent).not.toContain('Ctrl+Shift+C');
  });
});
