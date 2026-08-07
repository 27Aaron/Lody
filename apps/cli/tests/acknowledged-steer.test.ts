import { describe, expect, it } from 'vitest';
import {
  buildSteerRequestMeta,
  findActiveSteerConfigMismatch,
  parseAcknowledgedSteerCapability,
} from '../src/agent/acknowledged-steer';

describe('acknowledged steer protocol', () => {
  it('normalizes Codex same-turn and Claude handoff capabilities', () => {
    const codex = parseAcknowledgedSteerCapability({
      codex: {
        steer: {
          version: 1,
          method: '_session/steering',
          appliedNotification: '_codex/steerApplied',
          upstreamTurn: 'same',
          configPolicy: 'active',
        },
      },
    });
    const claude = parseAcknowledgedSteerCapability({
      claudeCode: {
        steer: { version: 1, appliedNotification: '_claude/steerApplied' },
      },
    });

    expect(codex).toMatchObject({
      provider: 'codex',
      requestMethod: '_session/steering',
      appliedNotificationMethod: 'codex/steerApplied',
      upstreamTurn: 'same',
      configPolicy: 'active',
    });
    expect(claude).toMatchObject({
      provider: 'claudeCode',
      upstreamTurn: 'handoff',
      configPolicy: 'apply',
    });
    expect(buildSteerRequestMeta(codex!, 'steer-1')).toBeUndefined();
  });

  it('fails closed when requested configuration differs from the active Codex turn', () => {
    const options = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select' as const,
        currentValue: 'gpt-5.4',
        options: [],
      },
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select' as const,
        currentValue: 'default',
        options: [],
      },
      {
        id: 'reasoning_effort',
        name: 'Reasoning',
        type: 'select' as const,
        currentValue: 'high',
        options: [],
      },
    ];

    expect(
      findActiveSteerConfigMismatch(
        {
          modelId: 'gpt-5.4',
          modeId: 'default',
          configOptionValues: { reasoning_effort: 'high' },
        },
        options,
        'gpt-5.4'
      )
    ).toBeNull();
    expect(
      findActiveSteerConfigMismatch(
        {
          modelId: 'gpt-5.3',
          modeId: 'plan',
          configOptionValues: { reasoning_effort: 'medium' },
        },
        options,
        'gpt-5.4'
      )
    ).toContain('model requested gpt-5.3');
  });
});
