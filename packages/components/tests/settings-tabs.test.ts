import { describe, expect, it } from 'vitest';
import {
  getActiveSettingsTabId,
  SETTINGS_TAB_CONFIGS,
} from '../src/components/settings/settings-tabs';

describe('settings tabs', () => {
  it('resolves every configured path back to its tab', () => {
    for (const tab of SETTINGS_TAB_CONFIGS) {
      const pathname = tab.path.replace('$workspaceName', 'acme');
      expect(getActiveSettingsTabId(pathname), pathname).toBe(tab.id);
    }
  });
});
