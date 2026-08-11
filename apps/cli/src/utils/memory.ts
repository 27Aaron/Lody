import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import os from 'os';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MEMORY_PROBE_TIMEOUT_MS = 1_000;

export interface WindowsMemoryStatus {
  availableBytes: number;
  commitLimitBytes: number;
  committedBytes: number;
  availableCommitBytes: number;
}

/**
 * macOS kernel memory pressure level (`kern.memorystatus_vm_pressure_level`),
 * mapped 1:1 onto `dispatch_source_memorypressure_flags_t`.
 *
 * XNU derives this from a single ratio: pages occupied by the compressor versus
 * `active + inactive + free + speculative`. It enters WARNING once the compressor
 * holds more physical memory than all of those queues combined, and CRITICAL at
 * roughly 1.9x that. Free-memory byte counts do not enter the decision at all,
 * which is exactly why they are a poor admission signal on this platform.
 */
export type DarwinMemoryPressureLevel = 1 | 2 | 4;

export const DARWIN_PRESSURE_NORMAL = 1 satisfies DarwinMemoryPressureLevel;
export const DARWIN_PRESSURE_WARNING = 2 satisfies DarwinMemoryPressureLevel;
export const DARWIN_PRESSURE_CRITICAL = 4 satisfies DarwinMemoryPressureLevel;

export interface MemoryPressureSnapshot {
  availableMemoryBytes: number;
  effectiveMemoryLimitBytes: number;
  /** macOS only; absent when the probe is unavailable or returned an unknown value. */
  memoryPressureLevel?: DarwinMemoryPressureLevel;
  availableCommitBytes?: number;
  commitLimitBytes?: number;
  committedBytes?: number;
}

/**
 * Get the available system memory in bytes, cgroup-aware.
 *
 * On Linux under cgroup v2, the effective available memory is the minimum of:
 * - System-wide `MemAvailable` from `/proc/meminfo`
 * - The cgroup's remaining budget: `memory.max - memory.current`
 *
 * This prevents over-allocating when a parent cgroup (e.g. `user.slice`) imposes
 * a limit lower than total system memory.
 *
 * On other platforms, falls back to `os.freemem()`.
 */
export function getAvailableMemoryBytes(): number {
  const systemAvailable = getSystemAvailableMemoryBytesSync();
  const cgroupAvailable = getCgroupAvailableMemoryBytes();
  if (cgroupAvailable !== null) {
    return Math.min(systemAvailable, cgroupAvailable);
  }
  return systemAvailable;
}

export async function getMemoryPressureSnapshot(): Promise<MemoryPressureSnapshot> {
  const [windowsStatus, darwinPressureLevel] = await Promise.all([
    getWindowsMemoryStatus(),
    getDarwinMemoryPressureLevel(),
  ]);
  const systemAvailable = await getSystemAvailableMemoryBytes(windowsStatus);
  const cgroupAvailable = getCgroupAvailableMemoryBytes();
  const availableMemoryBytes =
    cgroupAvailable !== null ? Math.min(systemAvailable, cgroupAvailable) : systemAvailable;
  const effectiveMemoryLimitBytes = getEffectiveMemoryLimitBytes();

  return {
    availableMemoryBytes,
    effectiveMemoryLimitBytes,
    ...(darwinPressureLevel !== null ? { memoryPressureLevel: darwinPressureLevel } : {}),
    ...(windowsStatus
      ? {
          availableCommitBytes: windowsStatus.availableCommitBytes,
          commitLimitBytes: windowsStatus.commitLimitBytes,
          committedBytes: windowsStatus.committedBytes,
        }
      : {}),
  };
}

/**
 * Get the effective memory limit for this process, cgroup-aware.
 *
 * Returns the minimum of `os.totalmem()` and any cgroup `memory.max` limit.
 * This ensures per-session budget calculations don't exceed the actual available
 * memory when a parent cgroup (e.g. `user.slice MemoryMax=26G` on a 32G machine)
 * constrains the process.
 */
export function getEffectiveMemoryLimitBytes(): number {
  const totalMem = os.totalmem();
  const cgroupMax = getCgroupMemoryMaxBytes();
  if (cgroupMax !== null) {
    return Math.min(totalMem, cgroupMax);
  }
  return totalMem;
}

async function getSystemAvailableMemoryBytes(
  windowsStatus?: WindowsMemoryStatus | null
): Promise<number> {
  if (windowsStatus) {
    return Math.max(windowsStatus.availableBytes, os.freemem());
  }

  const darwinAvailable = await getDarwinAvailableMemoryBytes();
  if (darwinAvailable !== null) {
    return darwinAvailable;
  }

  return getSystemAvailableMemoryBytesSync();
}

function getSystemAvailableMemoryBytesSync(): number {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const match = meminfo.match(/MemAvailable:\s+(\d+)/);
    if (match?.[1]) {
      return parseInt(match[1], 10) * 1024; // kB → bytes
    }
  } catch {
    // Not Linux or /proc/meminfo not available, fall through
  }

  return os.freemem();
}

async function getWindowsMemoryStatus(): Promise<WindowsMemoryStatus | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const script = `
$mem = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory |
  Select-Object AvailableBytes, CommitLimit, CommittedBytes
$mem | ConvertTo-Json -Compress
`;
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        encoding: 'utf8',
        timeout: MEMORY_PROBE_TIMEOUT_MS,
        windowsHide: true,
      }
    );
    return parseWindowsMemoryStatus(String(stdout ?? ''));
  } catch {
    return null;
  }
}

export function parseWindowsMemoryStatus(rawJson: string): WindowsMemoryStatus | null {
  try {
    const parsed = JSON.parse(rawJson) as {
      AvailableBytes?: unknown;
      CommitLimit?: unknown;
      CommittedBytes?: unknown;
    };
    const availableBytes = Number(parsed.AvailableBytes);
    const commitLimitBytes = Number(parsed.CommitLimit);
    const committedBytes = Number(parsed.CommittedBytes);

    if (
      !Number.isFinite(availableBytes) ||
      availableBytes < 0 ||
      !Number.isFinite(commitLimitBytes) ||
      commitLimitBytes <= 0 ||
      !Number.isFinite(committedBytes) ||
      committedBytes < 0
    ) {
      return null;
    }

    return {
      availableBytes,
      commitLimitBytes,
      committedBytes,
      availableCommitBytes: Math.max(0, commitLimitBytes - committedBytes),
    };
  } catch {
    return null;
  }
}

/**
 * Read the macOS kernel memory pressure level.
 *
 * This is the same value jetsam itself acts on, and it is the only admission
 * signal on macOS that is not systematically wrong: byte-based estimates cannot
 * account for the compressor's remaining headroom, which is where most of a
 * Mac's reclaimable memory actually lives.
 *
 * Returns null off macOS, or when the probe fails/returns an unknown value. The
 * caller must treat null as "no pressure" (fail open) rather than falling back
 * to a byte threshold.
 */
async function getDarwinMemoryPressureLevel(): Promise<DarwinMemoryPressureLevel | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      'sysctl',
      ['-n', 'kern.memorystatus_vm_pressure_level'],
      {
        encoding: 'utf8',
        timeout: MEMORY_PROBE_TIMEOUT_MS,
      }
    );
    return parseDarwinPressureLevel(String(stdout ?? ''));
  } catch {
    return null;
  }
}

export function parseDarwinPressureLevel(raw: string): DarwinMemoryPressureLevel | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number.parseInt(trimmed, 10);
  if (
    value === DARWIN_PRESSURE_NORMAL ||
    value === DARWIN_PRESSURE_WARNING ||
    value === DARWIN_PRESSURE_CRITICAL
  ) {
    return value;
  }

  // Unknown level: a future kernel value must not be guessed at.
  return null;
}

/**
 * On macOS, `os.freemem()` is too conservative because it excludes memory that
 * can be reclaimed quickly, such as cached file-backed pages. Approximate the
 * reclaimable budget from `vm_stat` instead.
 *
 * This number is reported to the device resource monitor. It is deliberately NOT
 * the admission signal on macOS — see `getDarwinMemoryPressureLevel`.
 */
async function getDarwinAvailableMemoryBytes(): Promise<number | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('vm_stat', [], {
      encoding: 'utf8',
      timeout: MEMORY_PROBE_TIMEOUT_MS,
    });
    const parsed = parseDarwinAvailableMemoryBytes(String(stdout ?? ''));
    if (parsed !== null) {
      return Math.max(parsed, os.freemem());
    }
  } catch {
    // Fall back to os.freemem() below.
  }

  return null;
}

export function parseDarwinAvailableMemoryBytes(vmStatOutput: string): number | null {
  const pageSizeMatch = vmStatOutput.match(/page size of\s+(\d+)\s+bytes/i);
  if (!pageSizeMatch?.[1]) {
    return null;
  }

  const pageSize = parseInt(pageSizeMatch[1], 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }

  const counters = new Map<string, number>();
  for (const rawLine of vmStatOutput.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^"?([^":]+?)"?:\s+(\d+)\.?$/);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    counters.set(match[1].toLowerCase(), parseInt(match[2], 10));
  }

  const freePages = counters.get('pages free') ?? 0;
  const speculativePages = counters.get('pages speculative') ?? 0;
  const purgeablePages = counters.get('pages purgeable') ?? 0;
  const inactivePages = counters.get('pages inactive') ?? 0;
  const fileBackedPages = counters.get('file-backed pages');

  if (freePages === 0 && speculativePages === 0 && purgeablePages === 0 && inactivePages === 0) {
    return null;
  }

  // On macOS, cached files largely live in the inactive/file-backed set and
  // can be reclaimed quickly under pressure. Cap file-backed pages by inactive
  // pages so we do not overcount active file-backed memory.
  const reclaimableCachedPages =
    fileBackedPages !== undefined ? Math.min(fileBackedPages, inactivePages) : inactivePages;
  const availablePages = freePages + speculativePages + purgeablePages + reclaimableCachedPages;
  return availablePages * pageSize;
}

/**
 * Read the cgroup memory limit (`memory.max`) for the current process.
 * Walks up the cgroup hierarchy to find the most restrictive ancestor limit.
 * Returns null if not running under cgroup v2 or if the limit is "max" (unlimited).
 */
function getCgroupMemoryMaxBytes(): number | null {
  try {
    const cgroupPath = readSelfCgroupPath();
    if (cgroupPath === null) return null;

    // Walk from the process's own cgroup up to the root, collecting
    // the tightest memory.max along the way.
    let tightest: number | null = null;
    let current = cgroupPath;

    // Safety limit to avoid infinite loop
    for (let depth = 0; depth < 20; depth++) {
      const memMaxPath = `/sys/fs/cgroup${current === '/' ? '' : current}/memory.max`;
      const raw = readFileSafe(memMaxPath);
      if (raw !== null) {
        const trimmed = raw.trim();
        if (trimmed !== 'max') {
          const value = parseInt(trimmed, 10);
          if (Number.isFinite(value) && value > 0) {
            tightest = tightest === null ? value : Math.min(tightest, value);
          }
        }
      }

      if (current === '/' || current === '') break;
      // Move to parent cgroup
      const parent = current.substring(0, current.lastIndexOf('/')) || '/';
      if (parent === current) break;
      current = parent;
    }

    return tightest;
  } catch {
    return null;
  }
}

/**
 * Read the cgroup available memory (memory.max - memory.current) for the current process.
 * Returns null if not under cgroup v2 or memory.max is unlimited.
 */
function getCgroupAvailableMemoryBytes(): number | null {
  try {
    const cgroupPath = readSelfCgroupPath();
    if (cgroupPath === null) return null;

    // Find the tightest ancestor limit and the current usage at that level
    let tightestMax: number | null = null;
    let tightestPath: string | null = null;
    let current = cgroupPath;

    for (let depth = 0; depth < 20; depth++) {
      const prefix = `/sys/fs/cgroup${current === '/' ? '' : current}`;
      const raw = readFileSafe(`${prefix}/memory.max`);
      if (raw !== null) {
        const trimmed = raw.trim();
        if (trimmed !== 'max') {
          const value = parseInt(trimmed, 10);
          if (Number.isFinite(value) && value > 0) {
            if (tightestMax === null || value < tightestMax) {
              tightestMax = value;
              tightestPath = prefix;
            }
          }
        }
      }

      if (current === '/' || current === '') break;
      const parent = current.substring(0, current.lastIndexOf('/')) || '/';
      if (parent === current) break;
      current = parent;
    }

    if (tightestMax === null || tightestPath === null) return null;

    const currentRaw = readFileSafe(`${tightestPath}/memory.current`);
    if (currentRaw === null) return null;

    const currentUsage = parseInt(currentRaw.trim(), 10);
    if (!Number.isFinite(currentUsage)) return null;

    return Math.max(0, tightestMax - currentUsage);
  } catch {
    return null;
  }
}

function readSelfCgroupPath(): string | null {
  try {
    const content = readFileSync('/proc/self/cgroup', 'utf8');
    const line = content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('0::'));
    if (!line) return null;
    const cgroupPath = line.slice(3).trim();
    return cgroupPath || '/';
  } catch {
    return null;
  }
}

function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}
