import type { AcpCommandSummary } from '@lody/shared';
import type { MentionProjectSource } from '@/components/mentions/mention-project-file-source';

export type ChatComposerPromptPlaceholderKey =
  | 'composer.promptPlaceholder.base'
  | 'composer.promptPlaceholder.commands'
  | 'composer.promptPlaceholder.mentions'
  | 'composer.promptPlaceholder.commandsMentions';

function hasChatComposerCommandHints(availableCommands?: AcpCommandSummary[]): boolean {
  return Boolean(availableCommands && availableCommands.length > 0);
}

function hasChatComposerFileMentions(mentionSource?: MentionProjectSource): boolean {
  if (mentionSource?.kind === 'local') return Boolean(mentionSource.localProjectId);
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  return false;
}

function hasChatComposerIssuePrMentions(mentionSource?: MentionProjectSource): boolean {
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  if (mentionSource?.kind === 'local') return Boolean(mentionSource.githubRepoFullName);
  return false;
}

export function hasChatComposerMentionHints(mentionSource?: MentionProjectSource): boolean {
  return (
    hasChatComposerFileMentions(mentionSource) || hasChatComposerIssuePrMentions(mentionSource)
  );
}

export function getChatComposerPromptPlaceholderKey({
  mentionSource,
  availableCommands,
}: {
  mentionSource?: MentionProjectSource;
  availableCommands?: AcpCommandSummary[];
}): ChatComposerPromptPlaceholderKey {
  const hasCommands = hasChatComposerCommandHints(availableCommands);
  const hasMentions = hasChatComposerMentionHints(mentionSource);

  if (hasCommands && hasMentions) return 'composer.promptPlaceholder.commandsMentions';
  if (hasCommands) return 'composer.promptPlaceholder.commands';
  if (hasMentions) return 'composer.promptPlaceholder.mentions';
  return 'composer.promptPlaceholder.base';
}
