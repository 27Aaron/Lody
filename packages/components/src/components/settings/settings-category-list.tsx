import { useTranslation } from 'react-i18next';
import { Bug, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/ui/card';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from '@tanstack/react-router';
import { bugReportDialogOpenAtom, currentWorkspaceSlugAtom } from '@/atoms';
import { isNativeAppShell } from '@/lib/native-platform';
import { cn } from '@/lib/utils';
import { useAppCapability } from '@/lib/app-platform';
import {
  useVisibleSettingsTabs,
  type SettingsTabConfig,
  type SettingsTabId,
} from './settings-tabs';

type SettingsCategoryListProps = {
  workspaceName?: string;
};

/* iOS-style grouped layout for the mobile settings list. Categories
   are bucketed into three sections so the surface reads as ordered
   rather than a single long undifferentiated list, mirroring the
   home Chat-tab grouping conventions (`MobileChatSectionHeading` +
   rounded card with inter-row dividers).

   The section grouping isn't load-bearing — re-order or re-bucket
   freely. The list still works if a tab id is missing from this map
   (we render whichever ids exist) or unknown to it (those fall into
   `misc`). */
/* Tabs hidden from the mobile settings list because their content is
   surfaced somewhere more contextual:
   - `projects`: per-project share + ACP history sync now live in the
     project's own detail page (`MobileLocalProjectSettings`). The
     workspace-wide `/settings/projects` URL still works for users
     who navigate there directly.
   - `keyboard-shortcuts`: mobile does not expose keyboard shortcut
     customization from the settings list. */
const HIDDEN_FROM_MOBILE_LIST = new Set<SettingsTabId>(['projects', 'keyboard-shortcuts']);

const SETTINGS_SECTIONS: Array<{
  id: 'personal' | 'workspace' | 'misc';
  headingKey: string;
  defaultHeading: string;
  tabIds: SettingsTabId[];
}> = [
  {
    id: 'personal',
    headingKey: 'settings.sections.personal',
    defaultHeading: 'Personal',
    tabIds: ['general', 'appearance', 'account'],
  },
  {
    id: 'workspace',
    headingKey: 'settings.sections.workspace',
    defaultHeading: 'Workspace',
    /* 统计 leads the workspace group: usage rollups are the most
       common "what's happening in this workspace" question, so we
       surface it at the top of the section. `projects` is
       intentionally excluded on mobile — per-project share + ACP
       history-sync controls live inside each project's detail page
       (see `MobileLocalProjectSettings` mounted by
       `chat-landing.tsx` for `MobileProjectScreen`'s settings tab).
       The desktop sidebar still includes it via
       `SETTINGS_TAB_CONFIGS` so the `/settings/projects` URL stays
       reachable for power users / Storybook. */
    tabIds: ['stats', 'billing', 'devices', 'agent-config', 'github'],
  },
  {
    id: 'misc',
    headingKey: 'settings.sections.misc',
    defaultHeading: 'Other',
    tabIds: ['about'],
  },
];

export function SettingsCategoryList({ workspaceName }: SettingsCategoryListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const setBugReportDialogOpen = useSetAtom(bugReportDialogOpenAtom);
  const canReportBug = useAppCapability('bugReport');
  const visibleTabs = useVisibleSettingsTabs();
  const resolvedWorkspaceName = workspaceName ?? workspaceSlug ?? null;
  const isNativeApp = isNativeAppShell();

  const tabsById = new Map<SettingsTabId, SettingsTabConfig>(
    visibleTabs.map((tab) => [tab.id, tab])
  );
  /* Any tab id that's defined in SETTINGS_TAB_CONFIGS but not assigned
     to a section above falls into the misc bucket so we never silently
     drop a settings page — except for tabs in
     `HIDDEN_FROM_MOBILE_LIST` which are intentionally omitted (their
     content lives elsewhere on mobile). */
  const usedTabIds = new Set<SettingsTabId>();
  for (const section of SETTINGS_SECTIONS) {
    for (const id of section.tabIds) usedTabIds.add(id);
  }
  const orphanIds = visibleTabs
    .map((tab) => tab.id)
    .filter((id) => !usedTabIds.has(id) && !HIDDEN_FROM_MOBILE_LIST.has(id));

  const openCategory = (category: SettingsTabConfig) => {
    if (!resolvedWorkspaceName) return;
    if (category.path === '/$workspaceName/settings/general') {
      void navigate({
        to: '/$workspaceName/settings/general',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/appearance') {
      void navigate({
        to: '/$workspaceName/settings/appearance',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/account') {
      void navigate({
        to: '/$workspaceName/settings/account',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/billing') {
      void navigate({
        to: '/$workspaceName/settings/billing',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/stats') {
      void navigate({
        to: '/$workspaceName/settings/stats',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/projects') {
      void navigate({
        to: '/$workspaceName/settings/projects',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/devices') {
      void navigate({
        to: '/$workspaceName/settings/devices',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/agent-config') {
      void navigate({
        to: '/$workspaceName/settings/agent-config',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/github') {
      void navigate({
        to: '/$workspaceName/settings/github',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/keyboard-shortcuts') {
      void navigate({
        to: '/$workspaceName/settings/keyboard-shortcuts',
        params: { workspaceName: resolvedWorkspaceName },
        search: (prev) => prev,
      });
      return;
    }
    void navigate({
      to: '/$workspaceName/settings/about',
      params: { workspaceName: resolvedWorkspaceName },
      search: (prev) => prev,
    });
  };

  if (!resolvedWorkspaceName) return null;

  return (
    <div className="flex min-h-full flex-col pb-6 pt-3">
      <div className="flex flex-col gap-5">
        {SETTINGS_SECTIONS.map((section) => {
          const ids = section.id === 'misc' ? [...section.tabIds, ...orphanIds] : section.tabIds;
          const sectionTabs = ids
            .map((id) => tabsById.get(id))
            .filter(
              (tab): tab is SettingsTabConfig =>
                tab != null && !(tab.id === 'billing' && isNativeApp)
            );
          if (sectionTabs.length === 0) return null;
          return (
            <section key={section.id} aria-label={t(section.headingKey, section.defaultHeading)}>
              <h2 className="px-5 pb-1.5 text-[0.82rem] font-semibold text-muted-foreground">
                {t(section.headingKey, section.defaultHeading)}
              </h2>
              <div className="mx-3 overflow-hidden rounded-2xl border border-border/40 bg-card">
                {sectionTabs.map((tab, index) => (
                  <SettingsCategoryRow
                    key={tab.id}
                    tab={tab}
                    label={t(tab.labelKey)}
                    description={t(tab.descriptionKey)}
                    hasDivider={index > 0}
                    onSelect={() => openCategory(tab)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {canReportBug && (
        <div className="mt-auto pt-5">
          <SettingsActionRow
            icon={Bug}
            label={t('bugReport.title', 'Report a bug')}
            description={t(
              'settings.bugReport.description',
              'Send a report with optional machine logs'
            )}
            onSelect={() => setBugReportDialogOpen(true)}
          />
        </div>
      )}
    </div>
  );
}

function SettingsCategoryRow({
  tab,
  label,
  description,
  hasDivider,
  onSelect,
}: {
  tab: SettingsTabConfig;
  label: string;
  description: string;
  hasDivider: boolean;
  onSelect: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block w-full text-left transition-colors active:bg-muted/40',
        hasDivider && 'border-t border-border/40'
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon plate matches the home screen's avatar treatment —
           rounded primary-tinted square + icon in the primary color
           so the settings rows feel like the same family as the home
           Chat / Projects rows. */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-[1.05rem] w-[1.05rem] text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.95rem] font-medium text-foreground">{label}</h3>
          <p className="mt-0.5 truncate text-[0.78rem] text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </div>
    </button>
  );
}

function SettingsActionRow({
  icon: Icon,
  label,
  description,
  onSelect,
}: {
  icon: typeof Bug;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <div className="mx-3 overflow-hidden rounded-2xl border border-border/40 bg-card">
      <button
        type="button"
        onClick={onSelect}
        className="block w-full text-left transition-colors active:bg-muted/40"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-[1.05rem] w-[1.05rem] text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[0.95rem] font-medium text-foreground">{label}</h3>
            <p className="mt-0.5 truncate text-[0.78rem] text-muted-foreground">{description}</p>
          </div>
        </div>
      </button>
    </div>
  );
}

export function SettingsCategoryGrid() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const visibleTabs = useVisibleSettingsTabs();
  const categories = visibleTabs.map((tab) => ({
    ...tab,
    label: t(tab.labelKey),
    description: t(tab.descriptionKey),
  }));

  const openCategory = (category: SettingsTabConfig) => {
    if (!workspaceSlug) {
      return;
    }

    if (category.path === '/$workspaceName/settings/general') {
      void navigate({
        to: '/$workspaceName/settings/general',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/appearance') {
      void navigate({
        to: '/$workspaceName/settings/appearance',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/account') {
      void navigate({
        to: '/$workspaceName/settings/account',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/billing') {
      void navigate({
        to: '/$workspaceName/settings/billing',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/stats') {
      void navigate({
        to: '/$workspaceName/settings/stats',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/projects') {
      void navigate({
        to: '/$workspaceName/settings/projects',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/agent-config') {
      void navigate({
        to: '/$workspaceName/settings/agent-config',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/github') {
      void navigate({
        to: '/$workspaceName/settings/github',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    if (category.path === '/$workspaceName/settings/keyboard-shortcuts') {
      void navigate({
        to: '/$workspaceName/settings/keyboard-shortcuts',
        params: { workspaceName: workspaceSlug },
        search: (prev) => prev,
      });
      return;
    }
    void navigate({
      to: '/$workspaceName/settings/about',
      params: { workspaceName: workspaceSlug },
      search: (prev) => prev,
    });
  };

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {workspaceSlug &&
          categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => openCategory(category)}
              className="block text-left"
            >
              <Card className="h-full hover:bg-hover transition-colors cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex flex-col gap-3">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <category.icon className="h-6 w-6 text-primary" />
                    </div>

                    <div>
                      <h3 className="font-semibold text-lg mb-1">{category.label}</h3>
                      <p className="text-sm text-muted-foreground">{category.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
      </div>
    </div>
  );
}
