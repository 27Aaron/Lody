// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initI18n } from '../src/i18n';
import {
  SKILL_MENTION_TRIGGER,
  SkillMentionMenu,
} from '../src/components/mentions/mention-skill-source';
import { Mention, MentionInput } from '../src/ui/mention';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * `SkillMentionMenu` is mounted by the composer for every session but renders
 * `null` unless the user actually engaged the `$` trigger. Its anchor-width
 * layout effect used to run regardless, forcing a synchronous style recalc of
 * the freshly mounted conversation on every session switch to produce a width
 * nothing ever read.
 *
 * Other mention internals legitimately measure and observe the same textarea,
 * so both cases are compared against a baseline tree WITHOUT the skill menu:
 * what is asserted is the menu's own contribution, not an absolute count.
 */
describe('SkillMentionMenu idle cost', () => {
  let cleanups: Array<() => void> = [];
  let observedTargets: Element[] = [];
  let measuredTargets: Element[] = [];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalGetBoundingClientRect: typeof HTMLTextAreaElement.prototype.getBoundingClientRect;

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    observedTargets = [];
    measuredTargets = [];
    cleanups = [];

    originalResizeObserver = globalThis.ResizeObserver;
    // jsdom ships no ResizeObserver and the production effect early-returns
    // without one, so a missing stub would make this pass vacuously.
    globalThis.ResizeObserver = class StubResizeObserver {
      observe(target: Element): void {
        observedTargets.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    originalGetBoundingClientRect = HTMLTextAreaElement.prototype.getBoundingClientRect;
    HTMLTextAreaElement.prototype.getBoundingClientRect = function patched(
      this: HTMLTextAreaElement
    ) {
      measuredTargets.push(this);
      return originalGetBoundingClientRect.call(this);
    };
  });

  afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    cleanups = [];
    HTMLTextAreaElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  /** Mounts a fresh tree and returns how often ITS textarea was observed/measured. */
  function mountAndCount(node: React.ReactElement): { observed: number; measured: number } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
    });

    act(() => {
      root.render(node);
    });

    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Expected the mention textarea to render');
    return {
      observed: observedTargets.filter((target) => target === textarea).length,
      measured: measuredTargets.filter((target) => target === textarea).length,
    };
  }

  /**
   * Both trees take identical `Mention` props so the only difference measured
   * is `SkillMentionMenu` itself. `trigger` is what the menu reads to decide
   * whether it is the active source, so the "open" case must set it to `$` —
   * a bare `defaultOpen` leaves the root on its default `@` trigger and the
   * skill menu still renders null.
   */
  const tree = (args: { inputValue: string; open: boolean; trigger: string; menu: boolean }) => (
    <Mention
      inputValue={args.inputValue}
      defaultOpen={args.open}
      trigger={args.trigger}
      triggers={[args.trigger]}
    >
      <MentionInput value={args.inputValue} onChange={() => {}} />
      {args.menu ? <SkillMentionMenu skillItems={[]} status="idle" allowedDirs={null} /> : null}
    </Mention>
  );

  it('adds no composer measurement or observation to a freshly mounted composer', () => {
    // The state a session switch produces: empty draft, menu closed, the root
    // still on its default `@` trigger.
    const args = { inputValue: '', open: false, trigger: '@' };
    const baseline = mountAndCount(tree({ ...args, menu: false }));
    const withClosedMenu = mountAndCount(tree({ ...args, menu: true }));

    expect(withClosedMenu.measured).toBe(baseline.measured);
    expect(withClosedMenu.observed).toBe(baseline.observed);
  });

  it('adds no composer measurement while another trigger owns the open menu', () => {
    const args = { inputValue: '@', open: true, trigger: '@' };
    const baseline = mountAndCount(tree({ ...args, menu: false }));
    const withInactiveMenu = mountAndCount(tree({ ...args, menu: true }));

    expect(withInactiveMenu.measured).toBe(baseline.measured);
    expect(withInactiveMenu.observed).toBe(baseline.observed);
  });

  it('still tracks the composer width once the $ menu is open', () => {
    const args = { inputValue: '$', open: true, trigger: SKILL_MENTION_TRIGGER };
    const baseline = mountAndCount(tree({ ...args, menu: false }));
    const withOpenMenu = mountAndCount(tree({ ...args, menu: true }));

    expect(withOpenMenu.measured).toBeGreaterThan(baseline.measured);
    expect(withOpenMenu.observed).toBeGreaterThan(baseline.observed);
  });
});
