import { describe, expect, it } from 'vitest';

import {
  getChatComposerPromptPlaceholderKey,
  hasChatComposerMentionHints,
} from '../src/lib/chat-composer-placeholder';
import type { MentionProjectSource } from '../src/components/mentions/mention-project-file-source';
import type { AcpCommandSummary, LocalProjectId, MachineId, WorkspaceId } from '@lody/shared';

const commands: AcpCommandSummary[] = [{ name: 'review', description: 'Review changes' }];

const localSource = {
  kind: 'local',
  machineId: 'machine-1' as MachineId,
  workspaceId: 'workspace-1' as WorkspaceId,
  localProjectId: 'project-1' as LocalProjectId,
} satisfies MentionProjectSource;

const localGithubSource = {
  ...localSource,
  githubRepoFullName: 'loro-dev/lody',
} satisfies MentionProjectSource;

const githubSource = {
  kind: 'github',
  repoFullName: 'loro-dev/lody',
  isPublic: false,
} satisfies MentionProjectSource;

describe('chat composer placeholder hints', () => {
  it('falls back to the base placeholder with no active composer enhancements', () => {
    expect(getChatComposerPromptPlaceholderKey({})).toBe('composer.promptPlaceholder.base');
  });

  it('adds slash command hints only when commands are available', () => {
    expect(getChatComposerPromptPlaceholderKey({ availableCommands: commands })).toBe(
      'composer.promptPlaceholder.commands'
    );
  });

  it('adds mention hints for local project sources', () => {
    expect(hasChatComposerMentionHints(localSource)).toBe(true);
    expect(getChatComposerPromptPlaceholderKey({ mentionSource: localSource })).toBe(
      'composer.promptPlaceholder.mentions'
    );
  });

  it('uses the same mention hint for GitHub-backed sources', () => {
    expect(hasChatComposerMentionHints(githubSource)).toBe(true);
    expect(getChatComposerPromptPlaceholderKey({ mentionSource: githubSource })).toBe(
      'composer.promptPlaceholder.mentions'
    );
  });

  it('combines slash command and mention hints', () => {
    expect(
      getChatComposerPromptPlaceholderKey({
        mentionSource: localGithubSource,
        availableCommands: commands,
      })
    ).toBe('composer.promptPlaceholder.commandsMentions');
  });
});
