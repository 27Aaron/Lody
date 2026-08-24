import { describe, expect, it } from 'vitest';
import {
  AGENT_ROLE_VERSION,
  DEFAULT_AGENT_ROLE_EMOJI,
  applyTextRewrites,
  type AgentConfigId,
  type AgentRole,
  type AgentRoleId,
  type LocalProjectId,
  type MachineId,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';
import { buildAgentRoleCandidates } from '../src/components/mentions/mention-registry';
import {
  buildAgentRoleInvocationSnapshots,
  buildAgentRoleMentionContext,
  buildAgentRoleMentionItems,
  buildAgentRoleMentionPrompt,
  buildAgentRoleMentionRewrites,
  hydrateAgentRoleMentionsFromText,
  resolveAgentRoleMentionScope,
  selectAgentRoleMentionCandidates,
  type AgentRoleMentionItem,
} from '../src/components/mentions/mention-agent-role-source';

const machineId = 'machine-1' as MachineId;

const role = (overrides: Partial<AgentRole> = {}): AgentRole => ({
  v: AGENT_ROLE_VERSION,
  id: 'role-1' as AgentRoleId,
  ownerUserId: 'user-1',
  visibility: 'private',
  name: 'Code Reviewer',
  emoji: '🔍',
  machineId,
  agentConfigId: 'config-1' as AgentConfigId,
  runConfig: { modelId: 'gpt-5.6', configOptionValues: { thought_level: 'high' } },
  revision: 3,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const items = (...roles: AgentRole[]): AgentRoleMentionItem[] =>
  buildAgentRoleMentionItems(roles, {
    machineLabel: () => 'Studio',
    agentConfigLabel: () => 'Codex',
  });

describe('agent role mention work context', () => {
  it('pins a local project to its own machine', () => {
    expect(
      buildAgentRoleMentionContext({
        mentionSource: {
          kind: 'local',
          machineId: 'machine-2' as MachineId,
          workspaceId: 'w' as WorkspaceId,
          localProjectId: 'p' as LocalProjectId,
        },
        currentMachineId: machineId,
      })
    ).toEqual({ kind: 'machine', machineId: 'machine-2' });
  });

  it('lets a github project reach every authorized machine', () => {
    const context = buildAgentRoleMentionContext({
      mentionSource: { kind: 'github', repoFullName: 'loro-dev/lody' },
      currentMachineId: machineId,
    });
    expect(context).toEqual({ kind: 'github' });
    const authorized = new Set([machineId, 'machine-2' as MachineId]);
    expect(resolveAgentRoleMentionScope(context, authorized)).toEqual({
      kind: 'authorized_machines',
      machineIds: authorized,
    });
  });

  it('pins a github session that is checked out on a machine', () => {
    expect(
      buildAgentRoleMentionContext({
        mentionSource: {
          kind: 'github',
          repoFullName: 'loro-dev/lody',
          localWorktree: {
            machineId: 'machine-3' as MachineId,
            repoKey: 'repo',
            sessionId: 's' as SessionId,
          },
        },
        currentMachineId: machineId,
      })
    ).toEqual({ kind: 'machine', machineId: 'machine-3' });
  });

  it('keeps a plain chat on the current machine, and offers nothing without one', () => {
    expect(
      buildAgentRoleMentionContext({ mentionSource: undefined, currentMachineId: machineId })
    ).toEqual({ kind: 'machine', machineId });
    expect(
      resolveAgentRoleMentionScope(
        buildAgentRoleMentionContext({ mentionSource: undefined, currentMachineId: undefined }),
        new Set([machineId])
      )
    ).toEqual({ kind: 'machine', machineId: null });
  });
});

describe('agent role candidates', () => {
  it('derives the token from the name, whitespace and all', () => {
    expect(items(role({ name: 'Code Reviewer' }))[0]?.slug).toBe('Code-Reviewer');
  });

  it('ranks a prefix match over a substring one, on token or name', () => {
    const list = items(
      role({ id: 'a' as AgentRoleId, name: 'Deep reviewer' }),
      role({ id: 'b' as AgentRoleId, name: 'Reviewer' })
    );
    expect(selectAgentRoleMentionCandidates(list, 'rev').map((item) => item.slug)).toEqual([
      'Reviewer',
      'Deep-reviewer',
    ]);
    expect(selectAgentRoleMentionCandidates(list, 'nope')).toEqual([]);
  });

  it('caps the row count', () => {
    const many = items(
      ...Array.from({ length: 60 }, (_unused, index) =>
        role({ id: `role-${index}` as AgentRoleId, name: `Reviewer ${index}` })
      )
    );
    expect(selectAgentRoleMentionCandidates(many, '')).toHaveLength(50);
  });
});

describe('agent role menu rows', () => {
  const labels = {
    machine: 'Machine',
    agentConfig: 'Agent',
    model: 'Model',
    reasoning: 'Reasoning',
    prompt: 'Prompt',
    visibility: { private: 'Private', workspace: 'Workspace' },
  };

  it('carries the role own mark instead of the category glyph', () => {
    const [candidate] = buildAgentRoleCandidates(items(role({ emoji: '🔍' })), '', labels);
    expect(candidate).toMatchObject({
      iconEmoji: '🔍',
      // The name alone: the emoji is the row's icon, not a prefix on the text.
      title: 'Code Reviewer',
      insertText: '@Code-Reviewer',
      value: 'role-1',
    });
    // The pane has no icon slot, so the mark rides in its title there.
    expect(candidate?.detail?.title).toBe('🔍 Code Reviewer');
  });

  it('shows the instruction itself rather than a badge saying one exists', () => {
    const [withPrompt] = buildAgentRoleCandidates(
      items(role({ promptPrefix: 'Check correctness before style.' })),
      '',
      labels
    );
    expect(withPrompt?.detail?.body).toEqual({
      label: 'Prompt',
      text: 'Check correctness before style.',
      mono: true,
    });
    // Visibility is the only badge left; what the prompt SAYS is what decides
    // whether this is the Role the user meant.
    expect(withPrompt?.detail?.badges).toEqual(['Private']);

    const [withoutPrompt] = buildAgentRoleCandidates(items(role()), '', labels);
    expect(withoutPrompt?.detail?.body).toBeUndefined();
    expect(withoutPrompt?.detail?.badges).toEqual(['Private']);
  });

  it('falls back to the shared default mark', () => {
    const [candidate] = buildAgentRoleCandidates(items(role({ emoji: undefined })), '', labels);
    expect(candidate?.iconEmoji).toBe(DEFAULT_AGENT_ROLE_EMOJI);
  });
});

describe('agent role before-send expansion', () => {
  const text = 'please @Code-Reviewer this diff';
  const mention = { start: 7, end: 21, kind: 'agent_role', value: 'role-1' };

  it('rewrites the range into an id-bearing instruction and keeps the chip label', () => {
    const expanded = applyTextRewrites(
      text,
      buildAgentRoleMentionRewrites(text, [mention], items(role()))
    );
    expect(expanded.text).toBe(
      `please ${buildAgentRoleMentionPrompt({ id: 'role-1', name: 'Code Reviewer' })} this diff`
    );
    expect(expanded.spans).toEqual([
      {
        start: 7,
        end: 7 + buildAgentRoleMentionPrompt({ id: 'role-1', name: 'Code Reviewer' }).length,
        kind: 'agent_role',
        label: 'Code-Reviewer',
        target: 'role-1',
        // Frozen with the span so the bubble paints without the catalog.
        mark: '🔍',
      },
    ]);
  });

  it('carries no run configuration into the instruction', () => {
    const prompt = buildAgentRoleMentionPrompt({ id: 'role-1', name: 'Code Reviewer' });
    expect(prompt).not.toContain('gpt-5.6');
    expect(prompt).not.toContain('machine-1');
    expect(prompt).not.toContain('config-1');
  });

  it('leaves a role that is no longer offered as plain text', () => {
    expect(buildAgentRoleMentionRewrites(text, [mention], [])).toEqual([]);
  });
});

describe('agent role invocation snapshots', () => {
  it('freezes the role the turn authorized, without secrets', () => {
    const snapshots = buildAgentRoleInvocationSnapshots(
      [{ kind: 'agent_role', value: 'role-1' }],
      items(
        role({
          promptPrefix: 'Be strict.',
          runConfig: {
            modelId: 'gpt-5.6',
            configOptionValues: { thought_level: 'high', api_key: 'sk-live' },
          },
        })
      )
    );
    expect(snapshots).toEqual([
      {
        roleId: 'role-1',
        roleRevision: 3,
        roleName: 'Code Reviewer',
        machineId: 'machine-1',
        agentConfigId: 'config-1',
        runConfig: { modelId: 'gpt-5.6', configOptionValues: { thought_level: 'high' } },
        promptPrefix: 'Be strict.',
      },
    ]);
  });

  it('is unaffected by a later edit to the role', () => {
    const authored = role();
    const snapshots = buildAgentRoleInvocationSnapshots(
      [{ kind: 'agent_role', value: 'role-1' }],
      items(authored)
    );
    const edited = { ...authored, name: 'Renamed', revision: 4, runConfig: { modelId: 'other' } };
    expect(
      buildAgentRoleInvocationSnapshots([{ kind: 'agent_role', value: 'role-1' }], items(edited))
    ).not.toEqual(snapshots);
    // The already-built snapshot is a value, not a view of the catalog.
    expect(snapshots?.[0]).toMatchObject({ roleName: 'Code Reviewer', roleRevision: 3 });
  });

  it('collapses a role mentioned twice and authorizes nothing for an unknown one', () => {
    expect(
      buildAgentRoleInvocationSnapshots(
        [
          { kind: 'agent_role', value: 'role-1' },
          { kind: 'agent_role', value: 'role-1' },
          { kind: 'agent_role', value: 'gone' },
          { kind: 'session', value: 'session-1' },
        ],
        items(role())
      )
    ).toHaveLength(1);
    expect(buildAgentRoleInvocationSnapshots([], items(role()))).toBeUndefined();
  });
});

describe('agent role draft hydration', () => {
  it('recognises a known token and yields a range carrying the role id', () => {
    expect(hydrateAgentRoleMentionsFromText('ping @Code-Reviewer now', items(role()))).toEqual({
      mentions: [{ value: 'role-1', start: 5, end: 19, kind: 'agent_role' }],
      values: ['role-1'],
    });
  });

  it('leaves a token the file source already knows to the file hydrator', () => {
    expect(
      hydrateAgentRoleMentionsFromText(
        'open @Code-Reviewer',
        items(role()),
        new Set(['Code-Reviewer'])
      ).mentions
    ).toEqual([]);
  });

  it('claims nothing when no role is offered', () => {
    expect(hydrateAgentRoleMentionsFromText('@Code-Reviewer', [])).toEqual({
      mentions: [],
      values: [],
    });
  });
});
