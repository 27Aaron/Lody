import { describe, expect, it } from 'vitest';
import { getChatFailedDiagnosticCopy } from '../src/components/ai-gui/chat-failed-diagnostic-copy';

describe('chat failed diagnostic copy', () => {
  it('provides actionable copy for a missing Git executable', () => {
    expect(getChatFailedDiagnosticCopy('git_executable_not_found')).toEqual({
      titleKey: 'sessions.systemNotices.chatFailed.gitExecutableNotFound',
      title: 'Git executable was not found on the target machine',
      actionKey: 'sessions.systemNotices.chatFailed.gitExecutableNotFoundAction',
      action:
        'Install Git for Windows or add git.exe to PATH, fully restart Lody/CLI, verify “git --version” in a new terminal, then try again.',
    });
  });

  it('leaves generic failures without diagnostic copy', () => {
    expect(getChatFailedDiagnosticCopy(undefined)).toBeNull();
  });
});
