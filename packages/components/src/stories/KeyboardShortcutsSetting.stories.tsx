import type { Meta, StoryObj } from '@storybook/react';
import { KeyboardShortcutsSetting } from '@/components/settings/keyboard-shortcuts-setting';

/*
 * The global-shortcuts section only renders on the Electron runtime and reads the live
 * bindings from `window.api.globalShortcuts`. Fake both at module load (before any
 * `getRuntime()` call, which caches) so this story exercises the editable global rows —
 * click a row to record or clear it — without a real desktop build.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __LODY_ELECTRON__?: boolean }).__LODY_ELECTRON__ = true;
  let appFocusBinding: string | null = 'Ctrl+Alt+l';
  const win = window as unknown as {
    api?: {
      globalShortcuts?: {
        getAll: () => Promise<unknown>;
        set: (input: { id: string; binding: string | null }) => Promise<unknown>;
      };
    };
  };
  win.api = {
    ...win.api,
    globalShortcuts: {
      getAll: async () => [
        {
          id: 'app.focus',
          binding: appFocusBinding,
          defaultBinding: 'Ctrl+Alt+l',
        },
      ],
      set: async (input) => {
        if (input.id === 'app.focus') {
          appFocusBinding = input.binding;
          return { ok: true, binding: appFocusBinding };
        }
        return { ok: false, error: 'invalid' };
      },
    },
  };
}

const meta = {
  title: 'Settings/KeyboardShortcutsSetting',
  component: KeyboardShortcutsSetting,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof KeyboardShortcutsSetting>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-[560px] rounded-lg border border-border/60 bg-background p-4">
      <KeyboardShortcutsSetting />
    </div>
  ),
};
