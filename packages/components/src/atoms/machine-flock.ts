import { atom } from 'jotai';
import {
  applyMachineFlockRowEvents,
  type MachineFlockEvent,
  type MachineFlockRowMap,
  type MachineId,
  type WorkspaceId,
} from '@lody/shared';

type MachineFlockRowsByWorkspace = Record<string, Record<string, MachineFlockRowMap>>;

const EMPTY_MACHINE_FLOCK_ROWS = Object.freeze({}) as MachineFlockRowMap;

export const machineFlockRowsByWorkspaceAtom = atom<MachineFlockRowsByWorkspace>({});

function machineFlockRowsEmpty(rows: MachineFlockRowMap): boolean {
  return Object.keys(rows).length === 0;
}

function machineFlockRowsEqual(
  left: MachineFlockRowMap | undefined,
  right: MachineFlockRowMap
): boolean {
  if (!left) return false;
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

export const setMachineFlockRowsForMachineAtom = atom(
  null,
  (
    _get,
    set,
    update: {
      workspaceId: WorkspaceId | string;
      machineId: MachineId | string;
      rows: MachineFlockRowMap;
      mode?: 'replace' | 'merge';
      preserveExistingOnEmpty?: boolean;
    }
  ) => {
    set(machineFlockRowsByWorkspaceAtom, (previous) => {
      const workspaceKey = String(update.workspaceId);
      const machineKey = String(update.machineId);
      const workspaceRows = previous[workspaceKey] ?? {};
      const currentRows = workspaceRows[machineKey];
      const nextRows =
        update.mode === 'merge' && currentRows ? { ...currentRows, ...update.rows } : update.rows;
      if (
        update.preserveExistingOnEmpty &&
        machineFlockRowsEmpty(update.rows) &&
        currentRows &&
        !machineFlockRowsEmpty(currentRows)
      ) {
        return previous;
      }
      if (machineFlockRowsEqual(currentRows, nextRows)) {
        return previous;
      }
      return {
        ...previous,
        [workspaceKey]: {
          ...workspaceRows,
          [machineKey]: nextRows,
        },
      };
    });
  }
);

export const applyMachineFlockRowEventsForMachineAtom = atom(
  null,
  (
    get,
    set,
    update: {
      workspaceId: WorkspaceId | string;
      machineId: MachineId | string;
      events: readonly MachineFlockEvent[];
    }
  ) => {
    const workspaceKey = String(update.workspaceId);
    const machineKey = String(update.machineId);
    const workspaceRows = get(machineFlockRowsByWorkspaceAtom)[workspaceKey] ?? {};
    const currentRows = workspaceRows[machineKey] ?? EMPTY_MACHINE_FLOCK_ROWS;
    const nextRows = applyMachineFlockRowEvents(currentRows, update.events);
    set(setMachineFlockRowsForMachineAtom, {
      workspaceId: workspaceKey,
      machineId: machineKey,
      rows: nextRows,
    });
  }
);
