import { describe, expect, it } from 'vitest';

import { buildPrompt } from '../src/session/session-execution-helpers';

describe('session execution prompt helpers', () => {
  it('does not inject image upload curl instructions into local prompts', () => {
    const prompt = buildPrompt('inspect the UI');

    expect(prompt).toMatch(/^inspect the UI(?:\n\n|$)/);
    expect(prompt).toContain('lody_upload_images');
    expect(prompt).toContain('lody_upload_files');
    expect(prompt).toContain('workspace-relative path');
    expect(prompt).toContain('send, attach, share');
    expect(prompt).toContain('lody_report_preview_candidate');
    expect(prompt).toContain('bar directly above the message input');
    expect(prompt).not.toContain('conversation header');
    expect(prompt).not.toContain('/image-upload');
    expect(prompt).not.toContain('x-lody-local-control');
    expect(prompt).not.toContain('curl');
  });

  it('keeps GitHub worktree instructions without image upload curl instructions', () => {
    const prompt = buildPrompt('fix the bug', {
      kind: 'github',
      repoFullName: 'owner/repo',
      branch: 'feature',
    });

    expect(prompt).toContain('Name branches based on the task content');
    expect(prompt).not.toContain('/image-upload');
    expect(prompt).not.toContain('x-lody-local-control');
    expect(prompt).not.toContain('curl');
  });
});
