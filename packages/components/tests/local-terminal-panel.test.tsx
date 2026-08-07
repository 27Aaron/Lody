// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { terminalFontFamilyAtom, terminalFontSizeAtom } from '../src/atoms/settings';
import { LocalTerminalPanel } from '../src/components/terminal/local-terminal-panel';
import type { TerminalChannel } from '../src/components/terminal/terminal-channel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  terminalInstances: [] as Array<{ options: Record<string, unknown> }>,
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

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      mocks.terminalInstances.push(this);
    }

    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
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
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    onTitle: vi.fn(() => vi.fn()),
  };
}

describe('LocalTerminalPanel font settings', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
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
});
