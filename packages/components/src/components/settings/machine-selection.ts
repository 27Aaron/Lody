import type { MachineId, MachineViewMeta } from '@lody/shared';
import type { MachineTabItem } from './machine-tab-list';

export type DesktopMachineSelection = {
  /** Machine the detail pane may render — always a member of the visible pool. */
  resolved: MachineViewMeta | undefined;
  /** Selection the caller should commit when it differs from the current one. */
  nextSelectedMachineId: MachineId | null;
};

/**
 * Desktop settings invariant: the selected detail must stay visible in the pool
 * the machine selector renders (Devices: filtered tabItems; Agents: allItems).
 * When the current selection is filtered out — synchronously (filter toggles)
 * or asynchronously (an Online-filtered machine goes offline) — fall back to
 * the local machine, then the first own machine, then the first visible one;
 * an empty pool clears the selection so the prompt shows instead of a hidden
 * machine's detail.
 */
export function resolveDesktopMachineSelection(args: {
  pool: readonly MachineTabItem[];
  selectedMachineId: MachineId | null;
  localMachineId: MachineId | null;
}): DesktopMachineSelection {
  const { pool, selectedMachineId, localMachineId } = args;
  const byId = (id: MachineId | null): MachineViewMeta | undefined =>
    id ? pool.find((item) => item.machine.id === id)?.machine : undefined;

  const current = byId(selectedMachineId);
  if (current) {
    return { resolved: current, nextSelectedMachineId: selectedMachineId };
  }
  const fallback =
    byId(localMachineId) ?? pool.find((item) => item.isOwn)?.machine ?? pool[0]?.machine;
  return { resolved: fallback, nextSelectedMachineId: fallback?.id ?? null };
}
