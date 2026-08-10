import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { AcpSelectorOptions } from '../src/components/shared/acp-selector-options';
import { localizeBuiltinGrokSelectorOptions } from '../src/lib/grok-acp-selector-i18n';

const options: AcpSelectorOptions = {
  capabilityAuthority: 'provisional',
  modeOptions: [],
  modelOptions: [],
  defaultModeId: null,
  defaultModelId: 'grok-build',
  configOptionSelectors: [
    {
      configId: 'interaction_mode',
      label: 'Interaction Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'agent',
      options: [
        { value: 'agent', label: 'Agent' },
        { value: 'plan', label: 'Plan' },
        { value: 'ask', label: 'Ask' },
      ],
    },
    {
      configId: 'permission_mode',
      label: 'Permission Mode',
      category: '_permission',
      type: 'select',
      currentValue: 'ask',
      options: [
        { value: 'ask', label: 'Ask Every Time' },
        { value: 'always-approve', label: 'Always Approve' },
      ],
    },
  ],
};

describe('localizeBuiltinGrokSelectorOptions', () => {
  it('localizes compatibility labels without changing wire values', () => {
    const translations: Record<string, string> = {
      'chat.runConfig.grok.interaction.label': '交互模式',
      'chat.runConfig.grok.interaction.agent.label': 'Agent',
      'chat.runConfig.grok.interaction.plan.label': '计划',
      'chat.runConfig.grok.interaction.ask.label': '问答',
      'chat.runConfig.grok.permission.label': '权限模式',
      'chat.runConfig.grok.permission.ask.label': '每次询问',
      'chat.runConfig.grok.permission.alwaysApprove.label': '始终允许',
    };
    const t = ((key: string, fallback: string) => translations[key] ?? fallback) as TFunction;

    const localized = localizeBuiltinGrokSelectorOptions(options, t);
    const interaction = localized.configOptionSelectors[0];
    const permission = localized.configOptionSelectors[1];

    expect(interaction?.label).toBe('交互模式');
    expect(interaction?.options.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'agent', label: 'Agent' },
      { value: 'plan', label: '计划' },
      { value: 'ask', label: '问答' },
    ]);
    expect(permission?.label).toBe('权限模式');
    expect(permission?.options.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'ask', label: '每次询问' },
      { value: 'always-approve', label: '始终允许' },
    ]);
  });
});
