import { describe, expect, it } from 'vitest';
import {
  computeCgroupReclaimableBytes,
  getAvailableMemoryBytes,
  parseCgroupMemoryEvents,
  parseCgroupMemoryStat,
  parseCgroupPressureSomeAvg10,
  parseDarwinAvailableMemoryBytes,
  parseDarwinPressureLevel,
  parseWindowsMemoryStatus,
} from './memory';

describe('getAvailableMemoryBytes', () => {
  it('returns a positive number', () => {
    const result = getAvailableMemoryBytes();
    expect(result).toBeGreaterThan(0);
  });

  it('returns a number in a reasonable range (> 10MB)', () => {
    const result = getAvailableMemoryBytes();
    // Any modern system should have at least 10MB available
    expect(result).toBeGreaterThan(10 * 1024 * 1024);
  });

  it('parses reclaimable memory from vm_stat output on darwin', () => {
    const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                8177.
Pages active:                            189421.
Pages inactive:                          187645.
Pages speculative:                          904.
Pages wired down:                        156602.
Pages purgeable:                           3890.
File-backed pages:                       124000.
`;

    const result = parseDarwinAvailableMemoryBytes(output);

    expect(result).toBe((8177 + 904 + 3890 + Math.min(124000, 187645)) * 16384);
  });

  it('returns null when vm_stat output is malformed', () => {
    expect(parseDarwinAvailableMemoryBytes('not vm_stat')).toBeNull();
  });

  it('parses windows available bytes and commit headroom', () => {
    const result = parseWindowsMemoryStatus(
      '{"AvailableBytes":2147483648,"CommitLimit":34359738368,"CommittedBytes":32212254720}'
    );

    expect(result).toEqual({
      availableBytes: 2147483648,
      commitLimitBytes: 34359738368,
      committedBytes: 32212254720,
      availableCommitBytes: 2147483648,
    });
  });

  it('returns null when windows memory JSON is malformed', () => {
    expect(parseWindowsMemoryStatus('{"AvailableBytes":"nope"}')).toBeNull();
  });
});

describe('cgroup v2 memory parsing', () => {
  // Trimmed from a real /sys/fs/cgroup/.../memory.stat.
  const memoryStat = `anon 4054687744
file 12066566144
kernel 812345678
slab_reclaimable 646001912
slab_unreclaimable 5114080
file_dirty 1732608
file_writeback 0
inactive_anon 4000000000
active_anon 54687744
inactive_file 2449469440
active_file 9617096704
`;

  it('reads the file and slab counters it needs', () => {
    expect(parseCgroupMemoryStat(memoryStat)).toEqual({
      inactiveFileBytes: 2449469440,
      activeFileBytes: 9617096704,
      slabReclaimableBytes: 646001912,
      dirtyBytes: 1732608,
    });
  });

  it('treats a missing memory.stat as all zeroes rather than throwing', () => {
    expect(parseCgroupMemoryStat('')).toEqual({
      inactiveFileBytes: 0,
      activeFileBytes: 0,
      slabReclaimableBytes: 0,
      dirtyBytes: 0,
    });
  });

  it('credits clean inactive file cache and half of reclaimable slab', () => {
    const stat = parseCgroupMemoryStat(memoryStat);
    expect(computeCgroupReclaimableBytes(stat)).toBe(
      2449469440 - 1732608 + Math.floor(646001912 / 2)
    );
  });

  it('excludes active file cache, which is why a stall signal gates blocking', () => {
    const stat = parseCgroupMemoryStat(memoryStat);
    expect(computeCgroupReclaimableBytes(stat)).toBeLessThan(stat.activeFileBytes);
  });

  it('never credits dirty pages that must be written out first', () => {
    expect(
      computeCgroupReclaimableBytes({
        inactiveFileBytes: 1000,
        activeFileBytes: 0,
        slabReclaimableBytes: 0,
        dirtyBytes: 4000,
      })
    ).toBe(0);
  });

  it('reads the PSI some avg10 stall share', () => {
    const pressure = `some avg10=12.34 avg60=4.00 avg300=1.00 total=68381479
full avg10=6.00 avg60=2.00 avg300=0.50 total=62637781
`;
    expect(parseCgroupPressureSomeAvg10(pressure)).toBe(12.34);
    // "full" must not be mistaken for "some": it is a strictly smaller number.
    expect(parseCgroupPressureSomeAvg10('full avg10=6.00 avg60=2.00\n')).toBeNull();
    expect(parseCgroupPressureSomeAvg10('')).toBeNull();
  });

  it('reads the throttle event counters', () => {
    const events = `low 0
high 17
max 3
oom 0
oom_kill 0
`;
    expect(parseCgroupMemoryEvents(events)).toEqual({ high: 17, max: 3 });
    expect(parseCgroupMemoryEvents('low 0\n')).toBeNull();
    expect(parseCgroupMemoryEvents('')).toBeNull();
  });
});

describe('parseDarwinPressureLevel', () => {
  it('parses the three levels the kernel can report', () => {
    // `sysctl -n` emits a bare integer plus a trailing newline.
    expect(parseDarwinPressureLevel('1\n')).toBe(1);
    expect(parseDarwinPressureLevel('2\n')).toBe(2);
    expect(parseDarwinPressureLevel('4\n')).toBe(4);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDarwinPressureLevel('  4  ')).toBe(4);
  });

  it.each([
    ['empty output', ''],
    ['sysctl error text', 'sysctl: unknown oid'],
    ['a level this code does not understand', '3'],
    ['a non-integer', '2.5'],
  ])('returns null for %s so the caller fails open', (_label, raw) => {
    expect(parseDarwinPressureLevel(raw)).toBeNull();
  });
});
