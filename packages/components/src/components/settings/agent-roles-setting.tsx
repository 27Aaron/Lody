import { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Loader2, Plus, Trash2, UserRoundCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  canManageAgentRole,
  getAgentRoleEmoji,
  getServerNow,
  type AgentConfigMeta,
  type AgentRole,
  type AgentRoleAvailability,
  type AgentRoleId,
  type MachineId,
} from '@lody/shared';
import { userAtom } from '@/atoms';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { onlineMachineIdsAtom } from '@/atoms/presence';
import { useAcpSelectorOptions } from '@/hooks/use-acp-selector-options';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import {
  useAgentRoleAvailability,
  useWorkspaceAgentRoleActions,
  useWorkspaceAgentRoles,
} from '@/hooks/use-workspace-agent-roles';
import { AgentIcon } from '@/components/icons/agent-icon';
import {
  applyAgentRoleRunConfigDefaults,
  buildAgentRoleFormValue,
  buildAgentRoleFromForm,
  buildAgentRoleRunConfig,
  buildAgentRoleRunConfigSummary,
  EMPTY_AGENT_ROLE_FORM_VALUE,
  findAgentRoleRunConfigIssues,
  validateAgentRoleForm,
  type AgentRoleFormValue,
} from '@/lib/agent-role-form';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { settingContainerClass } from '.';
import { AgentRoleForm } from './agent-role-form';

/**
 * A `create` carries its id from the moment the form opens.
 *
 * The id is what the name check must ignore, and a `create` becomes a catalog
 * row the instant its local write lands — while the dialog is still open. An id
 * allocated at save time would leave a window where the form finds the row it
 * just wrote and reports its own name as taken.
 */
type EditorState =
  | { mode: 'add'; roleId: AgentRoleId; value: AgentRoleFormValue }
  | { mode: 'edit'; role: AgentRole; value: AgentRoleFormValue };

/**
 * Settings → Agent Roles.
 *
 * Deliberately its own page beside Agents rather than a tab inside the provider
 * dialog: a provider says how an agent starts, a Role says how one is used, and
 * merging the two surfaces is what makes people expect a Role to carry
 * credentials.
 */
export function AgentRolesSetting() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const onlineMachineIds = useAtomValue(onlineMachineIdsAtom);
  const agentConfigs = useAtomValue(getAllAgentConfigAtom);
  const { machines } = useVisibleMachineMetas();
  const { roles, synced } = useWorkspaceAgentRoles();
  const { resolve } = useAgentRoleAvailability(roles);
  const { upsert, remove } = useWorkspaceAgentRoleActions();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingRemoval, setPendingRemoval] = useState<AgentRole | null>(null);
  const [removing, setRemoving] = useState(false);

  const machineOptions = useMemo(
    () =>
      [...machines.values()]
        .map((machine) => ({
          machineId: machine.id,
          label: machine.name || machine.id,
          online: onlineMachineIds.has(machine.id),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [machines, onlineMachineIds]
  );

  // One group per machine the accessible Roles actually point at, ordered by
  // label so the list does not reshuffle when a machine goes offline.
  const roleGroups = useMemo(() => {
    const byMachine = new Map<MachineId, AgentRole[]>();
    for (const role of roles) {
      const existing = byMachine.get(role.machineId);
      if (existing) existing.push(role);
      else byMachine.set(role.machineId, [role]);
    }
    return [...byMachine.entries()]
      .map(([machineId, machineRoles]) => ({
        machineId,
        machineLabel: machines.get(machineId)?.name ?? t('settings.agentRoles.unknownMachine'),
        roles: machineRoles,
      }))
      .sort((left, right) => left.machineLabel.localeCompare(right.machineLabel));
  }, [machines, roles, t]);

  const selectedMachineId = editor?.value.machineId ?? null;
  const machineAgentConfigs = useMemo(
    () => agentConfigs.filter((config) => config.machineId === selectedMachineId),
    [agentConfigs, selectedMachineId]
  );
  const selectedAgentConfig = useMemo(
    () => machineAgentConfigs.find((config) => config.id === editor?.value.agentConfigId),
    [editor?.value.agentConfigId, machineAgentConfigs]
  );
  const selectorOptions = useAcpSelectorOptions(
    selectedAgentConfig
      ? {
          configId: selectedAgentConfig.id,
          cliType: selectedAgentConfig.cliType,
          agentType: selectedAgentConfig.agentType,
          runtimeOverrides: selectedAgentConfig.runtimeOverrides,
          machine: selectedMachineId ? (machines.get(selectedMachineId) ?? null) : null,
        }
      : undefined
  );

  // A Role pins concrete values, so as soon as an agent config's capabilities
  // are known its own defaults fill the unset fields. The user then adjusts a
  // real selection instead of accepting an "Agent default" that says nothing
  // about what would run. A stored value is never overwritten — that is what
  // keeps an incompatible one visible. Derived rather than written back: the
  // defaults are a function of the value and the capabilities, and the helper
  // returns the value itself when it changes nothing.
  const editorValue = editor
    ? selectedAgentConfig
      ? applyAgentRoleRunConfigDefaults(editor.value, selectorOptions)
      : editor.value
    : null;

  const formErrors = useMemo(
    () =>
      editorValue
        ? validateAgentRoleForm(editorValue, {
            accessibleRoles: roles,
            editingRoleId: editor ? (editor.mode === 'edit' ? editor.role.id : editor.roleId) : null,
          })
        : [],
    [editor, editorValue, roles]
  );
  const runConfigIssues = useMemo(
    () =>
      editorValue && selectedAgentConfig
        ? findAgentRoleRunConfigIssues(buildAgentRoleRunConfig(editorValue), selectorOptions)
        : [],
    [editorValue, selectedAgentConfig, selectorOptions]
  );

  const openAdd = () => {
    setError(undefined);
    setEditor({
      mode: 'add',
      roleId: crypto.randomUUID() as AgentRoleId,
      value: { ...EMPTY_AGENT_ROLE_FORM_VALUE },
    });
  };
  const openEdit = (role: AgentRole) => {
    setError(undefined);
    setEditor({ mode: 'edit', role, value: buildAgentRoleFormValue(role) });
  };

  const save = async () => {
    if (!editor || !editorValue || formErrors.length > 0 || !currentUserId) return;
    const role = buildAgentRoleFromForm(editorValue, {
      existing: editor.mode === 'edit' ? editor.role : undefined,
      ownerUserId: currentUserId,
      now: getServerNow(),
      createId: () => (editor.mode === 'add' ? editor.roleId : editor.role.id),
    });

    setSubmitting(true);
    setError(undefined);
    try {
      // Resolves on durability: the row exists, so the editor is done. The
      // upload runs on its own and is deliberately not reported — a deferred
      // upload is not a failed save and there is nothing to act on.
      await upsert(role);
      setEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await remove(pendingRemoval.id);
    } catch (cause) {
      console.error('Failed to delete agent role', cause);
    } finally {
      setRemoving(false);
      setPendingRemoval(null);
    }
  };

  const addLabel = t('settings.agentRoles.add');

  return (
    <div className={settingContainerClass}>
      <p className="text-xs leading-snug text-muted-foreground">
        {t('settings.agentRoles.description')}
      </p>

      <section className="flex flex-col">
        <div className="flex items-center justify-between gap-2 pb-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              {t('settings.agentRoles.catalogTitle')}
            </h3>
            {roles.length > 0 ? (
              <span className="text-xs tabular-nums text-muted-foreground/70">{roles.length}</span>
            ) : null}
            {!synced ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t('settings.agentRoles.syncing')}
              </span>
            ) : null}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                aria-label={addLabel}
                onClick={openAdd}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{addLabel}</TooltipContent>
          </Tooltip>
        </div>

        {roles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 px-6 py-8 text-center text-sm">
            <UserRoundCog className="h-6 w-6 text-muted-foreground/70" aria-hidden="true" />
            <p className="mt-2 text-muted-foreground">{t('settings.agentRoles.empty')}</p>
            <Button size="sm" className="mt-3" onClick={openAdd}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {addLabel}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {roleGroups.map((group) => (
              <div key={group.machineId} className="space-y-1.5">
                {/* The machine leads its group instead of repeating on every row:
                    a Role binds one machine exactly, so it is what the list is
                    grouped BY, not a fact about each entry. */}
                <MachineGroupPill
                  label={group.machineLabel}
                  online={onlineMachineIds.has(group.machineId)}
                />
                <div className="space-y-2">
                  {group.roles.map((role) => (
                    <AgentRoleRow
                      key={role.id}
                      role={role}
                      availability={resolve(role)}
                      agentConfig={agentConfigs.find((entry) => entry.id === role.agentConfigId)}
                      canManage={canManageAgentRole(role, currentUserId)}
                      onEdit={() => openEdit(role)}
                      onRemove={() => setPendingRemoval(role)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (open) return;
          setError(undefined);
          setEditor(null);
        }}
      >
        <DialogContent
          overlayClassName={
            // Desktop settings is itself a dialog; match its z-index so this
            // later overlay covers it without stacking a second /80 veil.
            isMobile ? undefined : 'z-[var(--z-dialog)] bg-black/20'
          }
          className={cn(
            'flex max-h-[min(680px,88dvh)] w-[min(620px,96dvw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:p-0',
            !isMobile && 'shadow-popover'
          )}
        >
          <header className="shrink-0 border-b border-border/60 px-5 py-3 pr-12">
            <DialogTitle className="text-sm font-semibold">
              {editor?.mode === 'edit'
                ? t('settings.agentRoles.editTitle')
                : t('settings.agentRoles.addTitle')}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {t('settings.agentRoles.dialogDescription')}
            </DialogDescription>
          </header>
          {editor && editorValue ? (
            <AgentRoleForm
              className="min-h-0 flex-1"
              value={editorValue}
              onChange={(value) => setEditor({ ...editor, value })}
              machines={machineOptions}
              agentConfigs={machineAgentConfigs.map((config) => ({
                agentConfigId: config.id,
                label: config.name,
              }))}
              selectorOptions={selectedAgentConfig ? selectorOptions : null}
              issues={runConfigIssues}
              errors={formErrors}
              submitting={submitting}
              error={error}
              isEditing={editor.mode === 'edit'}
              onSubmit={() => void save()}
              onCancel={() => {
                setError(undefined);
                setEditor(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.agentRoles.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.agentRoles.confirmRemove', { name: pendingRemoval?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmRemoval();
              }}
            >
              {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * One catalog row.
 *
 * States the whole binding — machine, provider, model, reasoning — because that
 * is what a Role IS, and says exactly why it cannot run when it cannot. A row
 * whose target is gone stays listed and editable; it never quietly re-points at
 * something that happens to be available.
 */
export function AgentRoleRow({
  role,
  availability,
  agentConfig,
  canManage,
  onEdit,
  onRemove,
}: {
  role: AgentRole;
  availability: AgentRoleAvailability;
  /** The bound config, when it still exists; its icon stands for the agent. */
  agentConfig?: Pick<AgentConfigMeta, 'cliType' | 'agentType' | 'brandId' | 'env' | 'name'>;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const runConfig = buildAgentRoleRunConfigSummary(role.runConfig);

  return (
    <div className="overflow-hidden rounded-lg bg-foreground/[0.04]">
      <div className="flex w-full min-w-0 items-center transition-colors hover:bg-hover/40">
        <button
          type="button"
          onClick={onEdit}
          aria-label={canManage ? t('common.edit') : t('common.view')}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05] text-sm leading-none">
            <span aria-hidden="true">{getAgentRoleEmoji(role)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              {/* No `@token` here: it is derived from this very name, so printing
                  both says one thing twice. */}
              <span className="min-w-0 truncate text-sm font-medium leading-tight">
                {role.name}
              </span>
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                {role.visibility === 'workspace'
                  ? t('settings.agentRoles.visibility.workspace')
                  : t('settings.agentRoles.visibility.private')}
              </Badge>
              {role.promptPrefix ? (
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                  {t('settings.agentRoles.hasPrompt')}
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
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
                {runConfig.length > 0
                  ? runConfig.join(' · ')
                  : (agentConfig?.name ?? t('settings.agentRoles.unknownAgentConfig'))}
              </span>
            </span>
            <AgentRoleAvailabilityText availability={availability} />
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1 py-2 pl-2 pr-2">
          {canManage ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('common.remove')}
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The machine heading above a group of Roles: the pill grammar of the other
 *  settings surfaces, as a label rather than a selector. */
function MachineGroupPill({ label, online }: { label: string; online: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          online ? 'bg-status-success' : 'bg-muted-foreground/40'
        )}
      />
      <span className="min-w-0 truncate">{label}</span>
      {/* The dot is the whole signal now that rows no longer repeat "its machine
          is offline", so it needs a text equivalent for anyone not seeing it. */}
      {online ? null : <span className="sr-only">{t('settings.agentRoles.status.offline')}</span>}
    </div>
  );
}

/**
 * Why a Role cannot run, when the list does not already say so.
 *
 * `machine_offline` says nothing new: the Role sits under its machine's pill,
 * which carries that machine's status — repeating it on every row in the group
 * is the same sentence N times. The reasons that stay are the ones the pill
 * cannot show, because they are about this Role's binding rather than the
 * machine's state.
 */
function AgentRoleAvailabilityText({ availability }: { availability: AgentRoleAvailability }) {
  const { t } = useTranslation();
  if (availability.kind === 'available') return null;
  if (availability.kind === 'unknown') {
    return (
      <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground/80">
        {t('settings.agentRoles.status.checking')}
      </span>
    );
  }
  if (availability.reason === 'machine_offline') return null;
  const reason = {
    machine_unknown: t('settings.agentRoles.unavailable.machineUnknown'),
    agent_config_missing: t('settings.agentRoles.unavailable.agentConfigMissing'),
    agent_config_machine_mismatch: t('settings.agentRoles.unavailable.agentConfigMismatch'),
  }[availability.reason];
  return (
    <span className="mt-0.5 block truncate text-[11px] leading-tight text-status-warning">
      {t('settings.agentRoles.unavailable.label', { reason })}
    </span>
  );
}
