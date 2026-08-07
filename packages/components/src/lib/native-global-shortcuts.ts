import type {
  GlobalShortcutBinding,
  GlobalShortcutId,
  SetGlobalShortcutResult,
} from '@lody/shared';

/**
 * Renderer-side bridge to the Electron main process's global-shortcut registry
 * (`window.api.globalShortcuts`). Null-safe: on web / mobile / an older preload the
 * bridge is absent, so reads return `[]` and writes report a benign failure — callers
 * gate the whole feature behind `getRuntime() === 'electron'` anyway.
 */
export async function getGlobalShortcuts(): Promise<GlobalShortcutBinding[]> {
  if (typeof window === 'undefined') return [];
  const api = window.api?.globalShortcuts;
  if (!api) return [];
  try {
    return await api.getAll();
  } catch (error) {
    console.error('Failed to read global shortcuts', error);
    return [];
  }
}

/**
 * Suspend / resume OS global shortcuts while the renderer records a binding, so the combo
 * reaches the renderer (to be flagged as occupied) instead of firing the global action.
 * Null-safe no-op off Electron / on an older preload.
 */
export function setGlobalShortcutsSuspended(suspended: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.api?.globalShortcuts?.setSuspended?.(suspended);
  } catch (error) {
    console.error('Failed to suspend global shortcuts', error);
  }
}

export async function setGlobalShortcut(
  id: GlobalShortcutId,
  binding: string | null
): Promise<SetGlobalShortcutResult> {
  if (typeof window === 'undefined') return { ok: false, error: 'invalid' };
  const api = window.api?.globalShortcuts;
  if (!api) return { ok: false, error: 'invalid' };
  try {
    return await api.set({ id, binding });
  } catch (error) {
    console.error('Failed to set global shortcut', error);
    return { ok: false, error: 'invalid' };
  }
}
