import { z } from 'zod';
import { isRecord } from '../json-guards';
import type { SubagentTaskPayload } from '../ai';

/**
 * Subagent/background task persistence helpers.
 *
 * The Claude ACP adapter forwards the SDK's `task_started / task_progress /
 * task_updated / task_notification` system messages over the
 * `_claude/taskLifecycle` extension notification. The CLI
 * (`apps/cli/src/agent/claude-task-lifecycle.ts`) sanitizes each into a bounded,
 * whitelisted payload and carries it into the history pipeline on a synthetic
 * tool_call under {@link LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY}. The history
 * applier then converts it into a first-class `subagent_task` history item
 * (merged by `taskId`) — the persisted store never contains a tool_call or this
 * carrier key.
 */

/**
 * Internal wire key only. This is how the sanitized payload rides the ACP
 * tool_call transport from the CLI converter to the history applier; it is
 * stripped when the applier materializes the `subagent_task` item, so it never
 * appears in persisted history.
 */
export const LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY = 'lodyClaudeTaskLifecycle';
/** Provider-neutral carrier used by newer builtin ACP adapters. */
export const LODY_SUBAGENT_TASK_LIFECYCLE_RAW_INPUT_KEY = 'lodySubagentTaskLifecycle';

export const SUBAGENT_TASK_EVENTS = [
  'task_started',
  'task_progress',
  'task_updated',
  'task_notification',
] as const;

export const SUBAGENT_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const;

const SubagentTaskUsageSchema = z.object({
  totalTokens: z.number().optional(),
  toolUses: z.number().optional(),
  durationMs: z.number().optional(),
});

/** Runtime validator for a persisted `subagent_task` payload (foreign data). */
export const SubagentTaskPayloadSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(SUBAGENT_TASK_STATUSES),
  event: z.enum(SUBAGENT_TASK_EVENTS).optional(),
  toolUseId: z.string().optional(),
  subagentType: z.string().optional(),
  taskType: z.string().optional(),
  workflowName: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  rawStatus: z.string().optional(),
  usage: SubagentTaskUsageSchema.optional(),
  lastToolName: z.string().optional(),
  isBackgrounded: z.boolean().optional(),
  error: z.string().optional(),
  skipTranscript: z.boolean().optional(),
  hasOutputFile: z.boolean().optional(),
});

/**
 * Read the subagent-task payload off the internal wire tool_call `rawInput`.
 * Returns `null` when absent or malformed, so the applier can cheaply tell a
 * task-carrying tool_call from an ordinary one.
 */
export const parseSubagentTaskWire = (rawInput: unknown): SubagentTaskPayload | null => {
  if (!isRecord(rawInput)) return null;
  const carrier =
    rawInput[LODY_SUBAGENT_TASK_LIFECYCLE_RAW_INPUT_KEY] ??
    rawInput[LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY];
  if (!isRecord(carrier)) return null;
  const parsed = SubagentTaskPayloadSchema.safeParse(carrier);
  return parsed.success ? (parsed.data as SubagentTaskPayload) : null;
};

/**
 * Merge lifecycle events for the same task. Later events win per field, but
 * fields only present on earlier events (`subagentType`, `description`,
 * `taskType`, `workflowName`) are preserved — the terminal `task_notification`
 * carries neither, so a plain replace would blank out the subagent identity the
 * panel needs after completion. Inputs carry only defined keys (the CLI builds
 * them with set-if-defined), so a shallow spread is a correct field-wise merge.
 */
export const mergeSubagentTaskPayload = (
  prev: SubagentTaskPayload,
  incoming: SubagentTaskPayload
): SubagentTaskPayload => ({ ...prev, ...incoming });
