import { describe, expect, it } from 'vitest';

import {
  classifyPermissionModeFace,
  getBuiltinDefaultModeId,
  getManagedBuiltinRuntimeByAgentType,
  getManagedBuiltinRuntimeByRuntimeName,
  getStaticBuiltinAcpCapabilities,
  hasBuiltinRuntimeOverrideValues,
  isBuiltinAgentType,
} from '../src/ai';

describe('builtin Grok shared contract', () => {
  it('maps the Grok agent to its managed runtime in both directions', () => {
    expect(isBuiltinAgentType('grok')).toBe(true);
    expect(getManagedBuiltinRuntimeByAgentType('grok')).toEqual({
      runtimeName: 'grok-build',
      agentType: 'grok',
      displayName: 'Grok',
    });
    expect(getManagedBuiltinRuntimeByRuntimeName('grok-build')?.agentType).toBe('grok');
  });

  it('mirrors the config options exposed by the official-runtime compatibility adapter', () => {
    const capabilities = getStaticBuiltinAcpCapabilities('builtin', 'grok');

    expect(capabilities?.modes.map((mode) => mode.id)).toEqual(['default', 'plan', 'ask']);
    expect(capabilities?.models.map((model) => model.modelId)).toEqual(['grok-build']);
    expect(capabilities?.configOptions.map((option) => option.id)).toEqual([
      'interaction_mode',
      'permission_mode',
      'model',
      'reasoning_effort',
    ]);
    expect(capabilities?.configOptions[0]?.currentValue).toBe('agent');
    expect(capabilities?.configOptions[1]?.options.map((option) => option.value)).toEqual([
      'ask',
      'always-approve',
    ]);
    expect(getBuiltinDefaultModeId('builtin', 'grok')).toBe('agent');
    expect(classifyPermissionModeFace('always-approve')).toEqual({
      kind: 'full-access',
      tone: 'warning',
      render: 'icon',
    });
  });

  it('invalidates static capabilities when a Grok override is present', () => {
    expect(hasBuiltinRuntimeOverrideValues({ grokPath: ' /opt/grok ' })).toBe(true);
    expect(
      getStaticBuiltinAcpCapabilities('builtin', 'grok', { grokPath: '/opt/grok' })
    ).toBeUndefined();
  });
});
