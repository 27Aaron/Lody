import { describe, expect, it } from 'vitest';

import {
  getBuiltinAgentByAgentType,
  getBuiltinDefaultModeId,
  getManagedBuiltinRuntimeByAgentType,
  getStaticBuiltinAcpCapabilities,
  isBuiltinAgentType,
  isManagedBuiltinAgentType,
} from '../src/ai';
import { supportsBuiltinAuthentication } from '../src/agent-authentication';

describe('builtin DeepSeek Harness shared contract', () => {
  it('is builtin without being a managed-download runtime', () => {
    expect(isBuiltinAgentType('deepseek')).toBe(true);
    expect(isManagedBuiltinAgentType('deepseek')).toBe(false);
    expect(getManagedBuiltinRuntimeByAgentType('deepseek')).toBeUndefined();
    expect(getBuiltinAgentByAgentType('deepseek')).toEqual({
      agentType: 'deepseek',
      displayName: 'DeepSeek Harness',
    });
  });

  it('publishes the selectors implemented by the Lody ACP adapter', () => {
    const capabilities = getStaticBuiltinAcpCapabilities('builtin', 'deepseek');

    expect(capabilities?.modes.map((mode) => mode.id)).toEqual([
      'read-only',
      'workspace-write',
      'danger-full-access',
    ]);
    expect(capabilities?.models.map((model) => model.modelId)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
    expect(capabilities?.configOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mode', category: 'mode' }),
        expect.objectContaining({
          id: 'agent_preset',
          category: 'agent_preset',
          currentValue: 'standard',
          options: expect.arrayContaining([
            expect.objectContaining({ value: 'standard' }),
            expect.objectContaining({ value: 'code' }),
            expect.objectContaining({ value: 'minimal' }),
            expect.objectContaining({ value: 'cordis' }),
          ]),
        }),
        expect.objectContaining({ id: 'model', category: 'model' }),
        expect.objectContaining({
          id: 'reasoning_effort',
          category: 'thought_level',
          currentValue: 'max',
        }),
      ])
    );
    expect(getBuiltinDefaultModeId('builtin', 'deepseek')).toBe('workspace-write');
  });

  it('uses environment credentials instead of managed interactive authentication', () => {
    expect(
      supportsBuiltinAuthentication({
        cliType: 'builtin',
        agentType: 'deepseek',
        env: { DEEPSEEK_API_KEY: 'test-key' },
      })
    ).toBe(false);
  });
});
