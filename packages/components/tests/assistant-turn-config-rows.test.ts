import { describe, expect, it } from 'vitest';
import { MODEL_THOUGHT_LEVEL_META_KEY } from '@lody/shared';
import { buildAssistantTurnConfigRows } from '../src/components/ai-gui/view';

describe('buildAssistantTurnConfigRows', () => {
  it('lists model, mode, reasoning, plan and fast from turn config', () => {
    const rows = buildAssistantTurnConfigRows(
      {
        modelId: 'gpt-5.6',
        name: 'GPT-5.6-Luna',
        _meta: { [MODEL_THOUGHT_LEVEL_META_KEY]: 'Medium' },
      },
      {
        modeId: 'acceptEdits',
        configOptionValues: {
          'reasoning_effort': 'medium',
          'fast-mode': true,
          'plan-mode': 'off',
        },
      }
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        { label: 'Model', value: 'GPT-5.6-Luna' },
        { label: 'Mode', value: 'Accept edits' },
        { label: 'Reasoning', value: 'Medium' },
        { label: 'Fast mode', value: 'On' },
        { label: 'Plan mode', value: 'Off' },
      ])
    );
  });

  it('does not require inputConfig when only model meta is present', () => {
    const rows = buildAssistantTurnConfigRows({
      modelId: 'opus',
      name: 'Opus 4.5',
      _meta: { [MODEL_THOUGHT_LEVEL_META_KEY]: 'High' },
    });
    expect(rows).toEqual([
      { label: 'Model', value: 'Opus 4.5' },
      { label: 'Reasoning', value: 'High' },
    ]);
  });
});
