import spawn from 'cross-spawn';
import { type ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import * as fs from 'fs';
import {
  ndJsonStream,
  type Stream,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { v4 as uuidV4 } from 'uuid';

import type { Logger } from '@/utils/logger';
import type { TerminalManager } from '@/session/terminal-manager';
import {
  AgentClient,
  type AcpWriteTextFileEvidence,
  type AgentSessionWarning,
  type CodexImageGenerationBeginEvent,
  type CodexImageGenerationEndEvent,
  type AcpStartupStageEvent,
  type AcpStartupTimeoutOptions,
  type AcpSessionStartTarget,
} from './agent-client';
import { getLoginShellEnv } from './login-shell-env';
import {
  mergeACPProcessEnv,
  mergeLoginShellEnv,
  resolveACPProcessLaunch,
  resolveACPProcessLaunchAsync,
  withDefaultAcpPathEntries,
} from './setting';
import type { ManagedRuntimeProgressCallback } from '@/agent/managed-agent-runtime';
import type {
  ACPSessionId,
  AcpSessionNotification,
  AgentConfigCliType,
  BuiltinRuntimeOverrides,
  CustomAcpLaunchSpec,
  MachineId,
  MessageContent,
  SessionContextWindowUsage,
  SessionId,
  WorkspaceId,
} from '@lody/shared';

import { createStdinWritableStream, createStdoutReadableStream } from '@/utils/stream';
import { SessionUsageUpdate, UsageData } from 'acp-extension-core';
import {
  appendStderrTail,
  AcpStartupProcessError,
  AcpStartupProcessExitError,
  createAcpStartupMonitor,
} from './acp-startup-monitor';
import { withLodyNpmCacheForNpx } from './npx-cache';
import { runNpxStartupWithRecovery } from './acp-npx-startup-policy';
import { truncateLogText } from '@/utils/log-format';
import {
  type AcpLauncher,
  captureAcpSpawnFailed,
  captureAcpSpawnStarted,
  classifyCliSpawnReason,
  resolveAcpLauncher,
} from './acp-analytics';
import { withoutElectronBootstrapCredentials } from '@/electron-bootstrap-env';

export type CreateAcpClientOptions = {
  stream: Stream;
  workdir: string;
  logger: Logger;
  terminalManager: TerminalManager;
  agentConfig?: {
    cliType: AgentConfigCliType;
    agentType: string;
  };
  /** Launcher family (npx/uvx/local) for ACP startup analytics; non-PII. */
  launcher?: AcpLauncher;
  resumeSessionId?: ACPSessionId;
  forkSessionId?: ACPSessionId;
  /** Provider-native turn id selected as the source boundary for a turn-addressed fork. */
  forkSessionTurnId?: string;
  /** Set to false to disable terminal capability advertisement. Defaults to true. */
  terminalEnabled?: boolean;
  workspaceId?: WorkspaceId;
  machineId?: MachineId;
  onStartupStage?: (event: AcpStartupStageEvent) => void;
  onUpdateMessage(message: AcpSessionNotification): void;
  onRequestPermission(
    requestId: string,
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  onUsageUpdate?(usage: SessionUsageUpdate): void;
  onContextWindowUsageUpdate?(usage: SessionContextWindowUsage): void;
  onRateLimitUpdate?(limits: UsageData): void;
  onThreadGoalUpdated?(goal: Extract<MessageContent, { type: 'goal' }>): void;
  onThreadGoalCleared?(threadId: string): void;
  onSessionTitleUpdate?(title: string): void;
  onAgentWarning?(warning: AgentSessionWarning): void;
  onCodexProposedPlan?(plan: Extract<MessageContent, { type: 'proposed_plan' }>): void;
  onCodexImageGenerationBegin?(event: CodexImageGenerationBeginEvent): void;
  onCodexImageGenerationEnd?(event: CodexImageGenerationEndEvent): void;
  onWriteTextFile?(event: AcpWriteTextFileEvidence): void | Promise<void>;
  sessionId?: SessionId;
  startupTimeouts?: AcpStartupTimeoutOptions;
  startupAbort?: Promise<never>;
  resolveSessionStart?: () => Promise<AcpSessionStartTarget>;
};

export const createAcpClient = async (options: CreateAcpClientOptions) => {
  const sessionId = options.sessionId ?? (uuidV4() as SessionId);
  options.logger.debug(`[${sessionId}] createAcpClient: creating AgentClient`);
  const client = new AgentClient({
    logger: options.logger,
    sessionId,
    workspaceId: options.workspaceId,
    machineId: options.machineId,
    terminalManager: options.terminalManager,
    agentConfig: options.agentConfig,
    launcher: options.launcher,
    terminalEnabled: options.terminalEnabled,
    onStartupStage: options.onStartupStage,
    onUpdateMessage: options.onUpdateMessage,
    onRequestPermission: options.onRequestPermission,
    onUsageUpdate: options.onUsageUpdate,
    onContextWindowUsageUpdate: options.onContextWindowUsageUpdate,
    onRateLimitUpdate: options.onRateLimitUpdate,
    onThreadGoalUpdated: options.onThreadGoalUpdated,
    onThreadGoalCleared: options.onThreadGoalCleared,
    onSessionTitleUpdate: options.onSessionTitleUpdate,
    onAgentWarning: options.onAgentWarning,
    onCodexProposedPlan: options.onCodexProposedPlan,
    onCodexImageGenerationBegin: options.onCodexImageGenerationBegin,
    onCodexImageGenerationEnd: options.onCodexImageGenerationEnd,
    onWriteTextFile: options.onWriteTextFile,
  });
  options.logger.debug(`[${sessionId}] createAcpClient: AgentClient created, calling startSession`);
  const sessionResponse = await client.startSession(
    options.stream,
    options.workdir,
    options.resumeSessionId,
    options.startupTimeouts,
    options.startupAbort,
    options.resolveSessionStart,
    options.forkSessionId,
    options.forkSessionTurnId
  );
  options.logger.debug(
    `[${sessionId}] createAcpClient: startSession returned (acpSessionId=${sessionResponse.sessionId})`
  );
  return { client, acpSessionId: sessionResponse.sessionId as ACPSessionId, sessionResponse };
};

function waitForChildProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const onTimeout = () => {
      cleanup();
      resolve(child.exitCode !== null);
    };
    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.off('exit', onExit);
    };

    const timeoutHandle = setTimeout(onTimeout, timeoutMs);
    child.once('exit', onExit);
  });
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    process.kill(-child.pid, signal);
    return;
  }

  child.kill(signal);
}

async function terminateChildProcess(
  child: ChildProcess,
  logger: Logger,
  sessionLabel: string,
  exitTimeoutMs: number
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  try {
    signalChildProcess(child, 'SIGTERM');
  } catch {
    return;
  }

  if (await waitForChildProcessExit(child, exitTimeoutMs)) {
    return;
  }

  logger.debug(
    `[${sessionLabel}] ACP agent process did not exit within ${exitTimeoutMs}ms of SIGTERM; escalating to SIGKILL`
  );
  try {
    signalChildProcess(child, 'SIGKILL');
  } catch {
    return;
  }
  await waitForChildProcessExit(child, exitTimeoutMs);
}

export type SpawnAcpProcessOptions = {
  cliType: AgentConfigCliType;
  agentType: string;
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  workdir: string;
  env: NodeJS.ProcessEnv;
  args?: string[];
  command?: string;
  spawnImpl?: typeof spawn;
};

export const spawnAcpProcess = (options: SpawnAcpProcessOptions): ChildProcess => {
  // Resolve defaults only when the caller did not already supply both command and
  // args. Binary-distribution agents are resolved asynchronously upstream (they
  // pass explicit command/args here), so we must NOT call the synchronous
  // resolver for them — it throws for binary-only agents.
  let command = options.command;
  let args = options.args;
  if (command === undefined || args === undefined) {
    const launch = resolveACPProcessLaunch({
      cliType: options.cliType,
      agentType: options.agentType,
      customAcp: options.customAcp,
      runtimeOverrides: options.runtimeOverrides,
    });
    command = command ?? launch.command;
    args = args ?? launch.args;
  }
  const spawnFn = options.spawnImpl ?? spawn;

  return spawnFn(command, args, {
    cwd: options.workdir,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    // On Windows the daemon has no console; without CREATE_NO_WINDOW each
    // spawned agent CLI pops a visible console window and steals focus.
    windowsHide: true,
  });
};

export type StartLocalAcpAgentOptions = {
  cliType: AgentConfigCliType;
  agentType: string;
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  workdir: string;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  terminalManager: TerminalManager;
  /** Set to false to disable terminal capability advertisement. Defaults to true. */
  terminalEnabled?: boolean;
  onUpdateMessage(message: AcpSessionNotification): void;
  onRequestPermission(
    requestId: string,
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  onManagedRuntimeProgress?: ManagedRuntimeProgressCallback;
  signal?: AbortSignal;
  extraArgs?: string[];
  spawnImpl?: typeof spawn;
};

export const startLocalAcpAgent = async (options: StartLocalAcpAgentOptions) => {
  options.signal?.throwIfAborted();
  // Async resolve so registry agents distributed as a platform binary are
  // downloaded/unpacked on demand before spawn (no-op for builtin/npx/uvx/local).
  const launch = await resolveACPProcessLaunchAsync({
    cliType: options.cliType,
    agentType: options.agentType,
    customAcp: options.customAcp,
    runtimeOverrides: options.runtimeOverrides,
    extraArgs: options.extraArgs,
    onManagedRuntimeProgress: options.onManagedRuntimeProgress
      ? (event) => {
          if (!options.signal?.aborted) {
            options.onManagedRuntimeProgress?.(event);
          }
        }
      : undefined,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  const launcher: AcpLauncher = resolveAcpLauncher(launch.command);
  const spawnAnalyticsProps = {
    cliType: options.cliType,
    agentType: options.agentType,
    launcher,
    isResume: false,
  };

  const baseEnv = withoutElectronBootstrapCredentials(options.env ?? process.env);
  // Codex CLI reads config from `~/.codex` by default. For E2E-style runs we want deterministic,
  // repo-local config to avoid picking up the user's global Codex profile (which can add prompts
  // and slow down the run). Codex supports overriding the home directory via `CODEX_HOME`.
  //
  // Docs: Codex checks the "Codex home" dir (default `~/.codex`, overridable with `CODEX_HOME`)
  // for `config.toml` and other profile state.
  const shouldUseWorkdirCodexHome =
    options.cliType === 'builtin' &&
    options.agentType === 'codex' &&
    !baseEnv.CODEX_HOME &&
    (baseEnv.LODY_E2E === '1' || baseEnv.LODY_TITLE_AGENT === '1');

  const env = shouldUseWorkdirCodexHome
    ? {
        ...baseEnv,
        CODEX_HOME: path.join(options.workdir, '.codex'),
      }
    : baseEnv;
  // Spawning ACP agents from a GUI/daemon launch inherits a minimal PATH that
  // omits user tool dirs, so resolve the login-shell env and overlay it before
  // merging the agent-specific env. withDefaultAcpPathEntries still runs as a
  // last-resort fallback for environments where the shell probe yields nothing.
  const loginShellEnv = await getLoginShellEnv();
  const envWithAcpStartup = withoutElectronBootstrapCredentials(
    withLodyNpmCacheForNpx(
      launch.command,
      withDefaultAcpPathEntries(
        mergeACPProcessEnv(launch, mergeLoginShellEnv(env, loginShellEnv)),
        options.agentType
      )
    )
  );

  const keepCodexHome = env.LODY_KEEP_CODEX_HOME === '1';
  const defaultCodexHome = path.join(os.homedir(), '.codex');
  const defaultAuthPath = path.join(defaultCodexHome, 'auth.json');
  const localAuthPath = env.CODEX_HOME ? path.join(env.CODEX_HOME, 'auth.json') : null;
  const isTitleAgentRun = baseEnv.LODY_TITLE_AGENT === '1';

  // Codex config for isolated title-generation runs: keep the title agent's
  // context minimal and deterministic. No skills (avoids skill-budget warnings
  // and shrinks the system prompt), no project docs (AGENTS.md), and no
  // environment-context injection into the recorded user message.
  const TITLE_AGENT_CODEX_CONFIG_TOML = `project_doc_max_bytes = 0
include_environment_context = false

[skills]
include_instructions = false

[skills.bundled]
enabled = false
`;

  // One spawn + startup attempt. Self-contained so the npx self-heal path can retry it
  // cleanly: the codex CODEX_HOME setup/cleanup lives inside, so a failed attempt's
  // teardown does not leak into the retry.
  let lastStderrTail = '';
  const attemptStart = async (
    attemptArgs: readonly string[],
    startupTimeouts?: AcpStartupTimeoutOptions
  ) => {
    options.signal?.throwIfAborted();
    lastStderrTail = '';
    let copiedAuth = false;
    if (shouldUseWorkdirCodexHome) {
      fs.mkdirSync(env.CODEX_HOME!, { recursive: true });
      if (isTitleAgentRun) {
        fs.writeFileSync(path.join(env.CODEX_HOME!, 'config.toml'), TITLE_AGENT_CODEX_CONFIG_TOML);
      }
      // Codex often expects `auth.json` in CODEX_HOME even when running via ACP in tests.
      // Copy it from the user's default Codex home if it exists, then delete it on exit to
      // avoid leaving credentials in temporary directories.
      if (localAuthPath && fs.existsSync(defaultAuthPath) && !fs.existsSync(localAuthPath)) {
        try {
          fs.copyFileSync(defaultAuthPath, localAuthPath);
          copiedAuth = true;
        } catch {
          // Best-effort: let Codex fail with a clear auth error if copy is not possible.
        }
      }
    }

    captureAcpSpawnStarted(spawnAnalyticsProps);
    let agentProcess: ChildProcess;
    try {
      agentProcess = spawnAcpProcess({
        cliType: options.cliType,
        agentType: options.agentType,
        workdir: options.workdir,
        env: envWithAcpStartup,
        command: launch.command,
        args: [...attemptArgs],
        spawnImpl: options.spawnImpl,
      });
    } catch (error) {
      // Synchronous spawn failure (e.g. spawnImpl throws). Async ENOENT/EACCES
      // surface later via the startup monitor and are captured in the catch below.
      captureAcpSpawnFailed({ ...spawnAnalyticsProps, reason: classifyCliSpawnReason(error) });
      throw error;
    }
    options.logger.debug(
      `[acp-startup] spawned ACP process (cliType=${options.cliType} agentType=${options.agentType} workdir=${options.workdir})`
    );

    const stderrStream = agentProcess.stderr;
    let stderrTail = '';
    if (stderrStream) {
      stderrStream.setEncoding('utf8');
      stderrStream.on('data', (chunk: string) => {
        if (!chunk) return;
        stderrTail = appendStderrTail(stderrTail, chunk);
        lastStderrTail = stderrTail;
        options.logger.debug(
          `[acp-startup] stderr (${chunk.length} chars): ${truncateLogText(chunk, {
            maxChars: 1200,
            headChars: 900,
            tailChars: 180,
          })}`
        );
      });
    }

    const startupMonitor = createAcpStartupMonitor(
      {
        onExit: (listener) => {
          agentProcess.on('exit', listener);
          return () => {
            agentProcess.off('exit', listener);
          };
        },
        onError: (listener) => {
          agentProcess.on('error', listener);
          return () => {
            agentProcess.off('error', listener);
          };
        },
      },
      {
        sessionId: 'acp-startup',
        command: launch.command,
        args: [...attemptArgs],
        getStderrTail: () => stderrTail,
      }
    );

    if (shouldUseWorkdirCodexHome && env.CODEX_HOME && !keepCodexHome) {
      const cleanup = () => {
        try {
          if (copiedAuth && localAuthPath) {
            fs.rmSync(localAuthPath, { force: true });
          }
          fs.rmSync(env.CODEX_HOME!, { recursive: true, force: true });
        } catch {
          // ignore
        }
      };
      agentProcess.once('exit', cleanup);
      agentProcess.once('error', cleanup);
    }

    // Create streams with proper buffering and backpressure handling.
    // See utils/stream.ts for details on race condition and backpressure fixes.
    if (!agentProcess.stdout) {
      throw new Error('Agent process stdout is not available');
    }
    if (!agentProcess.stdin) {
      throw new Error('Agent process stdin is not available');
    }

    const output = createStdoutReadableStream(agentProcess.stdout);
    const input = createStdinWritableStream(agentProcess.stdin);
    const stream = ndJsonStream(input, output);

    let rejectSignalAbort: ((error: DOMException) => void) | undefined;
    const signalAbort = options.signal
      ? new Promise<never>((_resolve, reject) => {
          rejectSignalAbort = reject;
        })
      : null;
    const handleSignalAbort = (): void => {
      rejectSignalAbort?.(new DOMException('ACP startup was cancelled', 'AbortError'));
    };
    options.signal?.addEventListener('abort', handleSignalAbort, { once: true });
    try {
      options.signal?.throwIfAborted();
      options.logger.debug('[acp-startup] creating ACP client');
      const started = await createAcpClient({
        stream,
        workdir: options.workdir,
        logger: options.logger,
        terminalManager: options.terminalManager,
        agentConfig: {
          cliType: options.cliType,
          agentType: options.agentType,
        },
        launcher,
        terminalEnabled: options.terminalEnabled,
        onUpdateMessage: options.onUpdateMessage,
        onRequestPermission: options.onRequestPermission,
        startupTimeouts,
        startupAbort: signalAbort
          ? Promise.race([startupMonitor.abortPromise, signalAbort])
          : startupMonitor.abortPromise,
      });
      options.signal?.throwIfAborted();
      options.logger.debug(`[acp-startup] ACP client ready (acpSessionId=${started.acpSessionId})`);
      return {
        agentProcess,
        client: started.client as AgentClient,
        acpSessionId: started.acpSessionId as ACPSessionId,
        sessionResponse: started.sessionResponse,
      };
    } catch (error) {
      // The process died/failed to spawn before startup completed (the startup
      // monitor surfaces async ENOENT/EACCES/early-exit here). Protocol-level
      // failures are captured inside AgentClient.startSession, so only
      // spawn-level monitor errors are reported here to avoid double-counting.
      if (error instanceof AcpStartupProcessExitError || error instanceof AcpStartupProcessError) {
        captureAcpSpawnFailed({ ...spawnAnalyticsProps, reason: classifyCliSpawnReason(error) });
      }
      await terminateChildProcess(agentProcess, options.logger, 'acp-startup', 3000);

      throw error;
    } finally {
      options.signal?.removeEventListener('abort', handleSignalAbort);
      startupMonitor.dispose();
    }
  };

  return runNpxStartupWithRecovery({
    command: launch.command,
    args: launch.args,
    env: envWithAcpStartup,
    logger: options.logger,
    logPrefix: '[acp-startup]',
    attempt: ({ args, startupTimeouts }) => attemptStart(args, startupTimeouts),
    getStderrTail: () => lastStderrTail,
  });
};

export type ShutdownLocalAcpAgentOptions = {
  agentProcess: ChildProcess;
  client?: AgentClient | null;
  acpSessionId?: ACPSessionId | null;
  logger: Logger;
  sessionLabel: string;
  closeSessionTimeoutMs?: number;
  exitTimeoutMs?: number;
};

export async function shutdownLocalAcpAgent(options: ShutdownLocalAcpAgentOptions): Promise<void> {
  const closeSessionTimeoutMs = Math.max(0, options.closeSessionTimeoutMs ?? 5000);
  const exitTimeoutMs = Math.max(1, options.exitTimeoutMs ?? 3000);

  if (options.client && options.acpSessionId) {
    try {
      await options.client.closeSession(options.acpSessionId, closeSessionTimeoutMs);
    } catch (error) {
      options.logger.debug(
        `[${options.sessionLabel}] ACP session close failed during local agent shutdown: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  await terminateChildProcess(
    options.agentProcess,
    options.logger,
    options.sessionLabel,
    exitTimeoutMs
  );
}
