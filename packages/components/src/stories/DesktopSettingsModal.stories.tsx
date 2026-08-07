import type { Meta, StoryObj } from '@storybook/react';
import type { ReactNode } from 'react';
import { Provider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { MemoryRouter } from 'react-router-dom';
import { settingsActiveTabAtom, settingsDialogOpenAtom } from '@/atoms';
import type { SettingsTabId } from '@/components/settings/settings-tabs';
import { DesktopSettingsModal } from '@/components/settings/desktop-settings-modal';

/**
 * Desktop settings modal — the overlay that replaces the full-page settings route on
 * non-mobile viewports. These stories open it at low-dependency tabs (General / About);
 * runtime-heavy tabs (Account, Stats, Agent config, GitHub) need a live workspace
 * runtime and are exercised in the app rather than here.
 */
function OpenModalAt({ tab, children }: { tab: SettingsTabId; children: ReactNode }) {
  useHydrateAtoms([
    [settingsDialogOpenAtom, true],
    [settingsActiveTabAtom, tab],
  ]);
  return <>{children}</>;
}

const meta = {
  title: 'Settings/DesktopSettingsModal',
  component: DesktopSettingsModal,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof DesktopSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GeneralTab: Story = {
  render: () => (
    <MemoryRouter>
      <Provider>
        <OpenModalAt tab="general">
          <DesktopSettingsModal />
        </OpenModalAt>
      </Provider>
    </MemoryRouter>
  ),
};

export const AboutTab: Story = {
  render: () => (
    <MemoryRouter>
      <Provider>
        <OpenModalAt tab="about">
          <DesktopSettingsModal />
        </OpenModalAt>
      </Provider>
    </MemoryRouter>
  ),
};

export const DarkModeGeneralTab: Story = {
  render: () => (
    <div className="dark">
      <MemoryRouter>
        <Provider>
          <OpenModalAt tab="general">
            <DesktopSettingsModal />
          </OpenModalAt>
        </Provider>
      </MemoryRouter>
    </div>
  ),
};
