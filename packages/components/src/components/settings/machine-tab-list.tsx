import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ListFilter, Users } from 'lucide-react';
import { type MachineId, type MachineViewMeta } from '@lody/shared';
import type { MachineSettingsFilter } from '@/atoms/settings-machine-tab';
import type { MachineVisibilityAccess } from '@/hooks/use-visible-machine-metas';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type MachineTabListVariant = 'compact' | 'detailed';

export type MachineTabItem = {
  machine: MachineViewMeta;
  isOwn: boolean;
  isOnline: boolean;
  sharedWithTeam: boolean;
};

export type MachineTabListProps = {
  items: MachineTabItem[];
  selectedMachineId: MachineId | null;
  onSelect: (machineId: MachineId) => void;
  filter: MachineSettingsFilter;
  onFilterChange: (next: MachineSettingsFilter) => void;
  totalBeforeFilter: number;
  variant?: MachineTabListVariant;
};

export function MachineTabList({
  items,
  selectedMachineId,
  onSelect,
  filter,
  onFilterChange,
  totalBeforeFilter,
  variant = 'compact',
}: MachineTabListProps) {
  const { t } = useTranslation();
  const hiddenByFilter = Math.max(0, totalBeforeFilter - items.length);
  const isFilterActive = filter.onlineOnly || filter.mineOnly;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <p className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
          {t('workspace.machines.title', 'Machines')}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 shrink-0 border-0 shadow-none',
                isFilterActive && 'bg-hover text-foreground'
              )}
              aria-label={t('settings.agent.machineTabs.filter.label', 'Filter machines')}
            >
              <ListFilter className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="font-medium text-muted-foreground">
              {t('settings.agent.machineTabs.filter.label', 'Filter machines')}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <FilterItem
              label={t('settings.agent.machineTabs.filter.online', 'Online')}
              checked={filter.onlineOnly}
              onSelect={() => onFilterChange({ ...filter, onlineOnly: !filter.onlineOnly })}
            />
            <FilterItem
              label={t('settings.agent.machineTabs.filter.mine', 'My machines')}
              checked={filter.mineOnly}
              onSelect={() => onFilterChange({ ...filter, mineOnly: !filter.mineOnly })}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
        <ul className={cn('min-w-0', variant === 'detailed' ? 'space-y-2' : 'space-y-1')}>
          {items.map((item) =>
            variant === 'detailed' ? (
              <DetailedMachineTab
                key={item.machine.id}
                item={item}
                isSelected={item.machine.id === selectedMachineId}
                onSelect={() => onSelect(item.machine.id)}
              />
            ) : (
              <MachineTab
                key={item.machine.id}
                item={item}
                isSelected={item.machine.id === selectedMachineId}
                onSelect={() => onSelect(item.machine.id)}
              />
            )
          )}
        </ul>
        {items.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {totalBeforeFilter === 0
              ? t('workspace.machines.empty', 'No machines connected')
              : t('settings.agent.machineTabs.filter.noMatch', 'No machines match these filters.')}
            {hiddenByFilter > 0 && (
              <div className="mt-2">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs"
                  onClick={() => onFilterChange({ onlineOnly: false, mineOnly: false })}
                >
                  {t('settings.agent.machineTabs.filter.reset', 'Clear filter')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MachineTab({
  item,
  isSelected,
  onSelect,
}: {
  item: MachineTabItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={cn(
          'group flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors',
          isSelected
            ? 'border-border bg-hover/70 font-medium text-foreground'
            : 'text-foreground/90 hover:bg-hover/40'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full ring-4',
            item.isOnline
              ? 'bg-status-success ring-status-success/20'
              : 'bg-muted-foreground/50 ring-muted'
          )}
          title={
            item.isOnline
              ? t('workspace.machines.online', 'Online')
              : t('workspace.machines.offline', 'Offline')
          }
        />
        <span className="min-w-0 flex-1 truncate">{item.machine.name || item.machine.id}</span>
        {item.sharedWithTeam ? (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Users className="h-3 w-3" aria-hidden />
            {t('workspace.machines.shared', 'Shared')}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-muted-foreground/60">
            {t('workspace.machines.private', 'Private')}
          </span>
        )}
      </button>
    </li>
  );
}

function DetailedMachineTab({
  item,
  isSelected,
  onSelect,
}: {
  item: MachineTabItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const onlineText = item.isOnline
    ? t('workspace.machines.online', 'Online')
    : t('workspace.machines.offline', 'Offline');
  const version = item.machine.cliVersion ? `v${item.machine.cliVersion}` : null;
  const os = item.machine.os || null;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={cn(
          'group flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-3 text-left transition-colors',
          isSelected ? 'ring-2 ring-ring/60' : 'hover:bg-hover/30'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-1 h-2 w-2 shrink-0 rounded-full ring-4',
            item.isOnline
              ? 'bg-status-success ring-status-success/20'
              : 'bg-muted-foreground/50 ring-muted'
          )}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">
              {item.machine.name || item.machine.id}
            </span>
            {item.sharedWithTeam && (
              <Users
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label={t('workspace.machines.sharedWithTeamLabel', 'Shared with team')}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'font-medium',
                item.isOnline ? 'text-status-success' : 'text-muted-foreground'
              )}
            >
              {onlineText}
            </span>
            {os && (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">{os}</span>
              </>
            )}
            {version && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{version}</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </button>
    </li>
  );
}

function FilterItem({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <span className="min-w-0 truncate">{label}</span>
    </DropdownMenuCheckboxItem>
  );
}

export function buildMachineTabItems(params: {
  machines: Map<MachineId, MachineViewMeta>;
  accessByMachineId: Map<MachineId, MachineVisibilityAccess>;
  onlineMachineIds: ReadonlySet<MachineId>;
  isOwnMachine: (machine: MachineViewMeta) => boolean;
  filter: MachineSettingsFilter;
}): { items: MachineTabItem[]; totalBeforeFilter: number } {
  const { machines, accessByMachineId, onlineMachineIds, isOwnMachine, filter } = params;
  const all: MachineTabItem[] = [];
  for (const machine of machines.values()) {
    const isOwn = isOwnMachine(machine);
    const isOnline = onlineMachineIds.has(machine.id);
    const sharedWithTeam = accessByMachineId.get(machine.id)?.sharedWithTeam ?? false;
    all.push({ machine, isOwn, isOnline, sharedWithTeam });
  }

  const filtered = all.filter((item) => {
    if (filter.onlineOnly && !item.isOnline) return false;
    if (filter.mineOnly && !item.isOwn) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return a.machine.name.localeCompare(b.machine.name);
  });

  return { items: filtered, totalBeforeFilter: all.length };
}

export function useMachineTabItems(params: {
  machines: Map<MachineId, MachineViewMeta>;
  accessByMachineId: Map<MachineId, MachineVisibilityAccess>;
  onlineMachineIds: ReadonlySet<MachineId>;
  isOwnMachine: (machine: MachineViewMeta) => boolean;
  filter: MachineSettingsFilter;
}) {
  return useMemo(() => buildMachineTabItems(params), [params]);
}
