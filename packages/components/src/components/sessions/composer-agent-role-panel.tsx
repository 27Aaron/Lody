import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Ban,
  Brain,
  Check,
  Cpu,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  SquareChevronRight,
} from 'lucide-react';
import {
  classifyPermissionModeFace,
  getAgentRoleEmoji,
  type AgentRoleAvailability,
  type AgentRoleId,
  type MachineViewMeta,
} from '@lody/shared';

import { AgentIcon } from '@/components/icons/agent-icon';
import { useAcpSelectorOptions } from '@/hooks/use-acp-selector-options';
import { orderAcpConfigOptionSelectors } from '@/lib/acp-selector-order';
import {
  AGENT_ROLE_UNAVAILABLE_REASON_KEYS,
  type ComposerAgentRoleItem,
} from '@/lib/composer-agent-roles';
import { cn } from '@/lib/utils';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu';

/**
 * The Role submenu: the Roles bound to the machine this chat will start on, and
 * what the highlighted one actually runs.
 *
 * Two panes rather than one list because a Role's name is not its
 * configuration. The list is for recognising the Role you meant; the pane
 * beside it states the binding — agent, model, reasoning, permission,
 * instruction — because picking a Role authorizes exactly that and nothing
 * about the name says so.
 */
export function ComposerAgentRolePanel({
  items,
  machine,
  selectedRoleId,
  onSelect,
  onCreate,
  onEdit,
}: {
  items: readonly ComposerAgentRoleItem[];
  /**
   * The machine every listed Role is bound to, passed in rather than looked up:
   * the pane resolves each stored id against that agent's published
   * capabilities, and this component must stay renderable without the
   * workspace's machine-visibility context behind it.
   */
  machine?: MachineViewMeta | null;
  selectedRoleId: AgentRoleId | null;
  /** `null` clears the Role and leaves the configuration exactly as it stands. */
  onSelect: (roleId: AgentRoleId | null) => void;
  onCreate?: () => void;
  onEdit?: (roleId: AgentRoleId) => void;
}) {
  const { t } = useTranslation();
  const [previewRoleId, setPreviewRoleId] = useState<AgentRoleId | null>(null);
  const previewItem =
    items.find((item) => item.role.id === previewRoleId) ??
    items.find((item) => item.role.id === selectedRoleId) ??
    items[0];
  // The Role row turns into a create action instead of opening this submenu
  // when the machine has no Roles, so an empty list never reaches here.
  if (!previewItem) return null;

  return (
    <div className="flex">
      <div className="scrollbar-pro h-[17rem] w-[13.5rem] shrink-0 overflow-y-auto py-1 [scrollbar-gutter:stable]">
        {/* Leaving a Role is its own row rather than a second click on the
            selected one: it clears the NAME, not the configuration, and that is
            not the same gesture as picking. */}
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={selectedRoleId === null}
          onPointerEnter={() => setPreviewRoleId(null)}
          onSelect={() => onSelect(null)}
        >
          <Ban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t('chat.runConfig.roles.none', 'None')}</span>
          {selectedRoleId === null ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : null}
        </DropdownMenuItem>
        {items.map((item) => {
          const { role, availability } = item;
          return (
            /* The pointer handler rides a wrapper, not the item: a disabled row
               has `pointer-events-none`, and a Role you cannot pick is still a
               Role whose configuration you may want to read. */
            <div key={role.id} onPointerEnter={() => setPreviewRoleId(role.id)}>
              <DropdownMenuItem
                disabled={availability.kind === 'unavailable'}
                role="menuitemradio"
                aria-checked={role.id === selectedRoleId}
                className="items-start gap-2"
                onFocus={() => setPreviewRoleId(role.id)}
                onSelect={() => onSelect(role.id)}
              >
                <span className="flex h-4 shrink-0 items-center text-sm leading-none">
                  <span aria-hidden="true">{getAgentRoleEmoji(role)}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate leading-tight">{role.name}</span>
                  <RoleAvailabilityNote availability={availability} />
                </span>
                {role.id === selectedRoleId ? (
                  <span className="flex h-4 shrink-0 items-center">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                ) : null}
              </DropdownMenuItem>
            </div>
          );
        })}
        {onCreate ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreate}>
              <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {t('chat.runConfig.roles.create', 'New role')}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </div>
      <RoleDetailPane item={previewItem} machine={machine} onEdit={onEdit} />
    </div>
  );
}

/**
 * What the highlighted Role runs.
 *
 * Values are resolved against the bound agent's own capabilities, so a stored
 * id reads as the label the agent publishes for it ("Full access", not
 * `agent-full-access`). A raw id is the fallback for an agent whose
 * capabilities are not known here, never a blank.
 */
function RoleDetailPane({
  item,
  machine,
  onEdit,
}: {
  item: ComposerAgentRoleItem;
  machine?: MachineViewMeta | null;
  onEdit?: (roleId: AgentRoleId) => void;
}) {
  const { t } = useTranslation();
  const { role, agentConfig } = item;
  const selectorOptions = useAcpSelectorOptions(
    agentConfig
      ? {
          configId: role.agentConfigId,
          cliType: agentConfig.cliType,
          agentType: agentConfig.agentType,
          runtimeOverrides: agentConfig.runtimeOverrides,
          machine: machine ?? null,
        }
      : undefined
  );

  const { modelId, modeId, configOptionValues } = role.runConfig;
  const { permissionModeSelectors, thoughtLevelSelectors } = orderAcpConfigOptionSelectors(
    selectorOptions.configOptionSelectors
  );
  const labelFor = (
    options: ReadonlyArray<{ value: string; label: string; description?: string }>,
    value: string
  ) => options.find((option) => option.value === value);

  /* Only what the Role PINS. `resolveConfigOptionValue` would fall back to the
     agent's own current value, which would print a reasoning level or a
     permission this Role never chose — the exact silent substitution the whole
     feature exists to avoid. */
  const pinnedValue = (configId: string | undefined): string | null => {
    const value = configId ? configOptionValues?.[configId] : undefined;
    return typeof value === 'string' ? value : null;
  };

  /* Permission gets the agent's own wording for the value. Its description is
     deliberately NOT shown: the pane is a scan of what this Role pins, and a
     sentence about what one of them allows belongs to the Role editor. */
  const permissionSelector = permissionModeSelectors[0];
  const permissionValue = pinnedValue(permissionSelector?.configId) ?? modeId ?? null;
  const permissionOption = permissionValue
    ? labelFor(permissionSelector?.options ?? selectorOptions.modeOptions, permissionValue)
    : undefined;
  const permissionTone = classifyPermissionModeFace(permissionValue);
  const permissionIsWarning = permissionTone.kind !== 'hidden' && permissionTone.tone === 'warning';

  const thinkingSelector = thoughtLevelSelectors.find((selector) => selector.type === 'select');
  const thinkingValue = pinnedValue(thinkingSelector?.configId);

  /* Whatever the agent publishes beyond model / reasoning / permission, minus
     the ones already stated above so nothing is said twice. */
  const statedConfigIds = new Set(
    [
      permissionValue && permissionSelector ? permissionSelector.configId : undefined,
      thinkingValue ? thinkingSelector?.configId : undefined,
    ].filter(Boolean) as string[]
  );
  const extraOptions = Object.entries(configOptionValues ?? {}).filter(
    ([configId]) => !statedConfigIds.has(configId)
  );

  return (
    <div className="flex h-[17rem] w-[16rem] shrink-0 flex-col border-l border-border">
      <header className="flex shrink-0 items-start gap-2.5 px-4 pb-3 pt-3.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-base leading-none"
          aria-hidden="true"
        >
          {getAgentRoleEmoji(role)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold leading-tight text-foreground">
            {role.name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {agentConfig ? (
              <AgentIcon
                cliType={agentConfig.cliType}
                agentType={agentConfig.agentType}
                brandId={agentConfig.brandId}
                env={agentConfig.env}
                className="h-3 w-3 shrink-0"
              />
            ) : null}
            <span className="min-w-0 truncate">
              {agentConfig?.name ?? t('settings.agentRoles.unknownAgentConfig')}
            </span>
          </span>
        </span>
      </header>

      {/* Only the values scroll. The header says WHICH Role and the footer is
          how to change it — both stay put however long the instruction runs. */}
      <div className="scrollbar-pro min-h-0 flex-1 overflow-y-auto border-t border-border/60 [scrollbar-gutter:stable]">
        <dl className="flex flex-col gap-2 px-4 py-3">
          {modelId ? (
            <DetailRow
              icon={<Cpu className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('chat.runConfig.modelLabel', 'Model')}
              value={labelFor(selectorOptions.modelOptions, modelId)?.label ?? modelId}
              /* A model id is prefix-heavy and tail-distinctive
                 (`claude-opus-5` vs `claude-sonnet-5`), so the START is what
                 gives way when the line runs out. */
              elide="start"
            />
          ) : null}
          {thinkingValue ? (
            <DetailRow
              icon={<Brain className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('chat.runConfig.reasoningLabel', 'Reasoning')}
              value={
                labelFor(thinkingSelector?.options ?? [], thinkingValue)?.label ?? thinkingValue
              }
            />
          ) : null}
          {permissionValue ? (
            <DetailRow
              icon={
                permissionIsWarning ? (
                  <ShieldAlert className="h-3.5 w-3.5 text-status-warning" strokeWidth={1.8} />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                )
              }
              label={t('chat.runConfig.permissionLabel', 'Permission')}
              value={permissionOption?.label ?? permissionValue}
              tone={permissionIsWarning ? 'warning' : undefined}
            />
          ) : null}
          {extraOptions.map(([configId, value]) => (
            <DetailRow
              key={configId}
              icon={<Sliders className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={
                selectorOptions.configOptionSelectors.find(
                  (selector) => selector.configId === configId
                )?.label ?? configId
              }
              value={
                typeof value === 'boolean'
                  ? value
                    ? t('chat.runConfig.roles.optionOn', 'On')
                    : t('chat.runConfig.roles.optionOff', 'Off')
                  : value
              }
            />
          ))}
        </dl>

        {role.promptPrefix ? (
          <div className="border-t border-border/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
              <SquareChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              {t('chat.runConfig.roles.prompt', 'Instruction')}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
              {role.promptPrefix}
            </p>
          </div>
        ) : null}
      </div>

      {onEdit ? (
        <div className="shrink-0 border-t border-border/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onEdit(role.id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
          >
            {t('chat.runConfig.roles.edit', 'Edit role')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One pinned value: glyph, label, value — all on ONE line.
 *
 * `label ……… value` is the same row grammar as the Agent / Model / Reasoning
 * rows this submenu opened from, so the pane reads as a continuation of that
 * menu rather than a second vocabulary. The label sits at the glyph's own size
 * and weight: it is there to name the glyph, not to compete with the value,
 * which is the part being read. Pushing the value to the right edge aligns the
 * column without a fixed label width, which no single width could give across
 * locales. A value that outruns the line is elided rather than wrapped, so the
 * row count stays the pinned-value count.
 */
function DetailRow({
  icon,
  label,
  value,
  tone,
  elide = 'end',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'warning';
  /** Which end gives way when the value does not fit. */
  elide?: 'start' | 'end';
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center',
          tone === 'warning' ? 'text-status-warning' : 'text-muted-foreground/70'
        )}
      >
        {icon}
      </span>
      <dt className="shrink-0 text-[10.5px] leading-tight text-muted-foreground/70">{label}</dt>
      <dd
        className={cn(
          'ml-auto min-w-0 truncate text-[0.8rem] leading-tight',
          tone === 'warning' ? 'font-medium text-status-warning' : 'text-foreground'
        )}
        // The full value stays reachable when the line elides it.
        title={value}
      >
        {/* Reversing the direction moves the ellipsis to the start; the inner
            span restores reading order for the text itself. */}
        {elide === 'start' ? (
          <span className="block truncate text-left [direction:rtl]">
            <span dir="ltr">{value}</span>
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * Why this Role cannot be picked, on the row itself.
 *
 * On the row rather than in the detail pane because a disabled row is the one
 * thing a keyboard user cannot bring that pane up for, and a disabled row with
 * no reason reads as a bug. Every reason is shown, `machine_offline` included:
 * unlike the Settings list there is no machine heading above these rows to
 * carry that status.
 */
function RoleAvailabilityNote({ availability }: { availability: AgentRoleAvailability }) {
  const { t } = useTranslation();
  if (availability.kind === 'available') return null;
  if (availability.kind === 'unknown') {
    return (
      <span className="text-[10.5px] leading-snug text-muted-foreground/80">
        {t('settings.agentRoles.status.checking')}
      </span>
    );
  }
  return (
    <span className="text-[10.5px] leading-snug text-status-warning">
      {t(AGENT_ROLE_UNAVAILABLE_REASON_KEYS[availability.reason])}
    </span>
  );
}
