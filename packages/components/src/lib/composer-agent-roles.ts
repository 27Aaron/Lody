import type {
  AgentConfigMeta,
  AgentRole,
  AgentRoleAvailability,
  AgentRoleId,
  MachineId,
} from '@lody/shared';
import type { AcpConfigOptionValue } from '@/components/shared/acp-selector-options';
import type { AgentSelection } from '@/components/shared/agent-selector';

/**
 * Agent Roles as the composer's run-config menu uses them.
 *
 * A Role is one packaged answer to "which agent, which model, which run
 * options" — the same knobs the menu's detail tab exposes one at a time. That
 * is the whole relationship between the two tabs, and it is why the rules here
 * are about identity rather than repair: picking a Role must set exactly what
 * the Role says, and the composer must stop naming the Role the moment the
 * running configuration is no longer the Role's.
 */

export type ComposerAgentRoleItem = {
  role: AgentRole;
  availability: AgentRoleAvailability;
  /**
   * The bound config while it still exists; its absence is itself the reason.
   * Carries what the detail pane needs to resolve that agent's capabilities, so
   * a stored id can be shown as the label the agent publishes for it.
   */
  agentConfig?: Pick<
    AgentConfigMeta,
    'name' | 'cliType' | 'agentType' | 'brandId' | 'env' | 'runtimeOverrides'
  >;
};

/**
 * The Roles the composer offers for the machine the chat will start on.
 *
 * Scoped to that one machine because the composer has already decided it, and
 * `machineId + agentConfigId` bind a Role exactly: offering a Role from another
 * machine could only either move the chat off the selected machine or fall back
 * to a different config, and a Role never falls back.
 *
 * Unavailable Roles stay listed. Seeing that a Role exists and why it cannot run
 * is what lets someone fix it; dropping the row makes a broken Role look
 * deleted.
 */
export function buildComposerAgentRoleItems({
  roles,
  machineId,
  agentConfigs,
  resolveAvailability,
}: {
  roles: readonly AgentRole[];
  machineId: MachineId | null | undefined;
  agentConfigs: readonly AgentConfigMeta[];
  resolveAvailability: (role: AgentRole) => AgentRoleAvailability;
}): ComposerAgentRoleItem[] {
  if (!machineId) return [];
  const configById = new Map(agentConfigs.map((config) => [config.id, config]));
  return roles
    .filter((role) => role.machineId === machineId)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map((role) => ({
      role,
      availability: resolveAvailability(role),
      agentConfig: configById.get(role.agentConfigId),
    }));
}

/**
 * Whether this Role pins the permission mode.
 *
 * Permission IS part of a Role — the Role editor writes it as `runConfig.modeId`
 * for legacy ACP modes, or as the agent's own `_permission` option — so while a
 * Role is what will run, permission is not a separate thing left to choose.
 * Asked rather than assumed, because an agent that publishes no permission
 * control leaves a Role with nothing to pin, and hiding the composer's
 * permission button then would take away a knob the Role never owned.
 */
export function doesAgentRolePinPermissionMode(
  role: AgentRole,
  source: { kind: 'configOption'; configId: string } | { kind: 'modeId' } | null
): boolean {
  if (!source) return false;
  return source.kind === 'modeId'
    ? Boolean(role.runConfig.modeId)
    : role.runConfig.configOptionValues?.[source.configId] !== undefined;
}

/**
 * What to do about a Role the composer just asked to select but has not seen
 * yet — the one it created a moment ago.
 *
 * A create resolves on the DURABLE local write, while the catalog snapshot the
 * composer reads from arrives on its own tick, so "not in the list" right after
 * saving means "not yet". It can also mean "not here at all": the editor lets a
 * Role be bound to any machine, and the composer must not follow one onto a
 * machine it is not starting this chat on. So the three answers are wait,
 * select, and give up — never "select something else".
 */
export type PendingAgentRoleSelection = 'wait' | 'select' | 'give-up';

export function resolvePendingAgentRoleSelection({
  roleId,
  items,
  isInCatalog,
}: {
  roleId: AgentRoleId;
  /** The Roles the composer offers, i.e. those bound to its own machine. */
  items: readonly ComposerAgentRoleItem[];
  /** Whether the catalog knows this Role at all, on any machine. */
  isInCatalog: boolean;
}): PendingAgentRoleSelection {
  const item = items.find((entry) => entry.role.id === roleId);
  if (!item) {
    // Known to the catalog but not offered here: it is bound elsewhere, and
    // following it would move the chat off the selected machine.
    return isInCatalog ? 'give-up' : 'wait';
  }
  if (item.availability.kind === 'unknown') return 'wait';
  return item.availability.kind === 'available' ? 'select' : 'give-up';
}

export type ComposerRunConfigSelection = {
  agentSelection: AgentSelection | null;
  modeId: string | null;
  modelId: string | null;
  configOptionValues: Record<string, AcpConfigOptionValue | undefined>;
};

/**
 * Whether the composer is currently configured as this Role says.
 *
 * The composer names a Role only while this holds, which is what keeps the
 * footer from claiming a Role that is not what will run. Three things end it,
 * and all three are cases where the Role's own promise was already broken:
 * the user moved a knob, the agent changed, or the agent no longer supports a
 * value the Role pins so the selection state fell back to the agent's own.
 *
 * Only the values the Role PINS are compared. A Role deliberately leaves the
 * rest on the agent's default, so an unpinned option is not a difference.
 */
export function isComposerAgentRoleApplied(
  role: AgentRole,
  selection: ComposerRunConfigSelection
): boolean {
  const { agentSelection } = selection;
  if (!agentSelection) return false;
  if (agentSelection.agentId !== role.agentConfigId) return false;
  if (agentSelection.machineId !== role.machineId) return false;

  const { modeId, modelId, configOptionValues } = role.runConfig;
  if (modeId && selection.modeId !== modeId) return false;
  if (modelId && selection.modelId !== modelId) return false;
  for (const [configId, value] of Object.entries(configOptionValues ?? {})) {
    if (selection.configOptionValues[configId] !== value) return false;
  }
  return true;
}
