import { SessionId } from '@lody/shared';
import { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import { getEffectiveMemoryLimitBytes, type MemoryPressureSnapshot } from '@/utils/memory';
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
 * Before starting a new session, call `evictForMemoryPressure()` to check available system memory.
 * If available memory is below `memoryThresholdBytes` (default: 1 GB), idle sessions are evicted
 * one at a time (longest idle first) until memory is above the threshold or no idle sessions remain.
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
  hadMemoryPressure: boolean;
  stillUnderPressure: boolean;
  evictedSessionIds: SessionId[];
  pressureReason: 'physical' | 'commit' | 'physical_and_commit' | null;
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
  };
}

function getWindowsCommitThresholdBytes(memoryThresholdBytes: number): number {
  return Math.max(
    WINDOWS_COMMIT_THRESHOLD_FLOOR_BYTES,
    Math.min(WINDOWS_COMMIT_THRESHOLD_CEILING_BYTES, memoryThresholdBytes)
  );
}

export class SessionGCManager {
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor(
    private config: SessionGCConfig,
    private deps: SessionGCDeps
  ) {}

  start(): void {
    if (!this.config.enabled) {
      this.deps.logger.debug('[GC] Session GC is disabled');
      return;
    }
    this.deps.logger.debug(
      `[GC] Starting session GC (interval=${this.config.sweepIntervalMs}ms, ` +
        `idleTimeout=${this.config.idleTimeoutMs}ms, ` +
        `memoryThreshold=${Math.round(this.config.memoryThresholdBytes / 1024 / 1024)}MB)`
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
   * Evict idle sessions under memory pressure.
   *
   * Call this before starting a new session. If available system memory is below
   * `memoryThresholdBytes`, evicts the longest-idle sessions one at a time until
   * memory is above the threshold or no idle sessions remain.
   *
   * @param excludeSessionId - Session to exclude from eviction (e.g. the session being started)
   */
  async evictForMemoryPressure(
    excludeSessionId?: SessionId
  ): Promise<MemoryPressureEvictionResult> {
    const thresholdBytes = this.config.memoryThresholdBytes;
    const commitThresholdBytes = getWindowsCommitThresholdBytes(thresholdBytes);
    let memorySnapshot = await this.deps.memoryPressure.getLatest();
    let availableMemory = memorySnapshot.availableMemoryBytes;
    let pressureReason = this.getPressureReason(
      memorySnapshot,
      thresholdBytes,
      commitThresholdBytes
    );

    if (!this.config.enabled) {
      return {
        availableMemoryBytes: availableMemory,
        thresholdBytes,
        hadMemoryPressure: false,
        stillUnderPressure: false,
        evictedSessionIds: [],
        pressureReason: null,
        ...(memorySnapshot.availableCommitBytes !== undefined
          ? {
              availableCommitBytes: memorySnapshot.availableCommitBytes,
              commitThresholdBytes,
              commitLimitBytes: memorySnapshot.commitLimitBytes,
              committedBytes: memorySnapshot.committedBytes,
            }
          : {}),
      };
    }

    if (pressureReason === null) {
      return {
        availableMemoryBytes: availableMemory,
        thresholdBytes,
        hadMemoryPressure: false,
        stillUnderPressure: false,
        evictedSessionIds: [],
        pressureReason: null,
        ...(memorySnapshot.availableCommitBytes !== undefined
          ? {
              availableCommitBytes: memorySnapshot.availableCommitBytes,
              commitThresholdBytes,
              commitLimitBytes: memorySnapshot.commitLimitBytes,
              committedBytes: memorySnapshot.committedBytes,
            }
          : {}),
      };
    }

    const commitText =
      memorySnapshot.availableCommitBytes !== undefined
        ? `, commit headroom ${Math.round(memorySnapshot.availableCommitBytes / 1024 / 1024)}MB ` +
          `(threshold: ${Math.round(commitThresholdBytes / 1024 / 1024)}MB)`
        : '';
    this.deps.logger.debug(
      `[GC] Memory pressure detected: ${Math.round(availableMemory / 1024 / 1024)}MB available ` +
        `(threshold: ${Math.round(thresholdBytes / 1024 / 1024)}MB)${commitText}`
    );

    // Get all sessions sorted by idle time (longest idle first)
    const sessions = this.getSessionsWithIdleTime();
    sessions.sort((a, b) => b.idleMs - a.idleMs);

    const evictedSessionIds: SessionId[] = [];
    for (const { sessionId, idleMs } of sessions) {
      if (pressureReason === null) {
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
        availableMemory = memorySnapshot.availableMemoryBytes;
        pressureReason = this.getPressureReason(
          memorySnapshot,
          thresholdBytes,
          commitThresholdBytes
        );
      } catch (error) {
        this.deps.logger.error(
          `[GC] Failed to evict session ${sessionId}: ${formatErrorMessage(error)}`
        );
      }
    }

    const stillUnderPressure = pressureReason !== null;

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

    return {
      availableMemoryBytes: availableMemory,
      thresholdBytes,
      hadMemoryPressure: true,
      stillUnderPressure,
      evictedSessionIds,
      pressureReason,
      ...(memorySnapshot.availableCommitBytes !== undefined
        ? {
            availableCommitBytes: memorySnapshot.availableCommitBytes,
            commitThresholdBytes,
            commitLimitBytes: memorySnapshot.commitLimitBytes,
            committedBytes: memorySnapshot.committedBytes,
          }
        : {}),
    };
  }

  private getPressureReason(
    snapshot: MemoryPressureSnapshot,
    thresholdBytes: number,
    commitThresholdBytes: number
  ): MemoryPressureEvictionResult['pressureReason'] {
    const physicalPressure = snapshot.availableMemoryBytes < thresholdBytes;
    const commitPressure =
      snapshot.availableCommitBytes !== undefined &&
      snapshot.availableCommitBytes < commitThresholdBytes;

    if (physicalPressure && commitPressure) {
      return 'physical_and_commit';
    }
    if (physicalPressure) {
      return 'physical';
    }
    if (commitPressure) {
      return 'commit';
    }
    return null;
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
