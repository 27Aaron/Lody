import {
  getServerNow,
  getSessionRoomId,
  SessionId,
  sessionForkFailure,
  SessionStatusFactory,
  type MessageContent,
  type SessionForkErrorCode,
  type SessionForkResponse,
  type SessionForkSpec,
  type SessionHistoryInput,
  type SessionMeta,
} from '@lody/shared';
import type { Logger } from '@/utils/logger';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import type { SessionManager } from './session-manager';
import type { SessionUserResolver } from './session-user-resolver';

type ForkWarning = SessionForkResponse['warnings'][number];

class SessionForkOperationError extends Error {
  constructor(
    readonly code: SessionForkErrorCode,
    message: string,
    readonly detail: unknown
  ) {
    super(message);
    this.name = 'SessionForkOperationError';
  }
}

function rewriteAttachmentNamespace(
  item: MessageContent,
  sourceSessionId: SessionId
): MessageContent {
  if (item.type === 'image') {
    return {
      ...item,
      storageSessionId: item.storageSessionId ?? sourceSessionId,
    };
  }
  if (item.type === 'image_group') {
    return {
      ...item,
      images: item.images.map((image) => ({
        ...image,
        storageSessionId: image.storageSessionId ?? sourceSessionId,
      })),
    };
  }
  if (item.type === 'file') {
    return {
      ...item,
      storageSessionId: item.storageSessionId ?? sourceSessionId,
    };
  }
  return item;
}

export function cloneHistoryThroughTurn(
  history: SessionHistoryInput[],
  sourceTurnId: string,
  sourceSessionId: SessionId,
  sourceTitle: string,
  targetSessionId: SessionId,
  options: { allowActiveTurnSuffix?: boolean } = {}
): { history: SessionHistoryInput[]; warnings: ForkWarning[]; acpTurnId?: string } | null {
  const sourceIndex = history.findIndex((entry) => entry.id === sourceTurnId);
  if (sourceIndex < 0) return null;
  const sourceTurn = history[sourceIndex];
  if (!sourceTurn) return null;
  if (sourceTurn.role !== 'assistant' || sourceTurn.finished !== true) return null;
  // A persisted provider turn id makes an older completed assistant turn an exact
  // boundary. Without one, retain the legacy latest-completed-only rule.
  if (
    history.some(
      (entry, index) =>
        index > sourceIndex &&
        entry.role === 'assistant' &&
        (!options.allowActiveTurnSuffix || entry.finished === true) &&
        !sourceTurn.acpTurnId
    )
  )
    return null;

  const selected = history.slice(0, sourceIndex + 1);
  const warnings: ForkWarning[] = [];
  if (selected.some((entry) => entry.fileDiff.length > 0)) {
    warnings.push({
      code: 'HISTORICAL_TURN_DIFF_UNAVAILABLE',
      message: 'Historical turn diff evidence is not copied in this version.',
    });
  }
  if (
    selected.some((entry) =>
      (entry.items ?? []).some((item) => item.type === 'file' && item.transport === 'local')
    )
  ) {
    warnings.push({
      code: 'ATTACHMENT_UNAVAILABLE',
      message: 'Some local attachments remain linked to the source storage namespace.',
    });
  }

  const cloned = selected.map((entry) => ({
    ...entry,
    items: (entry.items ?? []).map((item) => rewriteAttachmentNamespace(item, sourceSessionId)),
    fileDiff: [],
    sendStatus: undefined,
    status: entry.role === 'user' ? ('handled' as const) : entry.status,
    read: true,
  }));
  cloned.push({
    id: `session-fork-origin:${targetSessionId}`,
    timestamp: new Date(getServerNow()).toISOString(),
    role: 'system',
    fileDiff: [],
    finished: true,
    read: true,
    status: undefined,
    sendStatus: undefined,
    items: [
      {
        type: 'system_notice',
        name: 'session_fork_origin',
        meta: { sourceSessionId, sourceTurnId, sourceTitle },
      },
    ],
  });
  return { history: cloned, warnings, acpTurnId: sourceTurn.acpTurnId };
}

export class SessionForkService {
  private readonly inFlight = new Map<string, Promise<SessionForkResponse>>();

  constructor(
    private readonly deps: {
      workspaceDocument: LoroDocumentManager;
      sessionManager: SessionManager;
      userResolver: SessionUserResolver;
      logger: Logger;
      workspaceId: string;
      machineId: string;
      isSourceBusy(sessionId: SessionId): boolean;
    }
  ) {}

  async fork(spec: SessionForkSpec): Promise<SessionForkResponse> {
    const key = `${spec.sourceSessionId}:${spec.targetSessionId}`;
    const existing = this.inFlight.get(key);
    if (existing) return await existing;
    const operation = this.forkInner(spec).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return await operation;
  }

  private async forkInner(spec: SessionForkSpec): Promise<SessionForkResponse> {
    const { sourceSessionId, targetSessionId } = spec;
    const sourceDoc = await this.deps.workspaceDocument.getOrCreateSessionDoc(sourceSessionId);
    const source = await sourceDoc.getMetaState();
    if (!source)
      return sessionForkFailure(spec, 'SOURCE_SESSION_NOT_FOUND', 'Source session was not found.');
    if (source.machineId !== this.deps.machineId) {
      return sessionForkFailure(
        spec,
        'MACHINE_ACCESS_DENIED',
        'Source session belongs to another machine.'
      );
    }
    if (source.isArchived) {
      return sessionForkFailure(
        spec,
        'SOURCE_SESSION_ARCHIVED',
        'Archived sessions cannot be forked.'
      );
    }
    const sourceBusy = this.deps.isSourceBusy(sourceSessionId);
    if (!source.acpSessionId || !source.agentConfigId) {
      return sessionForkFailure(
        spec,
        'FORK_UNAVAILABLE',
        'The source session has no forkable ACP runtime identity.'
      );
    }
    const reusedUser = this.deps.sessionManager
      .getSession(sourceSessionId)
      ?.getGitIdentityForUser?.(spec.requestedByUserId);

    const targetRoomId = getSessionRoomId(targetSessionId);
    // These four reads are independent, and two of them are slow: the merged
    // agent-config lookup scans the machine flock and user resolution is a
    // Convex query. Awaiting them in sequence put their sum on the fork click
    // path; the rejection order below is unchanged.
    const [targetExisting, sourceHistory, agentConfig, user] = await Promise.all([
      this.deps.workspaceDocument.repo.getDocMeta(targetRoomId),
      sourceDoc.getHistory(),
      this.deps.workspaceDocument.getAgentConfigById(source.agentConfigId, source.machineId),
      reusedUser ?? this.deps.userResolver.resolve(spec.requestedByUserId),
    ]);
    if (targetExisting && !('deletedAt' in targetExisting)) {
      return sessionForkFailure(
        spec,
        'TARGET_SESSION_CONFLICT',
        'Target session id already exists.'
      );
    }

    const sourceTitle = source.title?.trim() || 'Untitled session';
    const historyResult = cloneHistoryThroughTurn(
      sourceHistory,
      spec.sourceTurnId,
      sourceSessionId,
      sourceTitle,
      targetSessionId,
      { allowActiveTurnSuffix: sourceBusy }
    );
    if (!historyResult) {
      return sessionForkFailure(
        spec,
        'SOURCE_TURN_NOT_FORKABLE',
        'This assistant message has no ACP turn boundary.'
      );
    }

    if (!agentConfig) {
      return sessionForkFailure(
        spec,
        'FORK_UNAVAILABLE',
        'The source agent configuration is unavailable.'
      );
    }

    const forkSessionTurnId = historyResult.acpTurnId;
    if (sourceBusy) {
      const sourceRuntime = this.deps.sessionManager.getSession(sourceSessionId);
      const sourceAgent = sourceRuntime?.agentClient;
      if (
        !sourceRuntime?.acpSessionId ||
        sourceRuntime.acpSessionId !== source.acpSessionId ||
        !sourceAgent?.supportsActiveTurnFork() ||
        !forkSessionTurnId
      ) {
        return sessionForkFailure(
          spec,
          'SOURCE_SESSION_BUSY',
          'The active agent cannot fork before its current turn.'
        );
      }
    }

    const now = getServerNow();
    const parentSessionId = source.parentSessionId ?? source.id;
    const targetMeta: SessionMeta = {
      id: targetSessionId,
      machineId: source.machineId,
      createdAt: new Date(now).toISOString(),
      lastMessageAt: now,
      title: `(fork) ${sourceTitle}`,
      titleSource: 'generated',
      userId: spec.requestedByUserId,
      status: SessionStatusFactory.initializing(),
      isArchived: false,
      cliType: source.cliType,
      agentType: source.agentType,
      agentConfigId: source.agentConfigId,
      project: source.project,
      repoFullName: source.repoFullName,
      baseBranch: source.baseBranch,
      branchName: source.branchName,
      isWorktree: source.isWorktree,
      parentSessionId,
      ...(spec.targetPlacement ? { childSessionPlacement: spec.targetPlacement } : {}),
    };

    let targetPrepared = false;
    try {
      await this.deps.workspaceDocument.repo.upsertDocMeta(targetRoomId, targetMeta);
      const targetDoc = await this.deps.workspaceDocument.getOrCreateSessionDoc(targetSessionId);
      await this.deps.workspaceDocument.persistPendingChanges('session-fork-prepare');
      targetPrepared = true;

      try {
        await this.deps.sessionManager.createSession(
          {
            workspaceId: this.deps.workspaceId as never,
            requesterUserId: spec.requestedByUserId,
            machineId: source.machineId,
            agentConfigId: source.agentConfigId,
            agentCliType: source.cliType,
            agentType: source.agentType,
            customAcp: agentConfig.customAcp,
            runtimeOverrides: agentConfig.runtimeOverrides,
            env: agentConfig.env,
            project: source.project,
            sessionId: targetSessionId,
            assumeDocExisting: true,
            title: targetMeta.title,
            githubRepo: source.repoFullName,
            branch: source.baseBranch,
            parentSessionId,
            userName: user.name,
            userEmail: user.email,
          },
          {
            forkSessionId: source.acpSessionId,
            forkSessionTurnId,
            deferAcpSessionIdPersistence: true,
          }
        );
      } catch (error) {
        throw new SessionForkOperationError(
          'ACP_FORK_FAILED',
          'The ACP session could not be forked.',
          error
        );
      }
      const targetSession = this.deps.sessionManager.getSession(targetSessionId);
      if (!targetSession?.acpSessionId) {
        throw new SessionForkOperationError(
          'ACP_FORK_FAILED',
          'The ACP fork did not return a target session id.',
          null
        );
      }
      try {
        await this.deps.workspaceDocument.repo.upsertDocMeta(targetRoomId, {
          acpSessionId: targetSession.acpSessionId,
          status: SessionStatusFactory.idle(),
        });
        await targetDoc.updateHistory(() => historyResult.history);
        await this.deps.workspaceDocument.persistPendingChanges('session-fork-commit');
      } catch (error) {
        throw new SessionForkOperationError(
          'TARGET_WRITE_FAILED',
          'The forked session could not be saved locally.',
          error
        );
      }
      return {
        type: 'session/fork_response',
        sourceSessionId: spec.sourceSessionId,
        targetSessionId: spec.targetSessionId,
        success: true,
        partial: historyResult.warnings.length > 0,
        warnings: historyResult.warnings,
      };
    } catch (error) {
      if (targetPrepared) {
        await this.deps.sessionManager.terminateSession(targetSessionId, true).catch(() => {});
      }
      await this.deps.workspaceDocument.repo.deleteDoc(targetRoomId).catch(() => {});
      await this.deps.workspaceDocument
        .persistPendingChanges('session-fork-rollback')
        .catch(() => {});
      const publicError =
        error instanceof SessionForkOperationError
          ? error
          : new SessionForkOperationError(
              'TARGET_WRITE_FAILED',
              'The fork target could not be prepared locally.',
              error
            );
      const detail = publicError.detail ?? error;
      this.deps.logger.error(
        `[${spec.sourceSessionId}] ACP session fork failed: ${
          detail instanceof Error ? detail.message : String(detail)
        }`
      );
      return sessionForkFailure(spec, publicError.code, publicError.message);
    }
  }
}
