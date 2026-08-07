import { useCallback, useState } from 'react';
import { Bug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import type { MachineId } from '@lody/shared';
import { bugReportDialogOpenAtom, settingsActiveTabAtom, settingsDialogOpenAtom } from '@/atoms';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { isNativeAppShell } from '@/lib/native-platform';
import { useAppCapability } from '@/lib/app-platform';
import { SettingsDataCacheProvider } from './settings-data-cache';
import { useVisibleSettingsTabs, type SettingsTabId } from './settings-tabs';
import { GeneralSettingsComponent } from './general-setting';
import { AppearanceSettingsComponent } from './appearance-setting';
import { AccountSettingsComponent } from './account-setting';
import { BillingSettingsComponent } from './billing-setting';
import { StatsSettingsComponent } from './stats-setting';
import { ProjectSettingsComponent } from './project-settings';
import { MachineAgentSettings } from './machine-agent-settings';
import { IntegrationsSettingsComponent } from './integrations-setting';
import { KeyboardShortcutsSetting } from './keyboard-shortcuts-setting';
import { AboutSettingsComponent } from './about-setting';

/**
 * Desktop-only settings overlay. Mounted once at the app level (like the bug-report
 * dialog) and shown whenever `settingsDialogOpenAtom` is set on a non-mobile viewport.
 * It renders the same per-tab setting components that the route-based settings page
 * uses, so behavior stays in sync; mobile keeps the full-page route instead.
 */
export function DesktopSettingsModal() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useAtom(settingsDialogOpenAtom);

  // Never mount the modal tree on mobile — that path uses the route-based page.
  if (isMobile) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DialogContent
        noAnimation
        className="flex h-[min(90vh,950px)] w-[84vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:p-0"
      >
        <SettingsModalBody />
      </DialogContent>
    </Dialog>
  );
}

function SettingsModalBody() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useAtom(settingsActiveTabAtom);
  const setBugReportDialogOpen = useSetAtom(bugReportDialogOpenAtom);
  const canReportBug = useAppCapability('bugReport');
  const platformTabs = useVisibleSettingsTabs();
  const visibleTabs = isNativeAppShell()
    ? platformTabs.filter((tab) => tab.id !== 'billing')
    : platformTabs;

  const handleReportBug = useCallback(() => {
    setBugReportDialogOpen(true);
  }, [setBugReportDialogOpen]);

  const activeTabConfig = visibleTabs.find((tab) => tab.id === activeTab) ?? visibleTabs[0];
  const resolvedActiveTab = activeTabConfig.id;
  // These tabs render their own in-content header (title + per-tab actions like
  // "add project"), so we drop the chrome title to avoid showing it twice.
  const selfTitledTab =
    resolvedActiveTab === 'projects' ||
    resolvedActiveTab === 'devices' ||
    resolvedActiveTab === 'agent-config';

  return (
    <SettingsDataCacheProvider>
      <DialogDescription className="sr-only">{t('settings.title')}</DialogDescription>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-56 flex-col border-r bg-background">
          <nav className="space-y-1 p-4">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                  resolvedActiveTab === tab.id
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-secondary-foreground'
                )}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
          {canReportBug && (
            <div className="mt-auto p-4">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-secondary-foreground"
                onClick={handleReportBug}
              >
                <Bug className="h-4 w-4" />
                {t('bugReport.title', 'Report a bug')}
              </button>
            </div>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selfTitledTab ? (
            <DialogTitle className="sr-only">{t(activeTabConfig.labelKey)}</DialogTitle>
          ) : (
            <header className="mt-2 flex h-12 shrink-0 items-center px-8">
              <DialogTitle className="text-xl font-semibold leading-none">
                {t(activeTabConfig.labelKey)}
              </DialogTitle>
            </header>
          )}
          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className={cn('px-6 pb-6', selfTitledTab ? 'pt-6' : 'pt-0')}>
                <div className="mx-auto max-w-5xl">
                  <SettingsTabContent tabId={resolvedActiveTab} />
                </div>
              </div>
            </ScrollArea>
          </div>
        </main>
      </div>
    </SettingsDataCacheProvider>
  );
}

function SettingsTabContent({ tabId }: { tabId: SettingsTabId }) {
  // agent-config tracks the selected machine in URL search on the route version;
  // in the modal it is purely local component state.
  const [selectedMachineId, setSelectedMachineId] = useState<MachineId | null>(null);

  switch (tabId) {
    case 'general':
      return <GeneralSettingsComponent />;
    case 'appearance':
      return <AppearanceSettingsComponent />;
    case 'account':
      return <AccountSettingsComponent />;
    case 'billing':
      return <BillingSettingsComponent />;
    case 'stats':
      return <StatsSettingsComponent />;
    case 'projects':
      return <ProjectSettingsComponent />;
    case 'agent-config':
      return (
        <MachineAgentSettings
          selectedMachineId={selectedMachineId}
          onSelectedMachineChange={setSelectedMachineId}
        />
      );
    case 'devices':
      return (
        <MachineAgentSettings
          mode="devices"
          selectedMachineId={selectedMachineId}
          onSelectedMachineChange={setSelectedMachineId}
        />
      );
    case 'github':
      return <IntegrationsSettingsComponent />;
    case 'keyboard-shortcuts':
      return <KeyboardShortcutsSetting />;
    case 'about':
      return <AboutSettingsComponent />;
  }

  const exhaustive: never = tabId;
  return exhaustive;
}
