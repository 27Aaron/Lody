import { describe, expect, it, vi } from 'vitest';
import type { MachineId, WorkspaceId } from '@lody/shared';
import {
  formatBugReportLogDate,
  mergeBugReportLogs,
  submitBugReportFromMachine,
  tailOfLog,
} from './bug-report';

describe('formatBugReportLogDate', () => {
  it('formats with zero padding', () => {
    expect(formatBugReportLogDate(new Date(2026, 5, 3))).toBe('2026-06-03');
    expect(formatBugReportLogDate(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

describe('tailOfLog', () => {
  it('returns full content when under the limit', () => {
    expect(tailOfLog('hello', 10)).toEqual({ text: 'hello', truncated: false });
  });

  it('keeps only the tail when over the limit', () => {
    const result = tailOfLog('abcdefgh', 4);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('efgh');
  });
});

describe('mergeBugReportLogs', () => {
  it('joins log files with headers and truncation markers', () => {
    const merged = mergeBugReportLogs([
      { fileName: '2026-06-10.log', content: 'yesterday', truncated: false },
      { fileName: '2026-06-11.log', content: 'today', truncated: true },
    ]);
    expect(merged).toBe(
      '===== 2026-06-10.log =====\nyesterday\n\n===== 2026-06-11.log =====\n' +
        '...[truncated: only the tail of this log file is included]\ntoday'
    );
  });

  it('returns an empty string when there are no log files', () => {
    expect(mergeBugReportLogs([])).toBe('');
  });
});

describe('submitBugReportFromMachine machine-access gate', () => {
  const baseArgs = {
    workspaceId: 'ws_1' as WorkspaceId,
    machineId: 'machine_1' as MachineId,
    description: 'something broke',
    requestToken: 'token',
    machineUserId: 'owner_user',
    token: 'cli-token',
    siteUrl: 'https://auth.example.test',
    logger: { info: () => {}, warn: () => {} },
    checkMachineAccess: vi.fn().mockResolvedValue({ allowed: true }),
  };

  it('denies non-owner requesters that fail the machine-access check', async () => {
    const checkMachineAccess = vi.fn().mockResolvedValue({ allowed: false, reason: 'not_visible' });
    const response = await submitBugReportFromMachine({
      ...baseArgs,
      reporterUserId: 'other_user',
      checkMachineAccess,
    });
    expect(response.success).toBe(false);
    expect(response.error).toContain('not allowed');
    expect(checkMachineAccess).toHaveBeenCalledWith({
      token: 'cli-token',
      workspaceId: 'ws_1',
      machineId: 'machine_1',
      requesterUserId: 'other_user',
    });
  });

  it('fails closed when the machine-access check errors', async () => {
    const checkMachineAccess = vi.fn().mockRejectedValue(new Error('convex unreachable'));
    const response = await submitBugReportFromMachine({
      ...baseArgs,
      reporterUserId: 'other_user',
      checkMachineAccess,
    });
    expect(response.success).toBe(false);
    expect(response.error).toContain('Could not verify machine access');
  });

  it('skips the remote check for the machine operator', async () => {
    const checkMachineAccess = vi.fn();
    // The stubbed upload fails; what matters is that the gate lets the owner
    // through without consulting the access oracle.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'nope',
      })
    );
    try {
      const response = await submitBugReportFromMachine({
        ...baseArgs,
        reporterUserId: 'owner_user',
        checkMachineAccess,
      });
      expect(checkMachineAccess).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
