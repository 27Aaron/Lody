import { SessionId } from '@lody/shared';
import { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import {
  DARWIN_PRESSURE_CRITICAL,
  DARWIN_PRESSURE_WARNING,
  getEffectiveMemoryLimitBytes,
  type DarwinMemoryPressureLevel,
  type MemoryPressureSnapshot,
} from '@/utils/memory';
import type { MemoryPressureSnapshotSource } from '@/monitor/memory-pressure-sampler';

/**
 * Session Garbage Collection Manager
 *
 * Unified session lifecycle manager that handles both idle cleanup and memory pressure eviction.
 *
 * ## Idle Cleanup
 *
 * Sessions idle for longer than `idleTimeoutMs` (default: 20 minutes) are fully cleaned up:
 * ACP process killed, Loro documents cleaned, session object deleted.
 * Periodic sweep runs every `sweepIntervalMs` (default: 1 minute) to find and clean idle sessions.
 *
 * ## Memory Pressure Eviction
 *
 * Before starting a new session, call `evictForMemoryPressure()`. It produces two independent
 * verdicts (see `evaluateMemoryPressure`): whether to reclaim idle sessions, and whether the
 * machine is too constrained to start a turn at all. Reclaiming is cheap and invisible to the
 * user (a reclaimed session is restored on its next turn); refusing a turn is not, so the two
 * are deliberately not the same threshold.
 *
 * The signal is platform specific:
 *
 * - **macOS** uses `kern.memorystatus_vm_pressure_level`, the kernel's own verdict and the one
 *   jetsam acts on. WARNING reclaims (the kernel is already killing idle processes at that
 *   point, so ordered reclamation beats waiting to be picked at random); only CRITICAL refuses
 *   a turn. Byte-based estimates are NOT used here and must not be reintroduced as a fallback:
 *   they cannot see compressor headroom, which is where most of a Mac's reclaimable memory is,
 *   and they consequently report pressure on perfectly healthy machines.
 * - **Linux/Windows** keep the byte thresholds. There the limits are real and hard — a cgroup
 *   `memory.max` overrun is an OOM kill and a Windows commit-limit overrun is an allocation
 *   failure — so refusing early is correct.
 */

export interface SessionGCConfig {
  /** Idle timeout before a session is fully cleaned up (default: 20 minutes) */
  idleTimeoutMs: number;
  /** Interval to run GC sweep (default: 1 min) */
  sweepIntervalMs: number;
  /** Enable GC (default: true) */
  enabled: boolean;
  /** Memory threshold in bytes; below this, memory pressure eviction kicks in (default: 1 GB) */
  memoryThresholdBytes: number;
  /**
   * Upper bound on sessions evicted per `evictForMemoryPressure()` call (default: 3).
   *
   * This runs on the prompt hot path — the caller awaits it before `agent.prompt` — and each
   * eviction terminates an ACP process and unloads a Loro document. Without a bound, one turn
   * start could synchronously tear down every idle session. The periodic sweep picks up the rest.
   */
  maxEvictionsPerCall: number;
}

export type MemoryPressureReason =
  | 'physical'
  | 'commit'
  | 'physical_and_commit'
  | 'darwin_pressure_warning'
  | 'darwin_pressure_critical';

export interface MemoryPressureVerdict {
  /** Reclaim idle sessions. Invisible to users; they are restored on their next turn. */
  evict: boolean;
  /** Refuse to start a turn. User-visible failure — reserved for genuinely constrained machines. */
  block: boolean;
  reason: MemoryPressureReason | null;
}

export interface SessionGCDeps {
  getSessionLastActivity: (sessionId: SessionId) => number | undefined;
  /** Whether the session has an active turn (prompting or finalizing) */
  hasActiveTurn: (sessionId: SessionId) => boolean;
  /** Whether the session has an active background goal that still needs its ACP runtime */
  hasActiveGoal: (sessionId: SessionId) => boolean | Promise<boolean>;
  hasPendingUpdates: (sessionId: SessionId) => boolean;
  hasPendingUserWork: (sessionId: SessionId) => boolean | Promise<boolean>;
  isArchiveInFlight: (sessionId: SessionId) => boolean;
  cleanSession: (sessionId: SessionId) => Promise<void>;
  getSessionIds: () => SessionId[];
  memoryPressure: MemoryPressureSnapshotSource;
  logger: Logger;
}

export interface MemoryPressureEvictionResult {
  availableMemoryBytes: number;
  thresholdBytes: number;
  /** Something was worth reclaiming. Not a statement about whether the turn may proceed. */
  hadMemoryPressure: boolean;
  /** The turn must be refused. */
  stillUnderPressure: boolean;
  evictedSessionIds: SessionId[];
  pressureReason: MemoryPressureReason | null;
  /** macOS only; lets the failure message describe the kernel verdict instead of byte counts. */
  memoryPressureLevel?: DarwinMemoryPressureLevel;
  availableCommitBytes?: number;
  commitThresholdBytes?: number;
  commitLimitBytes?: number;
  committedBytes?: number;
}

function readEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const GIB = 1024 * 1024 * 1024;
const WINDOWS_COMMIT_THRESHOLD_FLOOR_BYTES = 512 * 1024 * 1024;
const WINDOWS_COMMIT_THRESHOLD_CEILING_BYTES = 2 * GIB;
const DEFAULT_MAX_EVICTIONS_PER_CALL = 3;

/**
 * Default memory pressure threshold: 10% of effective memory (cgroup-aware),
 * clamped to [1 GB, 4 GB]. On a 26 GB cgroup this yields ~2.6 GB, giving the
 * system enough breathing room for kernel page cache and I/O buffers.
 */
function defaultMemoryThresholdBytes(): number {
  const tenPercent = Math.floor(getEffectiveMemoryLimitBytes() * 0.1);
  return Math.max(GIB, Math.min(4 * GIB, tenPercent));
}

export function loadGCConfig(): SessionGCConfig {
  return {
    idleTimeoutMs: readEnvNumber('LODY_SESSION_GC_IDLE_TIMEOUT_MS', 20 * 60 * 1000), // 20 minutes
    sweepIntervalMs: readEnvNumber('LODY_SESSION_GC_SWEEP_INTERVAL_MS', 60 * 1000),
    enabled: process.env.LODY_SESSION_GC_ENABLED !== 'false',
    memoryThresholdBytes: readEnvNumber(
      'LODY_SESSION_GC_MEMORY_THRESHOLD_BYTES',
      defaultMemoryThresholdBytes()
    ),
    maxEvictionsPerCall: readEnvNumber(
      'LODY_SESSION_GC_MAX_EVICTIONS_PER_CALL',
      DEFAULT_MAX_EVICTIONS_PER_CALL
    ),
  };
}

function getWindowsCommitThresholdBytes(memoryThresholdBytes: number): number {
  return Math.max(
    WINDOWS_COMMIT_THRESHOLD_FLOOR_BYTES,
    Math.min(WINDOWS_COMMIT_THRESHOLD_CEILING_BYTES, memoryThresholdBytes)
  );
}

export interface MemoryPressureThresholds {
  platform: NodeJS.Platform;
  thresholdBytes: number;
  commitThresholdBytes: number;
}

/**
 * Decide, from one memory sample, whether to reclaim idle sessions and whether to refuse a turn.
 *
 * Pure — the platform is an explicit input so both branches are testable everywhere.
 */
export function evaluateMemoryPressure(
  snapshot: MemoryPressureSnapshot,
  thresholds: MemoryPressureThresholds
): MemoryPressureVerdict {
  if (thresholds.platform === 'darwin') {
    // Fail open. An unreadable level must not silently reactivate the byte thresholds:
    // they misreport pressure on healthy Macs, which is the bug this branch exists to fix.
    if (snapshot.memoryPressureLevel === DARWIN_PRESSURE_CRITICAL) {
      return { evict: true, block: true, reason: 'darwin_pressure_critical' };
    }
    if (snapshot.memoryPressureLevel === DARWIN_PRESSURE_WARNING) {
      return { evict: true, block: false, reason: 'darwin_pressure_warning' };
    }
    return { evict: false, block: false, reason: null };
  }

  const physicalPressure = snapshot.availableMemoryBytes < thresholds.thresholdBytes;
  const commitPressure =
    snapshot.availableCommitBytes !== undefined &&
    snapshot.availableCommitBytes < thresholds.commitThresholdBytes;

  const reason: MemoryPressureReason | null =
    physicalPressure && commitPressure
      ? 'physical_and_commit'
      : physicalPressure
        ? 'physical'
        : commitPressure
          ? 'commit'
          : null;

  // Linux cgroup limits and Windows commit limits are hard: overrunning them is an OOM kill or
  // an allocation failure, so the reclaim and refuse thresholds stay the same here.
  return { evict: reason !== null, block: reason !== null, reason };
}

export class SessionGCManager {
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor(
    private config: SessionGCConfig,
    private deps: SessionGCDeps,
    /** Injectable so both the kernel-signal and byte-threshold branches are testable anywhere. */
    private platform: NodeJS.Platform = process.platform
  ) {}

  start(): void {
    if (!this.config.enabled) {
      this.deps.logger.debug('[GC] Session GC is disabled');
      return;
    }
    const pressureSignal =
      this.platform === 'darwin'
        ? 'kern.memorystatus_vm_pressure_level'
        : `available<${Math.round(this.config.memoryThresholdBytes / 1024 / 1024)}MB`;
    this.deps.logger.debug(
      `[GC] Starting session GC (interval=${this.config.sweepIntervalMs}ms, ` +
        `idleTimeout=${this.config.idleTimeoutMs}ms, ` +
        `pressureSignal=${pressureSignal}, ` +
        `maxEvictionsPerCall=${this.config.maxEvictionsPerCall})`
    );
    this.sweepInterval = setInterval(() => void this.sweep(), this.config.sweepIntervalMs);
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
      this.deps.logger.debug('[GC] Session GC stopped');
    }
  }

  /**
   * Periodic sweep: clean all sessions that have been idle longer than `idleTimeoutMs`.
   */
  async sweep(): Promise<void> {
    const sweepStart = Date.now();
    const candidates = await this.getIdleCandidates();

    if (candidates.length === 0) {
      return;
    }

    // Clean longest-idle first
    candidates.sort((a, b) => b.idleMs - a.idleMs);

    let cleaned = 0;
    let skipped = 0;
    for (const { sessionId } of candidates) {
      if (!(await this.isStillEligibleForGC(sessionId))) {
        skipped++;
        continue;
      }

      try {
        await this.deps.cleanSession(sessionId);
        cleaned++;
      } catch (error) {
        this.deps.logger.error(
          `[GC] Failed to clean session ${sessionId}: ${formatErrorMessage(error)}`
        );
      }
    }

    if (skipped > 0) {
      this.deps.logger.debug(`[GC] Skipped ${skipped} sessions that became active during sweep`);
    }

    const sweepDuration = Date.now() - sweepStart;
    this.deps.logger.debug(
      `[GC] Sweep completed: cleaned ${cleaned}/${candidates.length} sessions in ${sweepDuration}ms`
    );
  }

  /**
   * Reclaim idle sessions under memory pressure, and report whether a turn may start.
   *
   * Call this before starting a turn. Evicts the longest-idle sessions one at a time (bounded by
   * `maxEvictionsPerCall`) while the platform signal still asks for reclamation, then reports
   * `stillUnderPressure` — which is the REFUSE verdict, not the reclaim one. On macOS those two
   * differ: WARNING reclaims silently, only CRITICAL refuses.
   *
   * @param excludeSessionId - Session to exclude from eviction (e.g. the session being started)
   */
  async evictForMemoryPressure(
    excludeSessionId?: SessionId
  ): Promise<MemoryPressureEvictionResult> {
    const thresholdBytes = this.config.memoryThresholdBytes;
    const commitThresholdBytes = getWindowsCommitThresholdBytes(thresholdBytes);
    const thresholds: MemoryPressureThresholds = {
      platform: this.platform,
      thresholdBytes,
      commitThresholdBytes,
    };
    let memorySnapshot = await this.deps.memoryPressure.getLatest();
    let verdict = evaluateMemoryPressure(memorySnapshot, thresholds);

    if (!this.config.enabled || !verdict.evict) {
      return this.buildEvictionResult({
        snapshot: memorySnapshot,
        thresholdBytes,
        commitThresholdBytes,
        hadMemoryPressure: false,
        // A disabled GC never blocks: it is the operator opting out of the whole mechanism.
        verdict: this.config.enabled ? verdict : { evict: false, block: false, reason: null },
        evictedSessionIds: [],
      });
    }

    this.deps.logger.debug(
      `[GC] Memory pressure detected (${verdict.reason}): ${this.describeMemoryState(
        memorySnapshot,
        thresholdBytes,
        commitThresholdBytes
      )}`
    );

    // Get all sessions sorted by idle time (longest idle first)
    const sessions = this.getSessionsWithIdleTime();
    sessions.sort((a, b) => b.idleMs - a.idleMs);

    const evictedSessionIds: SessionId[] = [];
    for (const { sessionId, idleMs } of sessions) {
      if (!verdict.evict || evictedSessionIds.length >= this.config.maxEvictionsPerCall) {
        break;
      }

      if (excludeSessionId && sessionId === excludeSessionId) {
        continue;
      }

      // Skip sessions with no idle time (just created)
      if (idleMs === 0) {
        continue;
      }

      if (!(await this.isEligibleForCleanup(sessionId))) {
        continue;
      }

      try {
        this.deps.logger.debug(
          `[GC] Evicting session ${sessionId} (idle ${Math.round(idleMs / 1000)}s) due to memory pressure`
        );
        await this.deps.cleanSession(sessionId);
        evictedSessionIds.push(sessionId);
        // Re-check memory after eviction
        memorySnapshot = await this.deps.memoryPressure.refresh();
        verdict = evaluateMemoryPressure(memorySnapshot, thresholds);
      } catch (error) {
        this.deps.logger.error(
          `[GC] Failed to evict session ${sessionId}: ${formatErrorMessage(error)}`
        );
      }
    }

    const availableMemory = memorySnapshot.availableMemoryBytes;
    const stillUnderPressure = verdict.block;

    if (evictedSessionIds.length > 0) {
      this.deps.logger.debug(
        `[GC] Memory pressure eviction complete: evicted ${evictedSessionIds.length} sessions, ` +
          `available memory now ${Math.round(availableMemory / 1024 / 1024)}MB`
      );
    } else if (stillUnderPressure) {
      this.deps.logger.debug(
        '[GC] Memory pressure persists but no idle sessions were eligible for eviction'
      );
    }

    return this.buildEvictionResult({
      snapshot: memorySnapshot,
      thresholdBytes,
      commitThresholdBytes,
      hadMemoryPressure: true,
      verdict,
      evictedSessionIds,
    });
  }

  private buildEvictionResult(options: {
    snapshot: MemoryPressureSnapshot;
    thresholdBytes: number;
    commitThresholdBytes: number;
    hadMemoryPressure: boolean;
    verdict: MemoryPressureVerdict;
    evictedSessionIds: SessionId[];
  }): MemoryPressureEvictionResult {
    const { snapshot, thresholdBytes, commitThresholdBytes, verdict } = options;
    return {
      availableMemoryBytes: snapshot.availableMemoryBytes,
      thresholdBytes,
      hadMemoryPressure: options.hadMemoryPressure,
      stillUnderPressure: verdict.block,
      evictedSessionIds: options.evictedSessionIds,
      pressureReason: verdict.reason,
      ...(snapshot.memoryPressureLevel !== undefined
        ? { memoryPressureLevel: snapshot.memoryPressureLevel }
        : {}),
      ...(snapshot.availableCommitBytes !== undefined
        ? {
            availableCommitBytes: snapshot.availableCommitBytes,
            commitThresholdBytes,
            commitLimitBytes: snapshot.commitLimitBytes,
            committedBytes: snapshot.committedBytes,
          }
        : {}),
    };
  }

  private describeMemoryState(
    snapshot: MemoryPressureSnapshot,
    thresholdBytes: number,
    commitThresholdBytes: number
  ): string {
    if (snapshot.memoryPressureLevel !== undefined) {
      return `kernel pressure level ${snapshot.memoryPressureLevel}`;
    }

    const commitText =
      snapshot.availableCommitBytes !== undefined
        ? `, commit headroom ${Math.round(snapshot.availableCommitBytes / 1024 / 1024)}MB ` +
          `(threshold: ${Math.round(commitThresholdBytes / 1024 / 1024)}MB)`
        : '';
    return (
      `${Math.round(snapshot.availableMemoryBytes / 1024 / 1024)}MB available ` +
      `(threshold: ${Math.round(thresholdBytes / 1024 / 1024)}MB)${commitText}`
    );
  }

  /**
   * Get idle sessions eligible for cleanup, sorted by idle time (longest idle first).
   */
  private async getIdleCandidates(): Promise<Array<{ sessionId: SessionId; idleMs: number }>> {
    const sessions = this.getSessionsWithIdleTime();
    const candidates: Array<{ sessionId: SessionId; idleMs: number }> = [];

    for (const session of sessions) {
      if (session.idleMs < this.config.idleTimeoutMs) {
        continue;
      }

      if (!(await this.isEligibleForCleanup(session.sessionId))) {
        continue;
      }

      candidates.push(session);
    }

    return candidates;
  }

  private getSessionsWithIdleTime(): Array<{ sessionId: SessionId; idleMs: number }> {
    const now = Date.now();
    const result: Array<{ sessionId: SessionId; idleMs: number }> = [];
    const sessionIds = this.deps.getSessionIds();

    for (const sessionId of sessionIds) {
      const lastActivity = this.deps.getSessionLastActivity(sessionId);
      if (lastActivity === undefined) {
        // No activity record, probably just created, treat as most recent (protected)
        result.push({ sessionId, idleMs: 0 });
        continue;
      }

      const idleMs = now - lastActivity;
      result.push({ sessionId, idleMs });
    }

    return result;
  }

  /**
   * Check if a session is eligible for cleanup.
   * A session is NOT eligible if it has an active turn, active goal,
   * pending updates, pending user work, or archive in flight.
   */
  private async isEligibleForCleanup(sessionId: SessionId): Promise<boolean> {
    if (this.deps.hasActiveTurn(sessionId)) {
      return false;
    }

    if (await this.deps.hasActiveGoal(sessionId)) {
      return false;
    }

    if (this.deps.hasPendingUpdates(sessionId)) {
      return false;
    }

    if (await this.deps.hasPendingUserWork(sessionId)) {
      return false;
    }

    if (this.deps.isArchiveInFlight(sessionId)) {
      return false;
    }

    return true;
  }

  /**
   * Re-check eligibility right before cleanup to guard against races.
   * Also verifies the session hasn't become active since candidate selection.
   */
  private async isStillEligibleForGC(sessionId: SessionId): Promise<boolean> {
    if (!(await this.isEligibleForCleanup(sessionId))) {
      return false;
    }

    const lastActivity = this.deps.getSessionLastActivity(sessionId);
    if (lastActivity !== undefined) {
      const idleMs = Date.now() - lastActivity;
      if (idleMs < this.config.idleTimeoutMs) {
        return false;
      }
    }

    return true;
  }
}
