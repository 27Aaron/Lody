import { describe, expect, it } from 'vitest';
import { getSessionFileErrorPresentation } from '../src/components/sessions/session-file-error-state';

const t = (_key: string, fallback: string) => fallback;

describe('getSessionFileErrorPresentation', () => {
  it('turns workspace escape diagnostics into a clear security explanation', () => {
    expect(getSessionFileErrorPresentation('Path escapes workspace root.', undefined, t)).toEqual({
      kind: 'outside-workspace',
      title: 'File is outside the workspace',
      description:
        'For security, Lody can only read files inside this session’s workspace. Choose a file from the workspace and try again.',
    });
  });

  it('uses structured provider reasons for actionable file errors', () => {
    expect(getSessionFileErrorPresentation('Text too large', 'text-too-large', t)).toMatchObject({
      kind: 'too-large',
      title: 'File is too large to preview',
    });
    expect(
      getSessionFileErrorPresentation('Permission denied', 'permission-denied', t)
    ).toMatchObject({
      kind: 'permission-denied',
      title: 'Access denied',
    });
  });

  it('keeps unexpected diagnostics behind technical details', () => {
    expect(getSessionFileErrorPresentation('RPC failed with code -32000', undefined, t)).toEqual({
      kind: 'unknown',
      title: 'Could not open this file',
      description:
        'Lody could not read this file. Try again, or check the file on the host machine.',
      technicalDetails: 'RPC failed with code -32000',
    });
  });

  it('classifies an unavailable session worktree as a host availability problem', () => {
    expect(
      getSessionFileErrorPresentation('Session worktree is unavailable.', undefined, t)
    ).toMatchObject({ kind: 'temporarily-unavailable' });
  });
});
