import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SessionId } from '@lody/shared';
import { SessionGCManager, SessionGCConfig, loadGCConfig } from './session-gc-manager';

// Mock the memory utility
vi.mock('@/utils/memory', () => ({
  getMemoryPressureSnapshot: vi.fn(async () => ({
    availableMemoryBytes: 4 * 1024 * 1024 * 1024,
    effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
  })),
  getEffectiveMemoryLimitBytes: vi.fn(() => 32 * 1024 * 1024 * 1024), // 32 GB by default
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

  const createManager = (config?: Partial<SessionGCConfig>) => {
    const defaultConfig: SessionGCConfig = {
      idleTimeoutMs: 20 * 60 * 1000, // 20 minutes
      sweepIntervalMs: 60 * 1000, // 1 minute
      enabled: true,
      memoryThresholdBytes: 1024 * 1024 * 1024, // 1 GB
      ...config,
    };
    return new SessionGCManager(defaultConfig, {
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
    });
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
});
