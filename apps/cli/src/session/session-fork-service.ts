import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  getServerNow,
  getSessionIdFromRoomId,
  getSessionRoomId,
  isSessionDocRoomId,
  SessionId,
  sessionForkFailure,
  SessionStatusFactory,
  type MessageContent,
  type SessionForkErrorCode,
  type SessionForkResponse,
  type SessionForkSpec,
  type SessionForkOperation,
  type SessionHistoryInput,
  type SessionMeta,
  type ProjectRef,
  resolveSessionMcpSelection,
} from '@lody/shared';
import type { Logger } from '@/utils/logger';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import type { SessionManager } from './session-manager';
import type { SessionUserResolver } from './session-user-resolver';
import { listAliveRoomIds } from '@/lib/loro/repo-existence';

type ForkWarning = SessionForkResponse['warnings'][number];
const execFileAsync = promisify(execFile);

type WorktreeForkPreparedInput = {
  spec: SessionForkSpec;
  source: SessionMeta;
  sourceTitle: string;
  targetDoc: Awaited<ReturnType<LoroDocumentManager['getOrCreateSessionDoc']>>;
  targetMeta: SessionMeta;
  historyResult: NonNullable<ReturnType<typeof cloneHistoryThroughTurn>>;
  agentConfig: NonNullable<Awaited<ReturnType<LoroDocumentManager['getAgentConfigById']>>>;
  user: { name: string; email: string };
  operation: SessionForkOperation;
  targetWorkdir?: string;
};

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
  private readonly inFlight = new Map<
    string,
    { spec: SessionForkSpec; promise: Promise<SessionForkResponse> }
  >();
  private readonly startedAtMs = getServerNow();

  constructor(
    private readonly deps: {
      workspaceDocument: LoroDocumentManager;
      sessionManager: SessionManager;
      userResolver: SessionUserResolver;
      logger: Logger;
      workspaceId: string;
      machineId: string;
      isSourceBusy(sessionId: SessionId): boolean;
      inspectGitWorkdir?: (workdir: string) => Promise<{ dirty: boolean; headSha: string }>;
    }
  ) {}

  async fork(spec: SessionForkSpec): Promise<SessionForkResponse> {
    const key = spec.targetSessionId;
    const existing = this.inFlight.get(key);
    if (existing) {
      if (
        existing.spec.sourceSessionId !== spec.sourceSessionId ||
        existing.spec.sourceTurnId !== spec.sourceTurnId ||
        existing.spec.requestedByUserId !== spec.requestedByUserId ||
        existing.spec.targetContext?.kind !== spec.targetContext?.kind ||
        existing.spec.targetPlacement !== spec.targetPlacement
      ) {
        return sessionForkFailure(
          spec,
          'TARGET_SESSION_CONFLICT',
          'Target session id is already reserved by another fork.'
        );
      }
      return await existing.promise;
    }
    const operation = this.forkInner(spec).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, { spec, promise: operation });
    return await operation;
  }

  async recoverPendingForks(): Promise<void> {
    const roomIds = await listAliveRoomIds(this.deps.workspaceDocument, isSessionDocRoomId).catch(
      () => []
    );
    for (const roomId of roomIds) {
      const targetSessionId = getSessionIdFromRoomId(roomId);
      if (!targetSessionId) continue;
      const targetDoc = await this.deps.workspaceDocument
        .getOrCreateSessionDoc(targetSessionId)
        .catch(() => null);
      const operation = targetDoc?.getForkOperation();
      if (!targetDoc || !operation || operation.state !== 'preparing') continue;
      if (Date.parse(operation.createdAt) >= this.startedAtMs) continue;

      const targetMeta = await targetDoc.getMetaState();
      const targetHistory = await targetDoc.getHistory();
      const completed =
        !!targetMeta?.acpSessionId &&
        targetMeta.status?.type === 'idle' &&
        targetHistory.some((entry) =>
          (entry.items ?? []).some(
            (item) => item.type === 'system_notice' && item.name === 'session_fork_origin'
          )
        );
      if (completed) {
        targetDoc.setForkOperation(undefined);
        await this.deps.workspaceDocument
          .persistPendingChanges('session-fork-commit')
          .catch(() => {});
        continue;
      }

      const sourceDoc = await this.deps.workspaceDocument.getOrCreateSessionDoc(
        operation.sourceSessionId
      );
      const source = await sourceDoc.getMetaState();
      if (source?.project) {
        const project: ProjectRef =
          source.project.kind === 'local'
            ? { ...source.project, useWorktree: true }
            : source.project;
        const workdir =
          project.kind === 'local'
            ? await this.deps.sessionManager.resolveLocalProjectRootPath(project.localProjectId)
            : undefined;
        await this.deps.sessionManager.terminateSession(targetSessionId, true).catch(() => {});
        await this.deps.sessionManager
          .cleanupForkWorktree({
            workspaceId: this.deps.workspaceId as never,
            requesterUserId: operation.requestedByUserId,
            machineId: this.deps.machineId,
            agentConfigId: source.agentConfigId,
            agentCliType: source.cliType,
            agentType: source.agentType,
            mcpServerIds: resolveSessionMcpSelection(targetHistory),
            project,
            sessionId: targetSessionId,
            githubRepo:
              source.repoFullName ??
              (project.kind === 'github' ? project.repoFullName : project.githubRepoFullName),
            branch: source.branchName ?? source.baseBranch,
            ...(workdir ? { workdir } : {}),
            userName: 'Lody',
            userEmail: 'noreply@lody.ai',
          })
          .catch(() => {});
      }
      targetDoc.setForkOperation({
        ...operation,
        state: 'failed',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The worktree fork was interrupted by a machine restart. Please try again.',
        },
        updatedAt: new Date(getServerNow()).toISOString(),
      });
      await this.deps.workspaceDocument
        .persistPendingChanges('session-fork-rollback')
        .catch(() => {});
    }
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
    const worktreeFork = spec.targetContext?.kind === 'new-worktree';
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
    if (worktreeFork) {
      const targetDoc = await this.deps.workspaceDocument.getOrCreateSessionDoc(targetSessionId);
      const existingOperation = targetDoc.getForkOperation();
      if (existingOperation) {
        if (
          existingOperation.sourceSessionId !== sourceSessionId ||
          existingOperation.sourceTurnId !== spec.sourceTurnId ||
          existingOperation.requestedByUserId !== spec.requestedByUserId ||
          existingOperation.targetContext !== 'new-worktree'
        ) {
          return sessionForkFailure(
            spec,
            'TARGET_SESSION_CONFLICT',
            'Target session id is already reserved by another fork.'
          );
        }
        if (existingOperation.state === 'failed' && existingOperation.error) {
          return {
            ...sessionForkFailure(
              spec,
              existingOperation.error.code,
              existingOperation.error.message
            ),
            disposition: 'failed',
            operationId: existingOperation.id,
          };
        }
        return {
          type: 'session/fork_response',
          sourceSessionId,
          targetSessionId,
          success: true,
          partial: false,
          warnings: [],
          disposition: 'accepted',
          operationId: existingOperation.id,
        };
      }
      if (targetExisting && !('deletedAt' in targetExisting)) {
        const targetMeta = targetExisting.meta as SessionMeta | undefined;
        if (targetMeta?.acpSessionId) {
          return {
            type: 'session/fork_response',
            sourceSessionId,
            targetSessionId,
            success: true,
            partial: false,
            warnings: [],
            disposition: 'completed',
            operationId: `session-fork:${targetSessionId}`,
          };
        }
        return sessionForkFailure(
          spec,
          'TARGET_SESSION_CONFLICT',
          'Target session id already exists.'
        );
      }
    }
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

    if (worktreeFork) {
      if (
        !source.project ||
        (source.project.kind !== 'local' && source.project.kind !== 'github')
      ) {
        return sessionForkFailure(
          spec,
          'SOURCE_PROJECT_NOT_WORKTREE_CAPABLE',
          'This session is not attached to a Git worktree-capable project.'
        );
      }
      let sourceWorkdir: string;
      try {
        sourceWorkdir = await this.deps.sessionManager.resolveSessionWorkdir(sourceSessionId);
      } catch (error) {
        return sessionForkFailure(
          spec,
          'SOURCE_PROJECT_NOT_WORKTREE_CAPABLE',
          error instanceof Error ? error.message : 'The source workspace is unavailable.'
        );
      }
      let sourceWasDirty: boolean;
      let capturedHeadSha: string;
      try {
        const gitState = await (this.deps.inspectGitWorkdir
          ? this.deps.inspectGitWorkdir(sourceWorkdir)
          : this.inspectGitWorkdir(sourceWorkdir));
        sourceWasDirty = gitState.dirty;
        if (
          sourceWasDirty &&
          !(
            spec.targetContext?.kind === 'new-worktree' &&
            spec.targetContext.acknowledgeDirtySource === true
          )
        ) {
          return {
            ...sessionForkFailure(
              spec,
              'SOURCE_WORKTREE_DIRTY',
              'Uncommitted and untracked files will not be copied to the new worktree.'
            ),
            disposition: 'confirmation-required',
            reason: 'SOURCE_WORKTREE_DIRTY',
          };
        }
        capturedHeadSha = gitState.headSha;
        if (!/^[0-9a-f]{40,64}$/u.test(capturedHeadSha)) {
          throw new Error('Git returned an invalid commit id.');
        }
      } catch (error) {
        return sessionForkFailure(
          spec,
          'SOURCE_HEAD_UNAVAILABLE',
          error instanceof Error ? error.message : 'The source HEAD could not be captured.'
        );
      }

      const nowIso = new Date(getServerNow()).toISOString();
      const operation: SessionForkOperation = {
        id: `session-fork:${targetSessionId}`,
        sourceSessionId,
        sourceTurnId: spec.sourceTurnId,
        requestedByUserId: spec.requestedByUserId,
        targetContext: 'new-worktree',
        capturedHeadSha,
        sourceWasDirty,
        state: 'preparing',
        phase: 'preparing-worktree',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const targetProject: ProjectRef =
        source.project.kind === 'local' ? { ...source.project, useWorktree: true } : source.project;
      const targetRepoFullName =
        source.repoFullName ??
        (targetProject.kind === 'github'
          ? targetProject.repoFullName
          : targetProject.githubRepoFullName);
      const targetWorkdir =
        targetProject.kind === 'local'
          ? await this.deps.sessionManager.resolveLocalProjectRootPath(targetProject.localProjectId)
          : undefined;
      if (targetProject.kind === 'local' && !targetWorkdir) {
        return sessionForkFailure(
          spec,
          'SOURCE_PROJECT_NOT_WORKTREE_CAPABLE',
          'The local project root is unavailable on this machine.'
        );
      }
      const now = getServerNow();
      const targetMeta: SessionMeta = {
        id: targetSessionId,
        machineId: source.machineId,
        createdAt: new Date(now).toISOString(),
        lastMessageAt: now,
        title: `(fork) ${sourceTitle}`,
        titleSource: 'generated',
        userId: spec.requestedByUserId,
        status: SessionStatusFactory.initializing(undefined, 'Creating fork worktree'),
        isArchived: false,
        cliType: source.cliType,
        agentType: source.agentType,
        agentConfigId: source.agentConfigId,
        project: targetProject,
        repoFullName: targetRepoFullName,
        baseBranch: source.branchName ?? source.baseBranch,
        isWorktree: true,
      };
      const targetDoc = await this.deps.workspaceDocument.getOrCreateSessionDoc(targetSessionId);
      targetDoc.setForkOperation(operation);
      try {
        await this.deps.workspaceDocument.persistPendingChanges('session-fork-prepare');
      } catch (error) {
        targetDoc.setForkOperation(undefined);
        return sessionForkFailure(
          spec,
          'TARGET_WRITE_FAILED',
          error instanceof Error ? error.message : 'The fork operation could not be persisted.'
        );
      }

      const preparedInput: WorktreeForkPreparedInput = {
        spec,
        source,
        sourceTitle,
        targetDoc,
        targetMeta,
        historyResult,
        agentConfig,
        user,
        operation,
        ...(targetWorkdir ? { targetWorkdir } : {}),
      };
      setImmediate(() => {
        void this.executeWorktreeFork(preparedInput);
      });
      return {
        type: 'session/fork_response',
        sourceSessionId,
        targetSessionId,
        success: true,
        partial: false,
        warnings: [],
        disposition: 'accepted',
        operationId: operation.id,
      };
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
            mcpServerIds: resolveSessionMcpSelection(historyResult.history),
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

  private async inspectGitWorkdir(workdir: string): Promise<{ dirty: boolean; headSha: string }> {
    const status = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workdir,
      windowsHide: true,
      timeout: 10_000,
    });
    const head = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: workdir,
      windowsHide: true,
      timeout: 10_000,
    });
    return { dirty: status.stdout.trim().length > 0, headSha: head.stdout.trim() };
  }

  private async executeWorktreeFork(input: WorktreeForkPreparedInput): Promise<void> {
    const {
      spec,
      source,
      targetDoc,
      targetMeta,
      historyResult,
      agentConfig,
      user,
      operation,
      targetWorkdir,
    } = input;
    const targetSessionId = spec.targetSessionId;
    const targetRoomId = getSessionRoomId(targetSessionId);
    const targetProject = targetMeta.project;
    const config = {
      workspaceId: this.deps.workspaceId as never,
      requesterUserId: spec.requestedByUserId,
      machineId: source.machineId,
      agentConfigId: source.agentConfigId,
      agentCliType: source.cliType,
      agentType: source.agentType,
      mcpServerIds: resolveSessionMcpSelection(historyResult.history),
      customAcp: agentConfig.customAcp,
      runtimeOverrides: agentConfig.runtimeOverrides,
      env: agentConfig.env,
      project: targetProject,
      sessionId: targetSessionId,
      assumeDocExisting: true,
      title: targetMeta.title,
      githubRepo: targetMeta.repoFullName,
      branch: source.branchName ?? source.baseBranch,
      worktreeStartPoint: operation.capturedHeadSha,
      deferWorktreeMetaPersistence: true,
      ...(targetWorkdir ? { workdir: targetWorkdir } : {}),
      userName: user.name,
      userEmail: user.email,
    };
    try {
      await this.deps.sessionManager.createSession(config, {
        forkSessionId: source.acpSessionId!,
        forkSessionTurnId: historyResult.acpTurnId,
        deferAcpSessionIdPersistence: true,
      });
      const targetSession = this.deps.sessionManager.getSession(targetSessionId);
      if (!targetSession?.acpSessionId) {
        throw new SessionForkOperationError(
          'ACP_FORK_FAILED',
          'The ACP fork did not return a target session id.',
          null
        );
      }
      const branch = await execFileAsync('git', ['branch', '--show-current'], {
        cwd: targetSession.getWorkdir(),
        windowsHide: true,
        timeout: 10_000,
      });
      targetDoc.setForkOperation({
        ...operation,
        phase: 'committing',
        updatedAt: new Date(getServerNow()).toISOString(),
      });
      await this.deps.workspaceDocument.repo.upsertDocMeta(targetRoomId, {
        ...targetMeta,
        acpSessionId: targetSession.acpSessionId,
        status: SessionStatusFactory.idle(),
        branchName: branch.stdout.trim() || targetMeta.baseBranch,
      });
      await targetDoc.updateHistory(() => historyResult.history);
      targetDoc.setForkOperation(undefined);
      await this.deps.workspaceDocument.persistPendingChanges('session-fork-commit');
    } catch (error) {
      await this.deps.sessionManager.terminateSession(targetSessionId, true).catch(() => {});
      await this.deps.sessionManager.cleanupForkWorktree(config).catch((cleanupError: unknown) => {
        this.deps.logger.error(
          `[${targetSessionId}] Failed to compensate fork worktree: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      });
      const publicError =
        error instanceof SessionForkOperationError
          ? error
          : new SessionForkOperationError(
              'WORKTREE_CREATE_FAILED',
              'The new worktree session could not be created.',
              error
            );
      targetDoc.setForkOperation({
        ...operation,
        state: 'failed',
        error: { code: publicError.code, message: publicError.message },
        updatedAt: new Date(getServerNow()).toISOString(),
      });
      await this.deps.workspaceDocument
        .persistPendingChanges('session-fork-rollback')
        .catch(() => {});
      this.deps.logger.error(
        `[${spec.sourceSessionId}] Worktree session fork failed: ${
          publicError.detail instanceof Error
            ? publicError.detail.message
            : String(publicError.detail ?? error)
        }`
      );
    }
  }
}
