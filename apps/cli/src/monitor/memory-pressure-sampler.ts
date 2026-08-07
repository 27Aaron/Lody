import {
  LODY_MACHINE_MONITOR_MACOS_SAMPLE_MS,
  LODY_MACHINE_MONITOR_UNIX_SAMPLE_MS,
  LODY_MACHINE_MONITOR_WINDOWS_SAMPLE_MS,
} from '@lody/shared';
import type { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import { getMemoryPressureSnapshot, type MemoryPressureSnapshot } from '@/utils/memory';

export type MemoryPressureSnapshotSource = {
  getLatest(): Promise<MemoryPressureSnapshot>;
  refresh(): Promise<MemoryPressureSnapshot>;
};

type MemoryPressureSamplerOptions = {
  probe?: () => Promise<MemoryPressureSnapshot>;
  now?: () => number;
  sampleIntervalMs?: number;
  maxStaleMs?: number;
};

function platformSampleIntervalMs(): number {
  return process.platform === 'win32'
    ? LODY_MACHINE_MONITOR_WINDOWS_SAMPLE_MS
    : process.platform === 'darwin'
      ? LODY_MACHINE_MONITOR_MACOS_SAMPLE_MS
      : LODY_MACHINE_MONITOR_UNIX_SAMPLE_MS;
}

/**
 * Process-wide memory sampler shared by every workspace runtime.
 *
 * OS probes such as macOS `vm_stat` are intentionally kept off the prompt hot
 * path. A bounded-staleness snapshot is safe for the GC admission heuristic;
 * actual eviction always forces a fresh sample before deciding whether to
 * evict another session.
 */
export class MemoryPressureSampler implements MemoryPressureSnapshotSource {
  private readonly probe: () => Promise<MemoryPressureSnapshot>;
  private readonly now: () => number;
  private readonly sampleIntervalMs: number;
  private readonly maxStaleMs: number;
  private cached: { snapshot: MemoryPressureSnapshot; sampledAtMs: number } | null = null;
  private inFlight: Promise<MemoryPressureSnapshot> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly logger: Logger,
    options: MemoryPressureSamplerOptions = {}
  ) {
    this.probe = options.probe ?? getMemoryPressureSnapshot;
    this.now = options.now ?? (() => performance.now());
    this.sampleIntervalMs = options.sampleIntervalMs ?? platformSampleIntervalMs();
    this.maxStaleMs = options.maxStaleMs ?? this.sampleIntervalMs * 3;
  }

  start(): void {
    if (this.timer) return;
    void this.refresh().catch((error: unknown) => {
      this.logger.debug(`Initial memory pressure sample failed: ${formatErrorMessage(error)}`);
    });
    this.timer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        this.logger.debug(`Memory pressure sample failed: ${formatErrorMessage(error)}`);
      });
    }, this.sampleIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async getLatest(): Promise<MemoryPressureSnapshot> {
    const cached = this.cached;
    if (!cached) {
      return await this.refresh();
    }

    const ageMs = Math.max(0, this.now() - cached.sampledAtMs);
    if (ageMs >= this.sampleIntervalMs) {
      void this.refresh().catch((error: unknown) => {
        this.logger.debug(`Memory pressure refresh failed: ${formatErrorMessage(error)}`);
      });
    }
    if (ageMs <= this.maxStaleMs) {
      return cached.snapshot;
    }
    return await this.refresh();
  }

  async refresh(): Promise<MemoryPressureSnapshot> {
    if (this.inFlight) {
      return await this.inFlight;
    }

    const operation = this.probe().then((snapshot) => {
      this.cached = { snapshot, sampledAtMs: this.now() };
      return snapshot;
    });
    this.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    }
  }
}
