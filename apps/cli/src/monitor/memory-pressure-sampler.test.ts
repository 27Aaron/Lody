import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@/utils/logger';
import type { MemoryPressureSnapshot } from '@/utils/memory';
import { MemoryPressureSampler } from './memory-pressure-sampler';

const snapshot = (availableMemoryBytes: number): MemoryPressureSnapshot => ({
  availableMemoryBytes,
  effectiveMemoryLimitBytes: 32 * 1024 * 1024 * 1024,
});

const logger = { debug: vi.fn() } as unknown as Logger;

describe('MemoryPressureSampler', () => {
  it('coalesces concurrent OS probes', async () => {
    let resolveProbe: ((value: MemoryPressureSnapshot) => void) | undefined;
    const probe = vi.fn(
      async () =>
        await new Promise<MemoryPressureSnapshot>((resolve) => {
          resolveProbe = resolve;
        })
    );
    const sampler = new MemoryPressureSampler(logger, { probe });

    const first = sampler.refresh();
    const second = sampler.refresh();
    expect(probe).toHaveBeenCalledTimes(1);

    const sampled = snapshot(4_000);
    resolveProbe?.(sampled);
    await expect(first).resolves.toBe(sampled);
    await expect(second).resolves.toBe(sampled);
  });

  it('returns a recent snapshot immediately and refreshes aging data in background', async () => {
    let now = 0;
    const first = snapshot(4_000);
    const second = snapshot(3_000);
    const probe = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const sampler = new MemoryPressureSampler(logger, {
      probe,
      now: () => now,
      sampleIntervalMs: 100,
      maxStaleMs: 300,
    });

    await sampler.refresh();
    now = 150;
    await expect(sampler.getLatest()).resolves.toBe(first);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    await expect(sampler.getLatest()).resolves.toBe(second);
  });

  it('waits for a fresh probe when the cached snapshot exceeds the stale bound', async () => {
    let now = 0;
    const first = snapshot(4_000);
    const second = snapshot(2_000);
    const probe = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const sampler = new MemoryPressureSampler(logger, {
      probe,
      now: () => now,
      sampleIntervalMs: 100,
      maxStaleMs: 300,
    });

    await sampler.refresh();
    now = 301;

    await expect(sampler.getLatest()).resolves.toBe(second);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
