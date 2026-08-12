// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Records the `enabled` argument the composer passes to the skills scan. */
const skillScanEnabled: boolean[] = [];
const sessionItems: Array<{ sessionId: string; title: string; slug: string }> = [];

vi.mock('../src/components/mentions/mention-project-file-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMentionProjectFiles: () => ({
    fileData: { entry: null, status: 'ready' as const },
    initializeLazyDirectory: async () => undefined,
    getKnownFileTokens: () => new Set<string>(),
  }),
}));

vi.mock('../src/components/mentions/mention-skill-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMentionProjectSkills: (_source: unknown, enabled: boolean) => {
    skillScanEnabled.push(enabled);
    return {
      skillState: { status: enabled ? ('ready' as const) : ('idle' as const) },
      skillItems: [],
      knownSkillTokens: new Set<string>(),
    };
  },
}));

vi.mock('../src/components/mentions/mention-session-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionMentionItems: () => sessionItems,
}));

import { CombinedMentionTextarea } from '../src/components/mentions/combined-mention-textarea';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CombinedMentionTextarea mention enablement and activation', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    await initI18n('en');
    skillScanEnabled.length = 0;
    sessionItems.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(props: {
    value: string;
    skillAgent?: { machineId?: string; cliType?: string };
  }) {
    await act(async () => {
      root.render(
        <CombinedMentionTextarea
          value={props.value}
          onValueChange={() => undefined}
          skillAgent={props.skillAgent as never}
          resetOnEmpty={false}
        />
      );
    });
  }

  function textarea() {
    return container.querySelector('textarea');
  }

  /**
   * The `<Mention>` tree renders a real `<label>`; the plain-textarea fallback
   * only sets `aria-label`. That is the observable difference between a
   * composer that can mention and one that silently cannot.
   */
  function mentionTreeMounted() {
    return container.querySelector('label') !== null;
  }

  /** Types into the composer the way the mention primitive observes it. */
  async function typeInto(value: string) {
    const input = textarea();
    if (!input) throw new Error('composer textarea missing');
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(input, value);
      input.selectionStart = value.length;
      input.selectionEnd = value.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('renders a plain textarea when no mention type is reachable', async () => {
    await render({ value: '' });

    expect(textarea()).not.toBeNull();
    expect(mentionTreeMounted()).toBe(false);
  });

  it('mounts the mention tree when sessions are the only mentionable type', async () => {
    sessionItems.push({ sessionId: 's1', title: 'Fix the parser', slug: 'fix-the-parser' });

    await render({ value: '' });

    expect(mentionTreeMounted()).toBe(true);
  });

  it('does not scan skills until something asks for them', async () => {
    await render({ value: '', skillAgent: { machineId: 'machine-1' } });

    expect(skillScanEnabled).not.toContain(true);
  });

  it('scans skills when the menu scopes to the Skills category', async () => {
    await render({ value: '', skillAgent: { machineId: 'machine-1' } });
    expect(skillScanEnabled).not.toContain(true);

    // Typed/pasted namespace prefixes still activate their lazy source.
    await typeInto('@skill:');

    expect(skillScanEnabled).toContain(true);
  });

  it('retains $ as a direct skill-menu trigger', async () => {
    await render({ value: '', skillAgent: { machineId: 'machine-1' } });
    expect(skillScanEnabled).not.toContain(true);

    await typeInto('$');

    expect(skillScanEnabled).toContain(true);
  });

  it('still scans skills for a draft that already carries a $ token', async () => {
    await render({ value: 'use $review', skillAgent: { machineId: 'machine-1' } });

    expect(skillScanEnabled).toContain(true);
  });
});
