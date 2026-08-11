import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SessionId } from '@lody/shared';
import {
  SessionGCManager,
  SessionGCConfig,
  loadGCConfig,
  evaluateMemoryPressure,
} from './session-gc-manager';

// Mock the memory utility
vi.mock('@/utils/memory', () => ({
  getMemoryPressureSnapshot: vi.fn(async () => ({
    availableMemoryBytes: 4 * 1024 * 1024 * 1024,
    effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
  })),
  getEffectiveMemoryLimitBytes: vi.fn(() => 32 * 1024 * 1024 * 1024), // 32 GB by default
  DARWIN_PRESSURE_NORMAL: 1,
  DARWIN_PRESSURE_WARNING: 2,
  DARWIN_PRESSURE_CRITICAL: 4,
}));

import { getMemoryPressureSnapshot } from '@/utils/memory';

const mockedGetMemoryPressureSnapshot = vi.mocked(getMemoryPressureSnapshot);

describe('SessionGCManager', () => {
  let cleanMock: ReturnType<typeof vi.fn>;
  let loggerMock: {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let sessionActivities: Map<SessionId, number>;
  let activeTurns: Set<SessionId>;
  let activeGoals: Set<SessionId>;
  let pendingUpdates: Set<SessionId>;
  let pendingUserWork: Set<SessionId>;
  let archiveInFlight: Set<SessionId>;

  beforeEach(() => {
    vi.useFakeTimers();
    cleanMock = vi.fn().mockResolvedValue(undefined);
    loggerMock = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    sessionActivities = new Map();
    activeTurns = new Set();
    activeGoals = new Set();
    pendingUpdates = new Set();
    pendingUserWork = new Set();
    archiveInFlight = new Set();
    mockedGetMemoryPressureSnapshot.mockResolvedValue({
      availableMemoryBytes: 4 * 1024 * 1024 * 1024,
      effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Platform is explicit in every test: the byte-threshold branch does not run on macOS, so a
  // host-dependent default would make these pass or fail based on the developer's laptop.
  const createManager = (
    config?: Partial<SessionGCConfig>,
    platform: NodeJS.Platform = 'linux'
  ) => {
    const defaultConfig: SessionGCConfig = {
      idleTimeoutMs: 20 * 60 * 1000, // 20 minutes
      sweepIntervalMs: 60 * 1000, // 1 minute
      enabled: true,
      memoryThresholdBytes: 1024 * 1024 * 1024, // 1 GB
      maxEvictionsPerCall: 100,
      ...config,
    };
    return new SessionGCManager(
      defaultConfig,
      {
        getSessionLastActivity: (sessionId) => sessionActivities.get(sessionId),
        hasActiveTurn: (sessionId) => activeTurns.has(sessionId),
        hasActiveGoal: async (sessionId) => activeGoals.has(sessionId),
        hasPendingUpdates: (sessionId) => pendingUpdates.has(sessionId),
        hasPendingUserWork: async (sessionId) => pendingUserWork.has(sessionId),
        isArchiveInFlight: (sessionId) => archiveInFlight.has(sessionId),
        cleanSession: cleanMock,
        getSessionIds: () => [...sessionActivities.keys()],
        memoryPressure: {
          getLatest: mockedGetMemoryPressureSnapshot,
          refresh: mockedGetMemoryPressureSnapshot,
        },
        logger: loggerMock as any,
      },
      platform
    );
  };

  describe('loadGCConfig', () => {
    it('returns default config with 20 minute timeout', () => {
      const config = loadGCConfig();
      expect(config.idleTimeoutMs).toBe(20 * 60 * 1000);
      expect(config.sweepIntervalMs).toBe(60 * 1000);
      expect(config.enabled).toBe(true);
      // Default threshold = 10% of effective memory (32 GB mock), clamped to [1 GB, 4 GB]
      // = floor(32 * 1024^3 * 0.1) = 3,435,973,836 bytes (~3.2 GB)
      expect(config.memoryThresholdBytes).toBe(Math.floor(32 * 1024 * 1024 * 1024 * 0.1));
      // Eviction runs on the prompt hot path, so a single turn start can only pay for a few.
      expect(config.maxEvictionsPerCall).toBe(3);
    });

    it('reads env vars', () => {
      const original = {
        timeout: process.env.LODY_SESSION_GC_IDLE_TIMEOUT_MS,
        threshold: process.env.LODY_SESSION_GC_MEMORY_THRESHOLD_BYTES,
      };
      process.env.LODY_SESSION_GC_IDLE_TIMEOUT_MS = '300000';
      process.env.LODY_SESSION_GC_MEMORY_THRESHOLD_BYTES = '536870912';
      try {
        const config = loadGCConfig();
        expect(config.idleTimeoutMs).toBe(300000);
        expect(config.memoryThresholdBytes).toBe(536870912);
      } finally {
        if (original.timeout === undefined) delete process.env.LODY_SESSION_GC_IDLE_TIMEOUT_MS;
        else process.env.LODY_SESSION_GC_IDLE_TIMEOUT_MS = original.timeout;
        if (original.threshold === undefined)
          delete process.env.LODY_SESSION_GC_MEMORY_THRESHOLD_BYTES;
        else process.env.LODY_SESSION_GC_MEMORY_THRESHOLD_BYTES = original.threshold;
      }
    });
  });

  describe('sweep', () => {
    it('cleans sessions idle for longer than timeout', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;

      // s1 idle for 2000ms, s2 idle for 500ms
      sessionActivities.set(s1, now - 2000);
      sessionActivities.set(s2, now - 500);

      await manager.sweep();

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s1);
    });

    it('does not clean sessions with pending updates', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, now - 2000);
      pendingUpdates.add(s1);

      await manager.sweep();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('does not clean sessions with pending user work', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, now - 2000);
      pendingUserWork.add(s1);

      await manager.sweep();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('does not clean sessions with active turns', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, now - 2000);
      activeTurns.add(s1);

      await manager.sweep();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('does not clean sessions with active goals', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, now - 2000);
      activeGoals.add(s1);

      await manager.sweep();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('does not clean sessions in archive flight', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, now - 2000);
      archiveInFlight.add(s1);

      await manager.sweep();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('cleans longest-idle first', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;
      const s3 = 'session-3' as SessionId;

      sessionActivities.set(s1, now - 3000); // 3s idle
      sessionActivities.set(s2, now - 5000); // 5s idle
      sessionActivities.set(s3, now - 2000); // 2s idle

      await manager.sweep();

      expect(cleanMock).toHaveBeenCalledTimes(3);
      // Verify order: longest idle first
      expect(cleanMock.mock.calls[0]![0]).toBe(s2);
      expect(cleanMock.mock.calls[1]![0]).toBe(s1);
      expect(cleanMock.mock.calls[2]![0]).toBe(s3);
    });

    it('skips sessions that became active between candidate selection and cleanup', async () => {
      const manager = createManager({ idleTimeoutMs: 1000 });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, now - 2000);

      // Simulate the session becoming active during cleanup
      cleanMock.mockImplementationOnce(async () => {
        sessionActivities.set(s1, Date.now()); // touch the session
      });

      await manager.sweep();

      // It was called because it was eligible at candidate selection time
      expect(cleanMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('evictForMemoryPressure', () => {
    it('does nothing when memory is above threshold', async () => {
      const manager = createManager();
      const s1 = 'session-1' as SessionId;
      sessionActivities.set(s1, Date.now() - 60000);

      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 2 * 1024 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
      });

      await manager.evictForMemoryPressure();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('evicts longest-idle session when memory is below threshold', async () => {
      const manager = createManager();
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;

      sessionActivities.set(s1, now - 60000); // 60s idle
      sessionActivities.set(s2, now - 30000); // 30s idle

      // Start below threshold, go above after first eviction
      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 500 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 2 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        });

      await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s1); // longest idle first
    });

    it('evicts multiple sessions until memory is above threshold', async () => {
      const manager = createManager();
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;
      const s3 = 'session-3' as SessionId;

      sessionActivities.set(s1, now - 90000);
      sessionActivities.set(s2, now - 60000);
      sessionActivities.set(s3, now - 30000);

      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 500 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 700 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 1.5 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        });

      await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(2);
      expect(cleanMock.mock.calls[0]![0]).toBe(s1);
      expect(cleanMock.mock.calls[1]![0]).toBe(s2);
    });

    it('excludes the specified session from eviction', async () => {
      const manager = createManager();
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;

      sessionActivities.set(s1, now - 60000);
      sessionActivities.set(s2, now - 30000);

      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 500 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 2 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        });

      await manager.evictForMemoryPressure(s1); // exclude s1

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s2); // s1 excluded, so s2 is evicted
    });

    it('skips sessions with pending updates', async () => {
      const manager = createManager();
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;

      sessionActivities.set(s1, now - 60000);
      sessionActivities.set(s2, now - 30000);
      pendingUpdates.add(s1);

      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 500 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 2 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        });

      await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s2);
    });

    it('skips sessions with pending user work', async () => {
      const manager = createManager();
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;

      sessionActivities.set(s1, now - 60000);
      sessionActivities.set(s2, now - 30000);
      pendingUserWork.add(s1);

      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 500 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 2 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        });

      await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s2);
    });

    it('skips sessions with active goals', async () => {
      const manager = createManager();
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      const s2 = 'session-2' as SessionId;

      sessionActivities.set(s1, now - 60000);
      sessionActivities.set(s2, now - 30000);
      activeGoals.add(s1);

      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 500 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 2 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        });

      await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s2);
    });

    it('returns stillUnderPressure when nothing eligible can be evicted', async () => {
      const manager = createManager();
      const s1 = 'session-1' as SessionId;

      sessionActivities.set(s1, Date.now() - 60000);
      pendingUserWork.add(s1);
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 500 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
      });

      const result = await manager.evictForMemoryPressure();

      expect(cleanMock).not.toHaveBeenCalled();
      expect(result.stillUnderPressure).toBe(true);
      expect(result.evictedSessionIds).toEqual([]);
      expect(result.hadMemoryPressure).toBe(true);
    });

    it('treats low commit headroom as memory pressure on windows', async () => {
      const manager = createManager();
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 4 * 1024 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        availableCommitBytes: 256 * 1024 * 1024,
        commitLimitBytes: 40 * 1024 * 1024 * 1024,
        committedBytes: 39.75 * 1024 * 1024 * 1024,
      });

      const result = await manager.evictForMemoryPressure();

      expect(cleanMock).not.toHaveBeenCalled();
      expect(result.hadMemoryPressure).toBe(true);
      expect(result.stillUnderPressure).toBe(true);
      expect(result.pressureReason).toBe('commit');
      expect(result.commitThresholdBytes).toBe(1024 * 1024 * 1024);
    });

    it('evicts idle sessions to recover commit headroom on windows', async () => {
      const manager = createManager();
      const s1 = 'session-1' as SessionId;
      sessionActivities.set(s1, Date.now() - 60000);

      mockedGetMemoryPressureSnapshot
        .mockResolvedValueOnce({
          availableMemoryBytes: 4 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
          availableCommitBytes: 256 * 1024 * 1024,
          commitLimitBytes: 40 * 1024 * 1024 * 1024,
          committedBytes: 39.75 * 1024 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          availableMemoryBytes: 4 * 1024 * 1024 * 1024,
          effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
          availableCommitBytes: 2 * 1024 * 1024 * 1024,
          commitLimitBytes: 40 * 1024 * 1024 * 1024,
          committedBytes: 38 * 1024 * 1024 * 1024,
        });

      const result = await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(1);
      expect(cleanMock).toHaveBeenCalledWith(s1);
      expect(result.evictedSessionIds).toEqual([s1]);
      expect(result.stillUnderPressure).toBe(false);
      expect(result.pressureReason).toBeNull();
    });

    it('does nothing when disabled', async () => {
      const manager = createManager({ enabled: false });
      const s1 = 'session-1' as SessionId;
      sessionActivities.set(s1, Date.now() - 60000);
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 500 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
      });

      await manager.evictForMemoryPressure();

      expect(cleanMock).not.toHaveBeenCalled();
    });

    it('skips sessions with zero idle time', async () => {
      const manager = createManager();
      const s1 = 'session-1' as SessionId;

      // No lastActivity set → idleMs = 0
      sessionActivities.set(s1, Date.now());

      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 500 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
      });

      await manager.evictForMemoryPressure();

      expect(cleanMock).not.toHaveBeenCalled();
    });
  });

  describe('start/stop', () => {
    it('runs periodic sweep', async () => {
      const manager = createManager({
        idleTimeoutMs: 1000,
        sweepIntervalMs: 500,
      });
      const now = Date.now();
      const s1 = 'session-1' as SessionId;
      sessionActivities.set(s1, now - 2000);

      manager.start();

      await vi.advanceTimersByTimeAsync(600);

      expect(cleanMock).toHaveBeenCalledTimes(1);

      manager.stop();

      // Add another session
      const s2 = 'session-2' as SessionId;
      sessionActivities.set(s2, now - 2000);

      // Advance past another interval - should not sweep
      await vi.advanceTimersByTimeAsync(600);

      expect(cleanMock).toHaveBeenCalledTimes(1); // no new calls
    });

    it('does not start when disabled', () => {
      const manager = createManager({ enabled: false });
      manager.start();

      expect(loggerMock.debug).toHaveBeenCalledWith('[GC] Session GC is disabled');
    });
  });

  describe('evaluateMemoryPressure', () => {
    const GB = 1024 * 1024 * 1024;
    const thresholds = (platform: NodeJS.Platform) => ({
      platform,
      thresholdBytes: 1 * GB,
      commitThresholdBytes: 1 * GB,
    });

    describe('darwin', () => {
      // The byte figures below are deliberately "under pressure" by the Linux rule, to prove the
      // kernel level is the only input on macOS.
      const starvedBytes = {
        availableMemoryBytes: 100 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * GB,
      };

      it('does nothing at NORMAL even when available bytes look low', () => {
        expect(
          evaluateMemoryPressure({ ...starvedBytes, memoryPressureLevel: 1 }, thresholds('darwin'))
        ).toEqual({ evict: false, block: false, reason: null });
      });

      it('reclaims but does not refuse a turn at WARNING', () => {
        expect(
          evaluateMemoryPressure({ ...starvedBytes, memoryPressureLevel: 2 }, thresholds('darwin'))
        ).toEqual({ evict: true, block: false, reason: 'darwin_pressure_warning' });
      });

      it('reclaims and refuses a turn at CRITICAL', () => {
        expect(
          evaluateMemoryPressure({ ...starvedBytes, memoryPressureLevel: 4 }, thresholds('darwin'))
        ).toEqual({ evict: true, block: true, reason: 'darwin_pressure_critical' });
      });

      it('fails open when the kernel level is unavailable', () => {
        // Must NOT fall back to the byte thresholds: they misreport pressure on healthy Macs.
        expect(evaluateMemoryPressure(starvedBytes, thresholds('darwin'))).toEqual({
          evict: false,
          block: false,
          reason: null,
        });
      });
    });

    describe('linux', () => {
      it('reclaims and refuses together below the threshold', () => {
        expect(
          evaluateMemoryPressure(
            { availableMemoryBytes: 500 * 1024 * 1024, effectiveMemoryLimitBytes: 32 * GB },
            thresholds('linux')
          )
        ).toEqual({ evict: true, block: true, reason: 'physical' });
      });

      it('does nothing above the threshold', () => {
        expect(
          evaluateMemoryPressure(
            { availableMemoryBytes: 4 * GB, effectiveMemoryLimitBytes: 32 * GB },
            thresholds('linux')
          )
        ).toEqual({ evict: false, block: false, reason: null });
      });

      it('ignores a kernel level that should never be present off macOS', () => {
        expect(
          evaluateMemoryPressure(
            {
              availableMemoryBytes: 4 * GB,
              effectiveMemoryLimitBytes: 32 * GB,
              memoryPressureLevel: 4,
            },
            thresholds('linux')
          )
        ).toEqual({ evict: false, block: false, reason: null });
      });
    });

    describe('win32', () => {
      it('reports commit pressure on its own', () => {
        expect(
          evaluateMemoryPressure(
            {
              availableMemoryBytes: 4 * GB,
              effectiveMemoryLimitBytes: 32 * GB,
              availableCommitBytes: 100 * 1024 * 1024,
            },
            thresholds('win32')
          )
        ).toEqual({ evict: true, block: true, reason: 'commit' });
      });

      it('reports both when physical and commit are exhausted', () => {
        expect(
          evaluateMemoryPressure(
            {
              availableMemoryBytes: 500 * 1024 * 1024,
              effectiveMemoryLimitBytes: 32 * GB,
              availableCommitBytes: 100 * 1024 * 1024,
            },
            thresholds('win32')
          )
        ).toEqual({ evict: true, block: true, reason: 'physical_and_commit' });
      });
    });
  });

  describe('evictForMemoryPressure on darwin', () => {
    const idleSessions = (count: number) => {
      const now = Date.now();
      for (let i = 0; i < count; i++) {
        // Descending idle time so eviction order is deterministic: session-0 is the stalest.
        sessionActivities.set(`session-${i}` as SessionId, now - (count - i) * 60_000);
      }
    };

    it('reclaims idle sessions at WARNING without failing the turn', async () => {
      const manager = createManager({ maxEvictionsPerCall: 100 }, 'darwin');
      idleSessions(2);
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 100 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        memoryPressureLevel: 2,
      });

      const result = await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(2);
      expect(result.hadMemoryPressure).toBe(true);
      expect(result.stillUnderPressure).toBe(false);
      expect(result.pressureReason).toBe('darwin_pressure_warning');
    });

    it('fails the turn at CRITICAL', async () => {
      const manager = createManager({}, 'darwin');
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 100 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        memoryPressureLevel: 4,
      });

      const result = await manager.evictForMemoryPressure();

      expect(result.stillUnderPressure).toBe(true);
      expect(result.pressureReason).toBe('darwin_pressure_critical');
      expect(result.memoryPressureLevel).toBe(4);
    });

    it('does not act on low available bytes when the kernel reports NORMAL', async () => {
      const manager = createManager({}, 'darwin');
      idleSessions(2);
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        // Well under memoryThresholdBytes — the old heuristic would have evicted and blocked here.
        availableMemoryBytes: 100 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        memoryPressureLevel: 1,
      });

      const result = await manager.evictForMemoryPressure();

      expect(cleanMock).not.toHaveBeenCalled();
      expect(result.hadMemoryPressure).toBe(false);
      expect(result.stillUnderPressure).toBe(false);
    });

    it('bounds evictions per call so a turn start is not stalled', async () => {
      const manager = createManager({ maxEvictionsPerCall: 3 }, 'darwin');
      idleSessions(10);
      mockedGetMemoryPressureSnapshot.mockResolvedValue({
        availableMemoryBytes: 100 * 1024 * 1024,
        effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
        memoryPressureLevel: 2,
      });

      await manager.evictForMemoryPressure();

      expect(cleanMock).toHaveBeenCalledTimes(3);
      expect(cleanMock.mock.calls.map(([id]) => id)).toEqual([
        'session-0',
        'session-1',
        'session-2',
      ]);
    });
  });
});
