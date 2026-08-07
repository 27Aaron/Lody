import type { SessionMeta } from '@lody/shared';

export function shouldRequestNativeQueueSteer(
  session: Pick<SessionMeta, 'cliType' | 'agentType'>
): boolean {
  return (
    session.cliType === 'builtin' &&
    (session.agentType === 'claude' || session.agentType === 'codex')
  );
}
