import type { AcpCommandSummary } from '@lody/shared';
import type { MentionProjectSource } from '@/components/mentions/mention-project-file-source';

export type ChatComposerPromptPlaceholderKey =
  | 'composer.promptPlaceholder.base'
  | 'composer.promptPlaceholder.commands'
  | 'composer.promptPlaceholder.files'
  | 'composer.promptPlaceholder.commandsFiles'
  | 'composer.promptPlaceholder.issues'
  | 'composer.promptPlaceholder.commandsIssues'
  | 'composer.promptPlaceholder.filesIssues'
  | 'composer.promptPlaceholder.commandsFilesIssues';

function hasChatComposerCommandHints(availableCommands?: AcpCommandSummary[]): boolean {
  return Boolean(availableCommands && availableCommands.length > 0);
}

export function hasChatComposerFileMentionHints(mentionSource?: MentionProjectSource): boolean {
  if (mentionSource?.kind === 'local') return Boolean(mentionSource.localProjectId);
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  return false;
}

export function hasChatComposerIssuePrMentionHints(mentionSource?: MentionProjectSource): boolean {
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  if (mentionSource?.kind === 'local') return Boolean(mentionSource.githubRepoFullName);
  return false;
}

// NOTE: the `$` skills-mention hint is not its own placeholder dimension. Skill
// mentions require a selected project — the exact same condition as file mentions
// (see `hasChatComposerFileMentionHints`) — so every file-bearing placeholder
// string also advertises "'$' for skills". If skills ever decouple from file
// availability, promote it to a real dimension here. Keep the i18n strings for
// the *files* keys in sync with this.
export function getChatComposerPromptPlaceholderKey({
  mentionSource,
  availableCommands,
}: {
  mentionSource?: MentionProjectSource;
  availableCommands?: AcpCommandSummary[];
}): ChatComposerPromptPlaceholderKey {
  const hasCommands = hasChatComposerCommandHints(availableCommands);
  const hasFiles = hasChatComposerFileMentionHints(mentionSource);
  const hasIssues = hasChatComposerIssuePrMentionHints(mentionSource);

  if (hasCommands && hasFiles && hasIssues) {
    return 'composer.promptPlaceholder.commandsFilesIssues';
  }
  if (hasCommands && hasFiles) return 'composer.promptPlaceholder.commandsFiles';
  if (hasCommands && hasIssues) return 'composer.promptPlaceholder.commandsIssues';
  if (hasFiles && hasIssues) return 'composer.promptPlaceholder.filesIssues';
  if (hasCommands) return 'composer.promptPlaceholder.commands';
  if (hasFiles) return 'composer.promptPlaceholder.files';
  if (hasIssues) return 'composer.promptPlaceholder.issues';
  return 'composer.promptPlaceholder.base';
}
