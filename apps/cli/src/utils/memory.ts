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
  /**
   * Reclaim-aware headroom: what a new process can actually get. On Linux this counts
   * page cache the kernel will hand back, NOT just untouched bytes.
   */
  availableMemoryBytes: number;
  effectiveMemoryLimitBytes: number;
  /** macOS only; absent when the probe is unavailable or returned an unknown value. */
  memoryPressureLevel?: DarwinMemoryPressureLevel;
  /** Linux only; `MemAvailable`, before any cgroup limit is applied. */
  hostAvailableBytes?: number;
  /** Linux only; present when some ancestor cgroup imposes a `memory.max`. */
  cgroup?: CgroupMemoryState;
  availableCommitBytes?: number;
  commitLimitBytes?: number;
  committedBytes?: number;
}

/**
 * Reclaim-aware available memory for the current process, cgroup-aware.
 *
 * On Linux the answer is the minimum of:
 * - System-wide `MemAvailable` from `/proc/meminfo` (already reclaim-aware)
 * - The cgroup's budget: `memory.max - memory.current` PLUS reclaimable cache/slab
 *
 * The reclaimable term is the whole point. `memory.current` counts page cache, so
 * without it a cgroup that has merely read a lot of files looks full.
 *
 * On other platforms, falls back to `os.freemem()`.
 */
export function getAvailableMemoryBytes(): number {
  const systemAvailable = getSystemAvailableMemoryBytesSync();
  const cgroup = readCgroupMemoryState();
  if (cgroup !== null) {
    return Math.min(systemAvailable, cgroup.hardHeadroomBytes + cgroup.reclaimableBytes);
  }
  return systemAvailable;
}

export async function getMemoryPressureSnapshot(): Promise<MemoryPressureSnapshot> {
  const [windowsStatus, darwinPressureLevel] = await Promise.all([
    getWindowsMemoryStatus(),
    getDarwinMemoryPressureLevel(),
  ]);
  const systemAvailable = await getSystemAvailableMemoryBytes(windowsStatus);
  const cgroup = readCgroupMemoryState();
  const availableMemoryBytes =
    cgroup !== null
      ? Math.min(systemAvailable, cgroup.hardHeadroomBytes + cgroup.reclaimableBytes)
      : systemAvailable;
  const effectiveMemoryLimitBytes = getEffectiveMemoryLimitBytes();

  return {
    availableMemoryBytes,
    effectiveMemoryLimitBytes,
    ...(darwinPressureLevel !== null ? { memoryPressureLevel: darwinPressureLevel } : {}),
    ...(cgroup !== null ? { cgroup, hostAvailableBytes: systemAvailable } : {}),
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
  const cgroupMax = findTightestCgroupLimit()?.maxBytes ?? null;
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
 * Locate the most restrictive ancestor cgroup that actually imposes a `memory.max`.
 *
 * Returns its `/sys/fs/cgroup/...` prefix plus the limit, or null when not under
 * cgroup v2 or when every ancestor is unlimited.
 */
function findTightestCgroupLimit(): { prefix: string; maxBytes: number } | null {
  try {
    const cgroupPath = readSelfCgroupPath();
    if (cgroupPath === null) return null;

    let tightest: { prefix: string; maxBytes: number } | null = null;
    let current = cgroupPath;

    // Safety limit to avoid infinite loop
    for (let depth = 0; depth < 20; depth++) {
      const prefix = `/sys/fs/cgroup${current === '/' ? '' : current}`;
      const value = parseCgroupLimit(readFileSafe(`${prefix}/memory.max`));
      if (value !== null && (tightest === null || value < tightest.maxBytes)) {
        tightest = { prefix, maxBytes: value };
      }

      if (current === '/' || current === '') break;
      const parent = current.substring(0, current.lastIndexOf('/')) || '/';
      if (parent === current) break;
      current = parent;
    }

    return tightest;
  } catch {
    return null;
  }
}

function parseCgroupLimit(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === 'max') return null;
  const value = parseInt(trimmed, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface CgroupMemoryStat {
  inactiveFileBytes: number;
  activeFileBytes: number;
  slabReclaimableBytes: number;
  dirtyBytes: number;
}

export interface CgroupMemoryState {
  /** Filesystem prefix of the limiting cgroup, for diagnostics. */
  path: string;
  maxBytes: number;
  /** The throttling threshold, when set. Crossing it means reclaim pressure, not death. */
  highBytes: number | null;
  currentBytes: number;
  /** `memory.max - memory.current`: what is left without reclaiming anything. */
  hardHeadroomBytes: number;
  /** Cache and slab the kernel can hand back without swapping or OOM-killing. */
  reclaimableBytes: number;
  stat: CgroupMemoryStat;
  /** `memory.pressure` "some avg10": share of the last 10s stalled on reclaim. */
  psiSomeAvg10: number | null;
  /** `memory.events` counters. Growth means the kernel really did throttle us. */
  events: { high: number; max: number } | null;
}

/**
 * Read the limiting cgroup's memory state, including what is reclaimable.
 *
 * INVARIANT: `memory.current` counts page cache, so `memory.max - memory.current` alone
 * reports a cgroup as full when it is merely warm. A tree scan can park tens of GB of
 * clean page cache in `memory.current` while resident process memory is a fraction of
 * that; the kernel hands that cache straight back on the next allocation. Treating it as
 * unavailable is what made this guard refuse turns on a machine in no distress at all.
 */
function readCgroupMemoryState(): CgroupMemoryState | null {
  const limit = findTightestCgroupLimit();
  if (limit === null) return null;

  const currentRaw = readFileSafe(`${limit.prefix}/memory.current`);
  if (currentRaw === null) return null;
  const currentBytes = parseInt(currentRaw.trim(), 10);
  if (!Number.isFinite(currentBytes)) return null;

  const stat = parseCgroupMemoryStat(readFileSafe(`${limit.prefix}/memory.stat`) ?? '');

  return {
    path: limit.prefix,
    maxBytes: limit.maxBytes,
    highBytes: parseCgroupLimit(readFileSafe(`${limit.prefix}/memory.high`)),
    currentBytes,
    hardHeadroomBytes: Math.max(0, limit.maxBytes - currentBytes),
    reclaimableBytes: computeCgroupReclaimableBytes(stat),
    stat,
    psiSomeAvg10: parseCgroupPressureSomeAvg10(
      readFileSafe(`${limit.prefix}/memory.pressure`) ?? ''
    ),
    events: parseCgroupMemoryEvents(readFileSafe(`${limit.prefix}/memory.events`) ?? ''),
  };
}

export function parseCgroupMemoryStat(raw: string): CgroupMemoryStat {
  const values = new Map<string, number>();
  for (const line of raw.split('\n')) {
    const match = line.trim().match(/^([a-z_]+)\s+(\d+)$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], parseInt(match[2], 10));
    }
  }
  return {
    inactiveFileBytes: values.get('inactive_file') ?? 0,
    activeFileBytes: values.get('active_file') ?? 0,
    slabReclaimableBytes: values.get('slab_reclaimable') ?? 0,
    dirtyBytes: (values.get('file_dirty') ?? 0) + (values.get('file_writeback') ?? 0),
  };
}

/**
 * Conservative estimate of cgroup memory the kernel can reclaim without I/O stalls.
 *
 * `inactive_file` less dirty/writeback pages (those must be written out first), plus half
 * of `slab_reclaimable` (dentry/inode caches shrink under pressure but not completely).
 *
 * `active_file` is deliberately EXCLUDED even though the kernel does deactivate and
 * reclaim it under pressure — a heavy tree scan leaves most cache in the active list, so
 * counting it would dominate the estimate with the least predictable term. The
 * under-count is intentional and is compensated by requiring a real stall signal (PSI or
 * `memory.events` growth) before any turn is refused; see `evaluateMemoryPressure`.
 */
export function computeCgroupReclaimableBytes(stat: CgroupMemoryStat): number {
  const cleanInactiveFile = Math.max(0, stat.inactiveFileBytes - stat.dirtyBytes);
  return cleanInactiveFile + Math.floor(stat.slabReclaimableBytes / 2);
}

export function parseCgroupPressureSomeAvg10(raw: string): number | null {
  const match = raw.match(/^some\s+avg10=([\d.]+)/m);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseCgroupMemoryEvents(raw: string): { high: number; max: number } | null {
  const read = (key: string): number | null => {
    const match = raw.match(new RegExp(`^${key}\\s+(\\d+)$`, 'm'));
    if (!match?.[1]) return null;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
  };
  const high = read('high');
  const max = read('max');
  if (high === null || max === null) return null;
  return { high, max };
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
