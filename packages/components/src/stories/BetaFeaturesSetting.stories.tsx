import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import { BetaFeaturesSection } from '@/components/settings/beta-features-setting';
import {
  developerModeEnabledAtom,
  tasksBetaEnabledAtom,
  tasksFeatureEnabledAtom,
} from '@/atoms/settings';
import { settingContainerClass } from '@/components/settings';

/**
 * The section is invisible unless Developer mode is on, so the interesting
 * states are the three combinations of the two switches — plus the readout of
 * the derived gate every Tasks surface actually reads.
 */
function GateReadout() {
  const enabled = useAtomValue(tasksFeatureEnabledAtom);
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      <span className="font-mono">tasksFeatureEnabledAtom</span> ={' '}
      <span className="font-mono font-semibold">{String(enabled)}</span>
      {enabled ? ' — sidebar entry, routes, commands and quick-add are live.' : ' — Tasks is absent.'}
    </p>
  );
}

function Harness({ developerMode, tasksBeta }: { developerMode: boolean; tasksBeta: boolean }) {
  // Seeded once per story: a store rebuilt on every render would throw away the
  // switch the viewer just clicked.
  const [store] = useState(() => {
    const next = createStore();
    next.set(developerModeEnabledAtom, developerMode);
    next.set(tasksBetaEnabledAtom, tasksBeta);
    return next;
  });

  return (
    <Provider store={store}>
      <div className={settingContainerClass}>
        <BetaFeaturesSection />
        <GateReadout />
      </div>
    </Provider>
  );
}

const meta = {
  title: 'Settings/BetaFeaturesSection',
  component: Harness,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Developer mode off: the section does not exist, and neither does Tasks. */
export const DeveloperModeOff: Story = {
  args: { developerMode: false, tasksBeta: false },
};

/** Developer mode on, beta not taken: the switch is offered but Tasks stays hidden. */
export const AvailableNotEnabled: Story = {
  args: { developerMode: true, tasksBeta: false },
};

/** Both on: the only combination in which the Tasks surfaces render. */
export const TasksBetaEnabled: Story = {
  args: { developerMode: true, tasksBeta: true },
};

/**
 * The opt-in persists while Developer mode is off, so the feature is hidden but
 * the choice is not lost — flipping Developer mode back on restores it.
 */
export const OptInRetainedWhileHidden: Story = {
  args: { developerMode: false, tasksBeta: true },
};
