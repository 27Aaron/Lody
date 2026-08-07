import { describe, expect, it } from 'vitest';
import { readDesktopMachinePairingRequestId } from '../src/lib/desktop-machine-pairing-deep-link';

describe('desktop machine pairing deep links', () => {
  it('reads only the non-secret request id', () => {
    const url = 'lody://machine/connect?requestId=request-123';
    expect(readDesktopMachinePairingRequestId(url)).toBe('request-123');
    expect(url).not.toContain('auth');
    expect(url).not.toContain('token');
  });

  it('rejects unrelated lody links', () => {
    expect(readDesktopMachinePairingRequestId('lody://auth/callback?requestId=request-123')).toBe(
      null
    );
  });
});
