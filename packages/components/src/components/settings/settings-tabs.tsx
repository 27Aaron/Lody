import type { LucideIcon } from 'lucide-react';
import type { PlatformCapability } from '@lody/platform';
import { useAppCapabilityCheck } from '../../lib/app-platform';
import {
  Bot,
  ChartNoAxesCombined,
  CreditCard,
  FolderOpen,
  Github,
  Info,
  Keyboard,
  Monitor,
  Palette,
  Settings,
  UserRound,
} from 'lucide-react';

export type SettingsTabId =
  | 'general'
  | 'appearance'
  | 'account'
  | 'billing'
  | 'stats'
  | 'projects'
  | 'devices'
  | 'agent-config'
  | 'github'
  | 'keyboard-shortcuts'
  | 'about';

export type SettingsTabConfig = {
  id: SettingsTabId;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /** Cloud capability the whole tab depends on; the tab hides when missing. */
  capability?: PlatformCapability;
  path:
    | '/$workspaceName/settings/general'
    | '/$workspaceName/settings/appearance'
    | '/$workspaceName/settings/account'
    | '/$workspaceName/settings/billing'
    | '/$workspaceName/settings/stats'
    | '/$workspaceName/settings/projects'
    | '/$workspaceName/settings/devices'
    | '/$workspaceName/settings/agent-config'
    | '/$workspaceName/settings/github'
    | '/$workspaceName/settings/keyboard-shortcuts'
    | '/$workspaceName/settings/about';
};

export const SETTINGS_DEFAULT_TAB: SettingsTabId = 'general';

export const SETTINGS_TAB_CONFIGS: SettingsTabConfig[] = [
  {
    id: 'general',
    labelKey: 'settings.tabs.general',
    descriptionKey: 'settings.categories.general.description',
    icon: Settings,
    path: '/$workspaceName/settings/general',
  },
  {
    id: 'appearance',
    labelKey: 'settings.tabs.appearance',
    descriptionKey: 'settings.categories.appearance.description',
    icon: Palette,
    path: '/$workspaceName/settings/appearance',
  },
  {
    id: 'account',
    labelKey: 'settings.tabs.account',
    descriptionKey: 'settings.categories.account.description',
    icon: UserRound,
    capability: 'cloudAccount',
    path: '/$workspaceName/settings/account',
  },
  {
    id: 'agent-config',
    labelKey: 'settings.tabs.agentConfig',
    descriptionKey: 'settings.categories.agentConfig.description',
    icon: Bot,
    path: '/$workspaceName/settings/agent-config',
  },
  {
    id: 'stats',
    labelKey: 'settings.tabs.stats',
    descriptionKey: 'settings.categories.stats.description',
    icon: ChartNoAxesCombined,
    capability: 'usageAnalytics',
    path: '/$workspaceName/settings/stats',
  },
  {
    id: 'projects',
    labelKey: 'settings.tabs.projects',
    descriptionKey: 'settings.categories.projects.description',
    icon: FolderOpen,
    path: '/$workspaceName/settings/projects',
  },
  {
    id: 'devices',
    labelKey: 'settings.tabs.devices',
    descriptionKey: 'settings.categories.devices.description',
    icon: Monitor,
    path: '/$workspaceName/settings/devices',
  },
  {
    id: 'github',
    labelKey: 'settings.tabs.github',
    descriptionKey: 'settings.categories.github.description',
    icon: Github,
    capability: 'githubIntegration',
    path: '/$workspaceName/settings/github',
  },
  {
    id: 'keyboard-shortcuts',
    labelKey: 'settings.tabs.keyboardShortcuts',
    descriptionKey: 'settings.categories.keyboardShortcuts.description',
    icon: Keyboard,
    path: '/$workspaceName/settings/keyboard-shortcuts',
  },
  {
    id: 'billing',
    labelKey: 'settings.tabs.billing',
    descriptionKey: 'settings.categories.billing.description',
    icon: CreditCard,
    capability: 'billing',
    path: '/$workspaceName/settings/billing',
  },
  {
    id: 'about',
    labelKey: 'settings.tabs.about',
    descriptionKey: 'settings.categories.about.description',
    icon: Info,
    path: '/$workspaceName/settings/about',
  },
];

/**
 * Settings tabs visible on the current platform: tabs whose `capability` is
 * missing (open-source local build) are dropped at the registry level so no
 * consumer renders an entry point for them.
 */
export function useVisibleSettingsTabs(): SettingsTabConfig[] {
  const hasCapability = useAppCapabilityCheck();
  return SETTINGS_TAB_CONFIGS.filter(
    (tab) => tab.capability === undefined || hasCapability(tab.capability)
  );
}

export function getActiveSettingsTabId(pathname: string): SettingsTabId | null {
  if (pathname.endsWith('/settings/general')) {
    return 'general';
  }
  if (pathname.endsWith('/settings/appearance')) {
    return 'appearance';
  }
  if (pathname.endsWith('/settings/account')) {
    return 'account';
  }
  if (pathname.endsWith('/settings/billing')) {
    return 'billing';
  }
  if (pathname.endsWith('/settings/stats')) {
    return 'stats';
  }
  if (pathname.endsWith('/settings/projects')) {
    return 'projects';
  }
  if (pathname.endsWith('/settings/devices')) {
    return 'devices';
  }
  if (pathname.endsWith('/settings/agent-config')) {
    return 'agent-config';
  }
  if (pathname.endsWith('/settings/github')) {
    return 'github';
  }
  if (pathname.endsWith('/settings/keyboard-shortcuts')) {
    return 'keyboard-shortcuts';
  }
  if (pathname.endsWith('/settings/about')) {
    return 'about';
  }
  return null;
}
