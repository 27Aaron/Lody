import { describe, expect, it } from 'vitest';
import {
  getAvailableMemoryBytes,
  parseDarwinAvailableMemoryBytes,
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
