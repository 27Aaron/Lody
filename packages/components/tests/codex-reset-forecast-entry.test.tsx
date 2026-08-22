// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId, MachineViewMeta } from '@lody/shared';

import { CodexResetForecastUsageRow } from '../src/components/codex-reset/codex-reset-forecast-entry';
import { ProviderRow } from '../src/components/settings/provider-row';
import type {
  CodexResetStatus,
  CodexResetStatusFetchResult,
  CodexResetWatch,
} from '../src/lib/codex-reset-forecast';
import {
  createCodexResetForecastStore,
  setCodexResetForecastStoreForTests,
  type CodexResetForecastState,
  type CodexResetForecastStore,
} from '../src/lib/codex-reset-forecast-store';
import { initI18n } from '../src/i18n';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Offsets are taken from the real clock the components read (`getServerNow`),
 * with hour-scale margins — no timer, no sleep, and no ordering luck.
 */
const watchExpiringIn = (offsetMs: number): CodexResetWatch => {
  const expiresAtMs = Date.now() + offsetMs;
  const observedAtMs = expiresAtMs - 6 * HOUR_MS;
  return {
    level: 'strong',
    chancePercent: 65,
    windowText: 'the next 6 hours',
    observedAtIso: new Date(observedAtMs).toISOString(),
    observedAtMs,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    text: 'Reset landing soon.',
    source: null,
  };
};

const stubStore = (state: CodexResetForecastState) => {
  const store: CodexResetForecastStore = {
    subscribe: () => () => {},
    getState: () => state,
    revalidate: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
  };
  setCodexResetForecastStoreForTests(store);
  return store;
};

const readyWith = (watch: CodexResetWatch | null): CodexResetForecastState => ({
  status: 'ready',
  data: { watch, latestReset: null } satisfies CodexResetStatus,
  error: null,
});

const machineId = 'machine-test' as MachineId;
const machine: MachineViewMeta = {
  id: machineId,
  name: 'Workstation',
  cliVersion: '0.83.0',
  os: 'macOS',
  sessions: [],
  raceLimits: {
    codex: { fiveHour: 40, sevenDay: 10 },
  },
};

const makeConfig = (
  overrides: Pick<AgentConfigMeta, 'cliType' | 'agentType'> & Partial<AgentConfigMeta>
): AgentConfigMeta => ({
  id: `config-${overrides.agentType}` as AgentConfigId,
  machineId,
  name: overrides.agentType,
  env: {},
  ...overrides,
});

describe('Codex reset forecast entry points', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setCodexResetForecastStoreForTests(null);
    vi.restoreAllMocks();
  });

  const render = async (node: React.ReactNode) => {
    await act(async () => {
      root.render(node);
    });
  };

  const findChip = () =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Reset forecast')
    );

  describe('provider row chip', () => {
    it('shows the forecast entry with its probability on a built-in Codex provider', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(
        <ProviderRow
          config={makeConfig({ cliType: 'builtin', agentType: 'codex' })}
          machine={machine}
          onEdit={vi.fn()}
        />
      );

      expect(findChip()?.textContent).toBe('Reset forecast 65%');
    });

    it('falls back to a plain entry label when no forecast is in force', async () => {
      stubStore(readyWith(null));
      await render(
        <ProviderRow
          config={makeConfig({ cliType: 'builtin', agentType: 'codex' })}
          machine={machine}
          onEdit={vi.fn()}
        />
      );

      expect(findChip()?.textContent).toBe('Reset forecast');
    });

    it('places the entry before the rate-limit meters', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(
        <ProviderRow
          config={makeConfig({ cliType: 'builtin', agentType: 'codex' })}
          machine={machine}
          onEdit={vi.fn()}
        />
      );

      const chip = findChip();
      const meter = Array.from(container.querySelectorAll('span')).find((node) =>
        node.getAttribute('title')?.startsWith('5h:')
      );
      expect(chip).toBeTruthy();
      expect(meter).toBeTruthy();
      expect(
        (chip?.compareDocumentPosition(meter as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('opens the forecast dialog when the entry is activated', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(
        <ProviderRow
          config={makeConfig({ cliType: 'builtin', agentType: 'codex' })}
          machine={machine}
          onEdit={vi.fn()}
        />
      );

      expect(document.querySelector('[data-lody-dialog-content]')).toBeNull();
      await act(async () => {
        findChip()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const dialog = document.querySelector('[data-lody-dialog-content]');
      expect(dialog?.textContent).toContain('65% chance of a reset');
    });

    it('does not open the provider editor when the entry is clicked', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      const onEdit = vi.fn();
      await render(
        <ProviderRow
          config={makeConfig({ cliType: 'builtin', agentType: 'codex' })}
          machine={machine}
          onEdit={onEdit}
        />
      );

      await act(async () => {
        findChip()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onEdit).not.toHaveBeenCalled();
    });

    // The forecast tracks OpenAI's limits, so it must not follow other providers
    // and must not cost a request on them either.
    it.each([
      { cliType: 'builtin', agentType: 'claude' },
      { cliType: 'registry', agentType: 'auggie' },
      { cliType: 'custom', agentType: 'codex' },
    ] as const)('is absent and makes no request for $agentType/$cliType', async (overrides) => {
      const store = stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(
        <ProviderRow config={makeConfig(overrides)} machine={machine} onEdit={vi.fn()} />
      );

      expect(findChip()).toBeUndefined();
      expect(store.revalidate).not.toHaveBeenCalled();
    });

    it('is absent for a Codex provider pointed at another vendor', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(
        <ProviderRow
          config={makeConfig({
            cliType: 'builtin',
            agentType: 'codex',
            env: { OPENAI_BASE_URL: 'https://example.invalid' },
          })}
          machine={machine}
          onEdit={vi.fn()}
        />
      );

      expect(findChip()).toBeUndefined();
    });
  });

  // The popover renders this row only while it is open, so mounting the row IS
  // the "user opened the rate limits" moment.
  describe('usage popover row', () => {
    const rowText = () =>
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Reset forecast')
      )?.textContent;

    it('reports the probability and the forecast window', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(<CodexResetForecastUsageRow enabled onOpen={vi.fn()} />);

      expect(rowText()).toBe('Reset forecast65% chancethe next 6 hours');
    });

    it('drops the percentage when the forecast has none', async () => {
      stubStore(readyWith({ ...watchExpiringIn(5 * HOUR_MS), chancePercent: null }));
      await render(<CodexResetForecastUsageRow enabled onOpen={vi.fn()} />);

      expect(rowText()).toBe('Reset forecastthe next 6 hours');
    });

    // The popover reports a forecast, never its absence.
    it.each([
      ['an expired forecast', () => readyWith(watchExpiringIn(-HOUR_MS))],
      ['no forecast', () => readyWith(null)],
      [
        'a failed load',
        () => ({ status: 'error', data: null, error: 'offline' }) as CodexResetForecastState,
      ],
      [
        'the first load',
        () => ({ status: 'loading', data: null, error: null }) as CodexResetForecastState,
      ],
    ])('renders nothing for %s', async (_label, makeState) => {
      stubStore(makeState());
      await render(<CodexResetForecastUsageRow enabled onOpen={vi.fn()} />);

      expect(container.textContent).toBe('');
    });

    it('renders nothing and makes no request when disabled', async () => {
      const store = stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      await render(<CodexResetForecastUsageRow enabled={false} onOpen={vi.fn()} />);

      expect(container.textContent).toBe('');
      expect(store.revalidate).not.toHaveBeenCalled();
    });

    // A watch lapses on a wall-clock deadline, not on any event this component
    // observes, so the shared minute ticker has to drive the recheck.
    it('drops the row on its own once the forecast expires', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.parse('2026-08-20T06:00:00.000Z'));
        stubStore(readyWith(watchExpiringIn(30_000)));
        await render(<CodexResetForecastUsageRow enabled onOpen={vi.fn()} />);
        expect(rowText()).toContain('Reset forecast');

        // One tick of the shared 60s clock carries past the expiry.
        await act(async () => {
          vi.advanceTimersByTime(60_000);
        });

        expect(container.textContent).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the row across a tick that does not reach the expiry', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.parse('2026-08-20T06:00:00.000Z'));
        stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
        await render(<CodexResetForecastUsageRow enabled onOpen={vi.fn()} />);

        await act(async () => {
          vi.advanceTimersByTime(60_000);
        });

        expect(rowText()).toContain('Reset forecast');
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks its caller to open the dialog instead of rendering one itself', async () => {
      stubStore(readyWith(watchExpiringIn(5 * HOUR_MS)));
      const onOpen = vi.fn();
      await render(<CodexResetForecastUsageRow enabled onOpen={onOpen} />);

      await act(async () => {
        container
          .querySelector('button')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-lody-dialog-content]')).toBeNull();
    });
  });

  // `SessionUsagePopover` mounts once per open tab and side chat (hidden ones
  // included) and `ProviderRow` once per provider, so the shared store — not the
  // component — is what must own the request.
  describe('shared request budget', () => {
    it('makes exactly one request no matter how many Codex surfaces open at once', async () => {
      const pending: Array<(value: CodexResetStatusFetchResult) => void> = [];
      const fetchStatus = vi.fn(
        () => new Promise<CodexResetStatusFetchResult>((resolve) => pending.push(resolve))
      );
      setCodexResetForecastStoreForTests(
        createCodexResetForecastStore({ fetchStatus, now: () => 0 })
      );

      const codexConfigs = Array.from({ length: 4 }, (_, index) => ({
        ...makeConfig({ cliType: 'builtin', agentType: 'codex' }),
        id: `config-codex-${index}` as AgentConfigId,
      }));

      await render(
        <>
          {codexConfigs.map((config) => (
            <ProviderRow key={config.id} config={config} machine={machine} onEdit={vi.fn()} />
          ))}
          <CodexResetForecastUsageRow enabled onOpen={vi.fn()} />
          <CodexResetForecastUsageRow enabled onOpen={vi.fn()} />
          <CodexResetForecastUsageRow enabled onOpen={vi.fn()} />
        </>
      );

      // The provider rows are only listed, so the three opened popover rows are
      // the only callers — and they coalesce onto one in-flight request.
      expect(fetchStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending[0]({
          status: { watch: watchExpiringIn(5 * HOUR_MS), latestReset: null },
          etag: 'W/"1"',
          maxAgeMs: 4 * HOUR_MS,
        });
      });

      // Every surface picked the one result up, and the freshness window keeps
      // the next open from re-requesting.
      expect(container.querySelectorAll('button[aria-haspopup="dialog"]').length).toBe(7);
      await render(<CodexResetForecastUsageRow enabled onOpen={vi.fn()} />);
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });

    it('makes no request when only non-Codex providers are mounted', async () => {
      const fetchStatus = vi.fn(() => Promise.resolve({} as CodexResetStatusFetchResult));
      setCodexResetForecastStoreForTests(
        createCodexResetForecastStore({ fetchStatus, now: () => 0 })
      );

      await render(
        <>
          <ProviderRow
            config={makeConfig({ cliType: 'builtin', agentType: 'claude' })}
            machine={machine}
            onEdit={vi.fn()}
          />
          <CodexResetForecastUsageRow enabled={false} onOpen={vi.fn()} />
        </>
      );

      expect(fetchStatus).not.toHaveBeenCalled();
    });
  });
});
