import type * as acp from '@agentclientprotocol/sdk';
import type { AcpConfigOptionValue, SessionTurnInputConfig } from '@lody/shared';
import { z } from 'zod';

const BaseCapabilitySchema = z.object({
  version: z.literal(1),
  appliedNotification: z.string().min(1),
});

const CodexCapabilitySchema = BaseCapabilitySchema.extend({
  method: z.literal('_session/steering'),
  upstreamTurn: z.literal('same'),
  configPolicy: z.literal('active'),
});

const AppliedParamsSchema = z.object({
  sessionId: z.string().min(1),
  steerId: z.string().min(1),
});

export type AcknowledgedSteerCapability = {
  provider: 'claudeCode' | 'codex';
  requestMethod?: string;
  appliedNotificationMethod: string;
  upstreamTurn: 'handoff' | 'same';
  configPolicy: 'apply' | 'active';
};

const normalizeMethod = (method: string): string => method.replace(/^_/, '');

export function parseAcknowledgedSteerCapability(
  meta: Record<string, unknown> | null | undefined
): AcknowledgedSteerCapability | null {
  const codex = meta?.codex;
  const codexSteer =
    typeof codex === 'object' && codex !== null
      ? CodexCapabilitySchema.safeParse((codex as Record<string, unknown>).steer)
      : null;
  if (codexSteer?.success) {
    return {
      provider: 'codex',
      requestMethod: codexSteer.data.method,
      appliedNotificationMethod: normalizeMethod(codexSteer.data.appliedNotification),
      upstreamTurn: 'same',
      configPolicy: 'active',
    };
  }

  const claudeCode = meta?.claudeCode;
  const claudeSteer =
    typeof claudeCode === 'object' && claudeCode !== null
      ? BaseCapabilitySchema.safeParse((claudeCode as Record<string, unknown>).steer)
      : null;
  if (claudeSteer?.success) {
    return {
      provider: 'claudeCode',
      appliedNotificationMethod: normalizeMethod(claudeSteer.data.appliedNotification),
      upstreamTurn: 'handoff',
      configPolicy: 'apply',
    };
  }
  return null;
}

export function buildSteerRequestMeta(
  capability: AcknowledgedSteerCapability,
  steerId: string
): acp.PromptRequest['_meta'] | undefined {
  return capability.provider === 'claudeCode'
    ? { claudeCode: { steer: { id: steerId } } }
    : undefined;
}

export function parseSteerAppliedParams(
  params: unknown
): { sessionId: string; steerId: string } | null {
  const parsed = AppliedParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
}

export function findActiveSteerConfigMismatch(
  input: SessionTurnInputConfig,
  configOptions: readonly acp.SessionConfigOption[],
  currentModelId: string | undefined
): string | null {
  const byId = new Map(configOptions.map((option) => [option.id, option]));
  const byCategory = new Map(
    configOptions.flatMap((option) => (option.category ? [[option.category, option] as const] : []))
  );
  const mismatches: string[] = [];
  const compare = (
    label: string,
    requested: AcpConfigOptionValue | undefined,
    current: AcpConfigOptionValue | undefined
  ) => {
    if (requested !== undefined && requested !== current) {
      mismatches.push(`${label} requested ${String(requested)}, active ${String(current)}`);
    }
  };

  compare('model', input.modelId, byCategory.get('model')?.currentValue ?? currentModelId);
  compare('mode', input.modeId, byCategory.get('mode')?.currentValue);
  for (const [configId, requested] of Object.entries(input.configOptionValues ?? {})) {
    compare(`config ${configId}`, requested, byId.get(configId)?.currentValue);
  }
  return mismatches.length > 0 ? mismatches.join('; ') : null;
}
