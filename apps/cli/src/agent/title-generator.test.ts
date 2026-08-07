import { describe, expect, it, vi } from 'vitest';
import type { ACPSessionId, AcpSessionNotification } from '@lody/shared';

import { applyTitleConfigOptions, extractTitleChunkFromNotification } from './title-generator';

const agentMessage = (text: string, phase?: string): AcpSessionNotification => ({
  sessionId: 'title-session',
  update: {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
    ...(phase ? { _meta: { codex: { phase } } } : {}),
  },
});

describe('extractTitleChunkFromNotification', () => {
  it('ignores Codex commentary status text', () => {
    expect(extractTitleChunkFromNotification(agentMessage('Reconnecting...', 'commentary'))).toBe(
      null
    );
  });

  it('accepts the Codex final answer', () => {
    expect(
      extractTitleChunkFromNotification(agentMessage('Fix session title', 'final_answer'))
    ).toBe('Fix session title');
  });

  it('keeps compatibility with ACP agents that do not provide phase metadata', () => {
    expect(extractTitleChunkFromNotification(agentMessage('Fix session title'))).toBe(
      'Fix session title'
    );
  });
});

describe('applyTitleConfigOptions', () => {
  it('applies a synthetic legacy model selection before title prompting', async () => {
    const setSessionConfigOption = vi.fn(async () => undefined);
    const unstableSetSessionModel = vi.fn(async () => {});

    await applyTitleConfigOptions({
      client: {
        setSessionConfigOption,
        unstable_setSessionModel: unstableSetSessionModel,
      },
      acpSessionId: 'title-session' as ACPSessionId,
      sessionResponse: {
        sessionId: 'title-session',
        models: {
          currentModelId: 'grok-4.5',
          availableModels: [
            { modelId: 'grok-4.5', name: 'Grok 4.5' },
            { modelId: 'grok-code-fast-1', name: 'Grok Code Fast 1' },
          ],
        },
      },
      configOptionValues: { model: 'grok-code-fast-1' },
      logger: { debug: vi.fn() } as never,
    });

    expect(unstableSetSessionModel).toHaveBeenCalledWith('title-session', 'grok-code-fast-1');
    expect(setSessionConfigOption).not.toHaveBeenCalled();
  });
});
