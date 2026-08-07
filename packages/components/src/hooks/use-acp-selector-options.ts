import { useMemo } from 'react';
import {
  buildAcpSelectorOptions,
  type AcpSelectorOptions,
  type AcpSelectorTarget,
} from '@/components/shared/acp-selector-options';

/**
 * Hook that builds ACP selector options for the given target.
 *
 * Mode/model names and descriptions are taken verbatim from the agent-reported
 * capabilities. No Lody-side i18n remapping is applied.
 */
export function useAcpSelectorOptions(target?: AcpSelectorTarget): AcpSelectorOptions {
  const targetConfigId = target?.configId;
  const targetCliType = target?.cliType;
  const targetAgentType = target?.agentType;
  const targetSelectedModeId = target?.selectedModeId;
  const targetSelectedModelId = target?.selectedModelId;
  const targetConfigOptionValues = target?.configOptionValues;
  const targetRuntimeOverrides = target?.runtimeOverrides;
  const targetMachine = target?.machine;

  return useMemo(
    () =>
      buildAcpSelectorOptions(
        targetCliType && targetAgentType
          ? {
              configId: targetConfigId,
              cliType: targetCliType,
              agentType: targetAgentType,
              selectedModeId: targetSelectedModeId,
              selectedModelId: targetSelectedModelId,
              configOptionValues: targetConfigOptionValues,
              runtimeOverrides: targetRuntimeOverrides,
              machine: targetMachine,
            }
          : undefined
      ),
    [
      targetConfigId,
      targetMachine,
      targetAgentType,
      targetCliType,
      targetConfigOptionValues,
      targetRuntimeOverrides,
      targetSelectedModeId,
      targetSelectedModelId,
    ]
  );
}
