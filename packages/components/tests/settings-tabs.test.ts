import { describe, expect, it } from 'vitest';

import { SETTINGS_TAB_CONFIGS } from '../src/components/settings/settings-tabs';

describe('SETTINGS_TAB_CONFIGS', () => {
  it('keeps Agent after Account and Billing before About', () => {
    expect(SETTINGS_TAB_CONFIGS.map((tab) => tab.id)).toEqual([
      'general',
      'appearance',
      'account',
      'agent-config',
      'stats',
      'projects',
      'devices',
      'github',
      'keyboard-shortcuts',
      'billing',
      'about',
    ]);
  });
});
