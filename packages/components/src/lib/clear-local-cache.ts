/**
 * "Clear cache" support shared by web, mobile (Capacitor), and desktop (Electron).
 *
 * The Loro repo IndexedDB (`lody-loro-repo-db-<workspaceId>`) is held open by the
 * live workspace runtime, and IndexedDB `deleteDatabase()` blocks while a
 * connection is open. So instead of deleting in place from the settings page, we
 * persist a flag and reload: a full reload closes every IndexedDB connection,
 * then `maybeClearLodyCacheOnBoot()` runs from `RuntimeProvider` BEFORE the
 * runtime reopens the repo DB — at which point nothing holds a `lody*` database
 * open and the delete succeeds.
 */

import { workspaceInfoCache } from './local-storage-cache';
import { EAGER_SYNC_HIGH_WATER_DB_NAME } from './eager-sync-high-water-cache';

const CACHE_CLEAR_FLAG = 'lody:clearCacheOnBoot';

/** IndexedDB databases created with static names (not suffixed per workspace). */
const KNOWN_INDEXEDDB_NAMES = [
  EAGER_SYNC_HIGH_WATER_DB_NAME,
  'lody:repo-file-paths',
  'lody:repo-issues-prs',
  'lody:github-pr-cache',
  'lody:project-skills',
];

/**
 * Per-workspace IndexedDB names (`lody-loro-repo-db-<id>`,
 * `lody-loro-stream-cursors-<id>`) for every workspace the user has visited in
 * this browser, derived from the cached workspace-info map. A workspace only has
 * local databases here if it was opened here, so this covers "all workspaces" in
 * practice — and crucially on engines without `indexedDB.databases()` (Firefox),
 * where these names can't be discovered by enumeration.
 */
function knownWorkspaceDatabaseNames(): string[] {
  const names: string[] = [];
  try {
    for (const info of Object.values(workspaceInfoCache.readAll())) {
      if (info.workspaceId) {
        names.push(
          `lody-loro-repo-db-${info.workspaceId}`,
          `lody-loro-stream-cursors-${info.workspaceId}`
        );
      }
    }
  } catch {
    // Best-effort — fall back to enumeration + any explicit extraNames.
  }
  return names;
}

/** Bound how long boot waits on a single delete that another tab is blocking. */
const DELETE_TIMEOUT_MS = 3000;

function deleteDatabaseBestEffort(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // If another open connection (e.g. a second tab) blocks the delete, don't
    // hang boot forever — give up after a bounded wait and move on.
    const timer = setTimeout(done, DELETE_TIMEOUT_MS);
    try {
      const request = indexedDB.deleteDatabase(name);
      request.addEventListener('success', done);
      request.addEventListener('error', done);
      request.addEventListener('blocked', () => {
        console.warn(`[Lody] deleteDatabase blocked by an open connection: ${name}`);
      });
    } catch (error) {
      console.warn(`[Lody] deleteDatabase threw for ${name}`, error);
      done();
    }
  });
}

/**
 * Delete every `lody*` IndexedDB database and Cache Storage entry. Preserves
 * localStorage auth token, language, and preferences — this clears recoverable
 * local cache (Loro replica, stream cursors, mention/PR/skill/eager-sync caches,
 * image caches), not the user's session or settings.
 *
 * @param extraNames Additional IndexedDB names to delete unconditionally — e.g.
 *   the current workspace's databases, in case its info isn't cached yet. All
 *   visited workspaces are already covered via the cached workspace-info map.
 */
export async function clearAllLodyLocalCache(extraNames: string[] = []): Promise<void> {
  if (typeof indexedDB !== 'undefined') {
    const names = new Set<string>([
      ...KNOWN_INDEXEDDB_NAMES,
      ...knownWorkspaceDatabaseNames(),
      ...extraNames,
    ]);
    try {
      const databases = (await indexedDB.databases?.()) ?? [];
      for (const database of databases) {
        if (database.name && database.name.startsWith('lody')) {
          names.add(database.name);
        }
      }
    } catch {
      // `indexedDB.databases()` is unsupported (e.g. Firefox) — fall back to the
      // known static names plus any per-workspace names the caller passed.
    }
    await Promise.all([...names].map(deleteDatabaseBestEffort));
  }

  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('lody')).map((key) => caches.delete(key))
      );
    } catch (error) {
      console.warn('[Lody] failed to clear Cache Storage', error);
    }
  }
}

/** Mark that the cache should be cleared on the next boot, before reloading. */
export function markCacheClearPending(): void {
  try {
    localStorage.setItem(CACHE_CLEAR_FLAG, '1');
  } catch (error) {
    console.warn('[Lody] failed to set cache-clear flag', error);
  }
}

/**
 * If a cache clear was requested before the last reload, delete all `lody*`
 * local cache now and clear the flag. No-op (a single synchronous localStorage
 * read) on normal boots. Call this from `RuntimeProvider` before the workspace
 * runtime opens the repo IndexedDB.
 */
export async function maybeClearLodyCacheOnBoot(extraNames: string[] = []): Promise<void> {
  let pending = false;
  try {
    pending = localStorage.getItem(CACHE_CLEAR_FLAG) === '1';
  } catch {
    pending = false;
  }
  if (!pending) return;

  try {
    await clearAllLodyLocalCache(extraNames);
  } finally {
    try {
      localStorage.removeItem(CACHE_CLEAR_FLAG);
    } catch (error) {
      console.warn('[Lody] failed to clear cache-clear flag', error);
    }
  }
}

/**
 * Reload the app consistently across surfaces. Electron reloads through the main
 * process (preserves the window); web and mobile (Capacitor WebView) reload the
 * page directly. The current URL is preserved, so navigate to the destination
 * before calling this.
 */
export function reloadApp(): void {
  if (typeof window === 'undefined') return;
  if (window.__LODY_ELECTRON__ === true) {
    const api = window.api as
      | (typeof window.api & { requestRendererReload?: () => void })
      | undefined;
    const requestRendererReload = api?.requestRendererReload;
    if (typeof requestRendererReload === 'function') {
      requestRendererReload();
      return;
    }
  }
  window.location.reload();
}
