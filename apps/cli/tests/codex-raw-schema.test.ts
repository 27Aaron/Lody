import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { parseSessionNotifications } from '@lody/shared';

import { CodexToolRawOutputSchema } from '../src/lib/acp/codex-raw';

describe('codex raw output schema', () => {
  it('matches the captured fixture shape (Codex-specific; may drift)', () => {
    const fixturePath = path.join(
      __dirname,
      'fixtures',
      'acp',
      'codex-terminal-notifications.sample.json'
    );

    const notifications = parseSessionNotifications(
      JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    );

    const rawOutputs = notifications
      .map((n) => n.update)
      .filter((u) => u.sessionUpdate === 'tool_call_update')
      .map((u) => (u.sessionUpdate === 'tool_call_update' ? u.rawOutput : undefined))
      .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);

    expect(rawOutputs.length).toBeGreaterThan(0);
    for (const raw of rawOutputs) {
      const parsed = CodexToolRawOutputSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
    }
  });
});
