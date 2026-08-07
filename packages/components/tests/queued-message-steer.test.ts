import { describe, expect, it } from 'vitest';
import { shouldRequestNativeQueueSteer } from '../src/components/sessions/message-queue/queued-message-steer';

describe('shouldRequestNativeQueueSteer', () => {
  it.each([
    [{ cliType: 'builtin', agentType: 'claude' }, true],
    [{ cliType: 'builtin', agentType: 'codex' }, true],
    [{ cliType: 'builtin', agentType: 'kimi' }, false],
    [{ cliType: 'registry', agentType: 'claude' }, false],
    [{ cliType: 'registry', agentType: 'gemini' }, false],
    [{ cliType: 'custom', agentType: 'custom-agent' }, false],
  ] as const)('routes %o to native steer: %s', (session, expected) => {
    expect(shouldRequestNativeQueueSteer(session)).toBe(expected);
  });
});
