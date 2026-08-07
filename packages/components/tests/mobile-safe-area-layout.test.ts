import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  getLoroSidebarFooterClassName,
  getLoroSidebarFooterIconButtonClassName,
} from '../src/components/loro-sidebar';
import { getMobileSidebarDrawerPanelClassName } from '../src/components/mobile/mobile-sidebar-drawer';
import { getSessionChatInputAreaShellClassName } from '../src/components/sessions/session-chat-input-area';
import {
  getMobileMainLayoutRootClassName,
  getMobileMainLayoutContentClassName,
} from '../src/components/main-layout';
import { NATIVE_KEYBOARD_OFFSET_CLASS } from '../src/components/workspace-layout-utils';

const mobileHomeScreenSource = readFileSync(
  new URL('../src/components/mobile/mobile-home-screen.tsx', import.meta.url),
  'utf8'
);

const mobileWorkspaceStackSource = readFileSync(
  new URL('../src/components/mobile/mobile-workspace-stack.tsx', import.meta.url),
  'utf8'
);

const webWorkspaceLayoutSource = readFileSync(
  new URL('../src/components/web-workspace-layout.tsx', import.meta.url),
  'utf8'
);

const webChatLandingScreenSource = readFileSync(
  new URL('../src/components/chat/web-chat-landing-screen.tsx', import.meta.url),
  'utf8'
);

const tailwindEntryCss = readFileSync(
  new URL('../src/tailwind/index.css', import.meta.url),
  'utf8'
);

describe('mobile safe-area layout', () => {
  it('uses h-full so it matches the parent (#root) height exactly', () => {
    const rootClassName = getMobileMainLayoutRootClassName();

    // h-full matches #root's height: 100% so overflow: hidden on #root does
    // not clip the layout bottom.  With interactive-widget=resizes-content the
    // ICB resizes when the keyboard opens, so h-full still tracks correctly.
    expect(rootClassName).toContain('h-full');
    expect(rootClassName).toContain('overflow-hidden');
    // Must NOT use h-dvh — on iOS Safari with viewport-fit=cover, 100dvh can
    // exceed #root's 100% height, causing overflow clipping of bottom controls.
    expect(rootClassName).not.toContain('h-dvh');
    expect(rootClassName).not.toContain('h-svh');
  });

  it('applies native keyboard height padding to mobile main layout root', () => {
    const rootClassName = getMobileMainLayoutRootClassName();

    // On iOS native (Capacitor), --native-keyboard-height is set by @capacitor/keyboard.
    // The root container shrinks its usable area so all content shifts above the keyboard.
    // On Android the variable stays 0 because the native WebView already resizes.
    expect(rootClassName).toContain('pb-[var(--native-keyboard-height)]');
    expect(rootClassName).toContain(NATIVE_KEYBOARD_OFFSET_CLASS);
  });

  it('keeps the shared native keyboard offset as an animated bottom padding', () => {
    expect(NATIVE_KEYBOARD_OFFSET_CLASS).toContain('pb-[var(--native-keyboard-height)]');
    // Animate the shift so the keyboard open/close tracks smoothly, matching mobile.
    expect(NATIVE_KEYBOARD_OFFSET_CLASS).toContain('transition-[padding-bottom]');
  });

  it('applies the native keyboard offset class to the desktop layout (iPad native shell)', () => {
    // iPad renders the desktop WebWorkspaceLayout (viewport width >= 768) but runs
    // in the Capacitor shell, where viewport meta is overlaps-content so h-svh does
    // NOT shrink for the keyboard. Without the offset the soft keyboard covers the
    // input box. Both the settings and main branches must apply the class.
    // Android also receives the class, but its CSS variable remains 0 to avoid
    // double offsetting on top of Android's WebView resize.
    expect(webWorkspaceLayoutSource).toContain('NATIVE_KEYBOARD_OFFSET_CLASS');
    const offsetUsages = webWorkspaceLayoutSource.match(/NATIVE_KEYBOARD_OFFSET_CLASS/g) ?? [];
    // 1 import + 2 layout branches (settings route + main).
    expect(offsetUsages.length).toBeGreaterThanOrEqual(3);
  });

  it('docks the desktop chat-landing composer via the shared session composer shell', () => {
    // The landing now bottom-docks its composer using the SAME shell class as the session
    // composer, so it inherits that shell's --native-keyboard-height lift + safe-area
    // padding and can never drift from the session (which the input must match on send).
    expect(webChatLandingScreenSource).toContain('getSessionChatInputAreaShellClassName');
    // The composer is wrapped in ConversationColumn so its max width matches the session.
    expect(webChatLandingScreenSource).toContain('ConversationColumn');
    // The greeting region fills the space above the docked composer and yields to the
    // keyboard by scrolling, rather than holding a fixed spacer.
    expect(webChatLandingScreenSource).toMatch(/flex min-h-0 flex-1 flex-col .*overflow-auto/);
    // The old fixed/shrinkable spacer hack must be gone.
    expect(webChatLandingScreenSource).not.toContain('basis-[calc(20vh-50px)]');
    expect(webChatLandingScreenSource).not.toContain('max-w-3xl');
    expect(webChatLandingScreenSource).not.toContain('top-[-50px]');
    expect(webChatLandingScreenSource).not.toMatch(/pt-\[20vh\]/);
  });

  it('keeps mobile main layout content wrapper as flex column', () => {
    const contentClassName = getMobileMainLayoutContentClassName();

    expect(contentClassName).toContain('flex-1');
    expect(contentClassName).toContain('flex-col');
    expect(contentClassName).toContain('overflow-hidden');
  });

  it('keeps the mobile sidebar drawer flush with the viewport bottom', () => {
    const className = getMobileSidebarDrawerPanelClassName();

    expect(className).toContain('inset-y-0');
    expect(className).toContain('h-full');
  });

  it('keeps the mobile sidebar footer flush with the sidebar bottom', () => {
    const className = getLoroSidebarFooterClassName(true);

    expect(className).toContain('shrink-0');
    expect(className).toContain('pb-2');
    expect(className).toContain('pr-[calc(12px+var(--safe-area-right))]');
  });

  it('keeps the desktop sidebar footer button dimensions reusable by settings', () => {
    const className = getLoroSidebarFooterIconButtonClassName(false);

    expect(className).toContain('h-7');
    expect(className).toContain('w-7');
    expect(className).toContain('rounded-md');
    expect(className).toContain('text-sidebar-foreground');
    expect(className).toContain('dark:text-sidebar-foreground-muted');
  });

  it('keeps the session composer controls above the safe area and native keyboard', () => {
    const className = getSessionChatInputAreaShellClassName({
      protectFromEdgeBackZone: true,
    });

    expect(className).toContain('shrink-0');
    // The native session drawer's transparent edge-back zone is z-30. The
    // composer must win hit testing so its leftmost controls remain tappable.
    expect(className).toContain('z-40');
    expect(className).toContain('mb-[var(--native-keyboard-height,0px)]');
    expect(className).toContain(
      'pb-[calc(0.5rem+max(0px,env(safe-area-inset-bottom,0px)-var(--native-keyboard-height,0px)))]'
    );
  });

  it('does not double apply native keyboard offset to the mobile session drawer', () => {
    // SessionChatInputArea already lifts the composer by --native-keyboard-height.
    // Adding the same offset to the portal drawer raises the composer twice.
    expect(mobileWorkspaceStackSource).not.toContain('NATIVE_KEYBOARD_OFFSET_CLASS');
  });

  it('uses Konsta v5 safe-area utility order on mobile home', () => {
    /* The home screen uses Konsta v5's `<axis>-safe-<scale>` ordering
       (e.g. `pt-safe-2`, `ps-safe-3`) on the sticky header. The
       list-region wrapper deliberately omits horizontal safe-area
       padding because the floating card inside owns its own
       safe-area-aware margins (see `.mobile-project-list-card` /
       `.mobile-home-list` in tailwind/index.css). The scale numbers
       drifted from `4` → `3` during the mobile-home Konsta App
       refactor; assert on whatever numeric the source currently uses
       so the regression check focuses on the *order* (axis-safe-N vs
       axis-N-safe), which is the Tailwind v3 → v4 break we care about. */
    expect(mobileHomeScreenSource).toMatch(/\bpt-safe-\d+\b/);
    expect(mobileHomeScreenSource).toMatch(/\bps-safe-\d+\b/);
    expect(mobileHomeScreenSource).toMatch(/\bpe-safe-\d+\b/);

    expect(mobileHomeScreenSource).not.toMatch(/\bpt-\d+-safe\b/);
    expect(mobileHomeScreenSource).not.toMatch(/\bps-\d+-safe\b/);
    expect(mobileHomeScreenSource).not.toMatch(/\bpe-\d+-safe\b/);
  });

  it('includes top safe area in mobile home sticky header offset', () => {
    expect(tailwindEntryCss).toContain(
      '--mobile-home-header-height: calc(3.25rem + var(--k-safe-area-top, 0px));'
    );
  });
});
