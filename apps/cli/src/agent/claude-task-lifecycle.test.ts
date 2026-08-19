import { describe, expect, it } from 'vitest';

import {
  convertClaudeTaskLifecycleNotification,
  LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY,
} from './claude-task-lifecycle';
import { LODY_SUBAGENT_TASK_LIFECYCLE_RAW_INPUT_KEY } from '@lody/shared';
import { convertKimiTaskLifecycleNotification } from './kimi-task-lifecycle';

describe('convertClaudeTaskLifecycleNotification', () => {
  it('converts task_started into a bounded synthetic tool call', () => {
    const result = convertClaudeTaskLifecycleNotification({
      sessionId: 'acp-session-1',
      acpSessionId: 'sdk-session-1',
      message: {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-1',
        tool_use_id: 'tool-1',
        description: 'Find CLI startup behavior',
        subagent_type: 'Explore',
        task_type: 'local_agent',
        prompt: 'full prompt that must not be persisted',
        output_file: '/tmp/ignored',
        skip_transcript: true,
        uuid: 'event-1',
        session_id: 'sdk-message-session',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toMatchObject({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'claude-task:task-1',
        title: 'Explore: Find CLI startup behavior',
        kind: 'think',
        status: 'in_progress',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'Find CLI startup behavior' },
          },
        ],
      },
    });

    const rawInput = result.notification.update.rawInput as Record<string, unknown>;
    const lifecycle = rawInput[LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY] as Record<string, unknown>;
    expect(lifecycle).toMatchObject({
      version: 1,
      event: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-1',
      sourceSessionId: 'sdk-session-1',
      sdkSessionId: 'sdk-message-session',
      subagentType: 'Explore',
      taskType: 'local_agent',
      description: 'Find CLI startup behavior',
      status: 'in_progress',
      skipTranscript: true,
    });
    expect(JSON.stringify(rawInput)).not.toContain('full prompt');
    expect(JSON.stringify(rawInput)).not.toContain('/tmp/ignored');
  });

  it('converts task_notification into a terminal update with filtered metadata', () => {
    const result = convertClaudeTaskLifecycleNotification({
      sessionId: 'acp-session-1',
      acpSessionId: 'sdk-session-1',
      message: {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-1',
        tool_use_id: 'tool-1',
        status: 'completed',
        output_file: '/tmp/task-1.output',
        summary: 'Agent finished',
        usage: { total_tokens: 123, tool_uses: 3, duration_ms: 700 },
        uuid: 'event-2',
        session_id: 'sdk-message-session',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toMatchObject({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'claude-task:task-1',
        title: 'Claude task: Agent finished',
        kind: 'think',
        status: 'completed',
      },
    });

    const rawInput = result.notification.update.rawInput as Record<string, unknown>;
    const lifecycle = rawInput[LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY] as Record<string, unknown>;
    expect(lifecycle).toMatchObject({
      event: 'task_notification',
      taskId: 'task-1',
      status: 'completed',
      rawStatus: 'completed',
      summary: 'Agent finished',
      usage: { totalTokens: 123, toolUses: 3, durationMs: 700 },
      hasOutputFile: true,
    });
    expect(JSON.stringify(rawInput)).not.toContain('/tmp/task-1.output');
  });

  it('keeps workflow_name, is_backgrounded and patch.error in the metadata', () => {
    const started = convertClaudeTaskLifecycleNotification({
      sessionId: 'acp-session-1',
      message: {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-2',
        description: 'Generate spec',
        task_type: 'local_workflow',
        workflow_name: 'spec',
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const startedRaw = started.notification.update.rawInput as Record<string, unknown>;
    expect(startedRaw[LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY]).toMatchObject({
      workflowName: 'spec',
      taskType: 'local_workflow',
    });

    const updated = convertClaudeTaskLifecycleNotification({
      sessionId: 'acp-session-1',
      message: {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-2',
        patch: { status: 'failed', error: 'boom', is_backgrounded: true },
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const updatedRaw = updated.notification.update.rawInput as Record<string, unknown>;
    expect(updatedRaw[LODY_CLAUDE_TASK_LIFECYCLE_RAW_INPUT_KEY]).toMatchObject({
      status: 'failed',
      rawStatus: 'failed',
      error: 'boom',
      isBackgrounded: true,
    });
  });

  it('rejects malformed task lifecycle payloads', () => {
    const result = convertClaudeTaskLifecycleNotification({
      sessionId: 'acp-session-1',
      message: { subtype: 'task_progress', description: 'missing task_id' },
    });

    expect(result.ok).toBe(false);
  });
});

describe('convertKimiTaskLifecycleNotification', () => {
  it('uses the provider-neutral carrier and Kimi fallback actor', () => {
    const result = convertKimiTaskLifecycleNotification({
      sessionId: 'kimi-session-1',
      message: {
        subtype: 'task_started',
        task_id: 'agent-1',
        description: 'Explore the repository',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toMatchObject({
      sessionId: 'kimi-session-1',
      update: { title: 'Kimi task: Explore the repository', status: 'in_progress' },
    });
    expect(result.notification.update.rawInput).toHaveProperty(
      LODY_SUBAGENT_TASK_LIFECYCLE_RAW_INPUT_KEY
    );
  });
});
