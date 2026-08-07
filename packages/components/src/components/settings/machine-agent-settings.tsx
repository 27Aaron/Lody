import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from '@tanstack/react-router';
import { useCloudMutation } from '@lody/platform/react';
import { cloudOperations } from '@/lib/cloud-api-operations';
import {
  type AcpSessionMonitorSnapshot,
  type AgentConfigCliType,
  type AgentConfigId,
  type AgentConfigMeta,
  type AgentType,
  type CustomAcpLaunchSpec,
  type MachineId,
  type MachineViewMeta,
  type ProviderSetupTask,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { activeWorkspaceRuntimeAtom, authTokenAtom, type WorkspaceRuntime } from '@/atoms/runtime';
import { developerModeEnabledAtom } from '@/atoms/settings';
import { settingsDialogOpenAtom } from '@/atoms/settings';
import { sessionMetaCacheAtom } from '@/atoms/doc-meta';
import { currentWorkspaceIdAtom } from '@/atoms/workspace-context';
import { localMachineIdAtom } from '@/atoms/local-probe';
import {
  cmdCreateAgentConfigAtom,
  cmdCreateProviderSetupAtom,
  cmdRetryProviderSetupAtom,
  cmdUpdateAgentConfigAtom,
  deleteAgentConfigAtom,
  deleteProviderSetupAtom,
  getAllAgentConfigAtom,
  getAllProviderSetupsAtom,
} from '@/atoms/agents';
import { machineSettingsFilterAtom } from '@/atoms/settings-machine-tab';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useMachineActions } from '@/hooks/use-machine-actions';
import { useAgentConfigMigration } from '@/hooks/use-agent-config-migration';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { resyncMachineFlockRows } from '@/hooks/use-machine-flock-rows';
import { useMachineAcpBinaryActions } from '@/hooks/use-machine-acp-binary-actions';
import { useProviderSetupRuntimeProgress } from '@/hooks/use-provider-setup-runtime-progress';
import { useIsMobile } from '@/hooks/use-mobile';
import { canDeleteOfflineMachine, canManageAllMachines } from '@/lib/machine-deletion';
import { useAppCapability } from '@/lib/app-platform';
import {
  fetchLatestCliVersion,
  isCliVersionOutdated,
  mintMachineLifecycleRequestToken,
  type MachineLifecycleAction,
} from '@/lib/machine-lifecycle-api';
import { useOrganization } from '@/hooks/useOrganization';
import { useStableSession } from '@/hooks/useStableSession';
import { useOnlineMachineIds } from '@/hooks/use-machine-online-status';
import { useCloudQuery } from '@lody/platform/react';
import { useConvexErrorMessage } from '@/hooks/use-convex-error-message';
import { formatSessionTabSearch } from '@/lib/session-tab-url';
import { useMachineMonitor } from '@/hooks/use-machine-monitor';
import { useMachineLifecycleCapability } from '@/hooks/use-machine-lifecycle-capability';
import { MachineTabList, buildMachineTabItems } from './machine-tab-list';
import { MachineDetailPane, MachineProvidersSection } from './machine-detail-pane';
import { resolveDesktopMachineSelection } from './machine-selection';
import { MachinePills } from './machine-pills';
import {
  AgentConfigDialog,
  type AgentConfigDialogMode,
  type AgentConfigSubmitPayload,
} from './agent-config-dialog';

export type MachineAgentSettingsProps = {
  selectedMachineId: MachineId | null;
  onSelectedMachineChange: (next: MachineId | null) => void;
  mode?: 'agents' | 'devices';
};

const createMachineRequestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const waitForMonitorSessionRemoval = async (args: {
  runtime: WorkspaceRuntime;
  machineId: MachineId;
  sessionId: SessionId;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };

    timeout = setTimeout(() => finish(new Error(args.timeoutMessage)), args.timeoutMs);
    const nextUnsubscribe = args.runtime.subscribeMachineMonitor(args.machineId, (snapshot) => {
      if (snapshot && !snapshot.sessions.some((session) => session.sessionId === args.sessionId)) {
        finish();
      }
    });
    unsubscribe = nextUnsubscribe;
    if (settled) nextUnsubscribe();
    else args.runtime.forceMachineMonitorSample(args.machineId);
  });

async function pingMachineWithRuntime(args: {
  runtime: WorkspaceRuntime;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  timeoutMessage: string;
  failedMessage: string;
}): Promise<number> {
  const requestId = createMachineRequestId();
  const startedAt = performance.now();
  const responsePromise = args.runtime.waitForMachinePingResponse(args.machineId, requestId, {
    timeoutMs: 30000,
  });
  args.runtime.sendControl({
    type: 'machine/ping',
    machineId: args.machineId,
    workspaceId: args.workspaceId,
    requestId,
  });
  const response = await responsePromise;
  if (!response) {
    throw new Error(args.timeoutMessage);
  }
  if (!response.success || response.message !== 'pong') {
    const errorMessage =
      typeof response.error === 'string' && response.error.length > 0
        ? response.error
        : args.failedMessage;
    throw new Error(errorMessage);
  }
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function MachineAgentSettings({
  selectedMachineId,
  onSelectedMachineChange,
  mode = 'agents',
}: MachineAgentSettingsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const authToken = useAtomValue(authTokenAtom);
  const developerModeEnabled = useAtomValue(developerModeEnabledAtom);
  const setSettingsDialogOpen = useSetAtom(settingsDialogOpenAtom);
  const sessionMetaCache = useAtomValue(sessionMetaCacheAtom);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const getConvexErrorMessage = useConvexErrorMessage();
  // Remote daemon restart/upgrade is brokered through the cloud control plane
  // (lifecycle token mint); machine sharing needs workspace members. Both are
  // cloud-only surfaces hidden on the local platform.
  const remoteMachinesAvailable = useAppCapability('remoteMachines');
  const teamSharingAvailable = useAppCapability('teamSharing');
  const { data: session } = useStableSession();
  const { activeOrganization } = useOrganization();
  const members = useMemo(() => activeOrganization?.members ?? [], [activeOrganization?.members]);
  const currentUserId = session?.user?.id ?? null;

  const { machines, accessByMachineId, isLoading } = useVisibleMachineMetas();
  const visibleMachineIdsForAgentConfigs = useMemo(() => [...machines.keys()], [machines]);
  useMachineFlockAgentConfigsForMachineIds(visibleMachineIdsForAgentConfigs);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const onlineMachineIds = useOnlineMachineIds();

  const allConfigs = useAtomValue(getAllAgentConfigAtom);
  const allSetups = useAtomValue(getAllProviderSetupsAtom);
  useProviderSetupRuntimeProgress(runtime, workspaceId, allSetups);
  const createConfig = useSetAtom(cmdCreateAgentConfigAtom);
  const createSetup = useSetAtom(cmdCreateProviderSetupAtom);
  const retrySetup = useSetAtom(cmdRetryProviderSetupAtom);
  const updateConfig = useSetAtom(cmdUpdateAgentConfigAtom);
  const deleteConfig = useSetAtom(deleteAgentConfigAtom);
  const deleteSetup = useSetAtom(deleteProviderSetupAtom);

  const [filter, setFilter] = [
    useAtomValue(machineSettingsFilterAtom),
    useSetAtom(machineSettingsFilterAtom),
  ];

  const migration = useAgentConfigMigration();

  const canManageOthers = useMemo(
    () => canManageAllMachines(currentUserId, members),
    [currentUserId, members]
  );

  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.user?.name || member.user?.email || member.userId);
    }
    return map;
  }, [members]);

  const isOwnMachine = useCallback(
    (machine: MachineViewMeta) => {
      if (localMachineId && machine.id === localMachineId) return true;
      const access = accessByMachineId.get(machine.id);
      if (currentUserId && access?.ownerUserId === currentUserId) return true;
      return false;
    },
    [accessByMachineId, currentUserId, localMachineId]
  );

  const { items: tabItems, totalBeforeFilter } = useMemo(() => {
    return buildMachineTabItems({
      machines,
      accessByMachineId,
      onlineMachineIds,
      isOwnMachine,
      filter,
    });
  }, [machines, accessByMachineId, onlineMachineIds, isOwnMachine, filter]);

  const allItems = useMemo(() => {
    return buildMachineTabItems({
      machines,
      accessByMachineId,
      onlineMachineIds,
      isOwnMachine,
      filter: { onlineOnly: false, mineOnly: false },
    }).items;
  }, [machines, accessByMachineId, onlineMachineIds, isOwnMachine]);
  const localDeviceItems = useMemo(
    () => (localMachineId ? allItems.filter((item) => item.machine.id === localMachineId) : []),
    [allItems, localMachineId]
  );

  // Remote-capable Devices stays inside the filtered visible pool. A local-only
  // platform has no machine selection surface, so it binds directly to the
  // local machine and cannot be blanked by a stale list filter. Agents still
  // renders every machine; remote-capable mobile keeps its list→detail flow.
  const selectionPool =
    mode === 'devices' ? (remoteMachinesAvailable ? tabItems : localDeviceItems) : allItems;
  const { resolved: resolvedDesktopMachine, nextSelectedMachineId } = useMemo(
    () =>
      resolveDesktopMachineSelection({
        pool: selectionPool,
        selectedMachineId,
        localMachineId,
      }),
    [selectionPool, selectedMachineId, localMachineId]
  );

  useEffect(() => {
    if (isMobile) return;
    if (machines.size === 0) return;
    if (nextSelectedMachineId !== selectedMachineId) {
      onSelectedMachineChange(nextSelectedMachineId);
    }
  }, [isMobile, machines, selectedMachineId, nextSelectedMachineId, onSelectedMachineChange]);

  const resolvedSelectedMachine: MachineViewMeta | undefined = isMobile
    ? mode === 'devices' && !remoteMachinesAvailable
      ? localMachineId
        ? machines.get(localMachineId)
        : undefined
      : selectedMachineId
        ? machines.get(selectedMachineId)
        : undefined
    : resolvedDesktopMachine;
  const credentialState = useCloudQuery(
    cloudOperations.machineCredentials.getMachineCredentialState,
    mode === 'devices' && workspaceId && resolvedSelectedMachine
      ? { workspaceId, machineId: resolvedSelectedMachine.id }
      : 'skip'
  );
  const revokeMachineCredentialsMutation = useCloudMutation(
    cloudOperations.machineCredentials.revokeMachineCredentials
  );

  const configsForMachine = useMemo(() => {
    if (!resolvedSelectedMachine) return [] as AgentConfigMeta[];
    return allConfigs
      .filter((c) => c.machineId === resolvedSelectedMachine.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allConfigs, resolvedSelectedMachine]);
  const setupsForMachine = useMemo(() => {
    if (!resolvedSelectedMachine) return [] as ProviderSetupTask[];
    return allSetups
      .filter((setup) => setup.machineId === resolvedSelectedMachine.id)
      .sort((left, right) => left.createdAt - right.createdAt);
  }, [allSetups, resolvedSelectedMachine]);

  const actions = useMachineActions({
    currentUserId,
    localMachineId,
    canManageAllMachines: canManageOthers,
  });
  const revokeMachineCredentials = useCallback(async () => {
    if (!workspaceId || !resolvedSelectedMachine) return;
    try {
      const result = await revokeMachineCredentialsMutation({
        workspaceId,
        machineId: resolvedSelectedMachine.id,
      });
      toast.success(
        t('settings.devices.credentials.revoked', '{{count}} machine credential revoked', {
          count: result.revokedCount,
        })
      );
    } catch (error) {
      toast.error(getConvexErrorMessage(error, 'Failed to revoke machine credentials.'));
      // Rethrow so callers (e.g. the revoke confirm dialog) can tell failure from
      // success — the error toast is surfaced here, exactly once.
      throw error;
    }
  }, [
    getConvexErrorMessage,
    resolvedSelectedMachine,
    revokeMachineCredentialsMutation,
    t,
    workspaceId,
  ]);

  const [dialogMode, setDialogMode] = useState<AgentConfigDialogMode | null>(null);
  // The provider dialog targets whichever machine's accordion row opened it,
  // decoupled from any single "selected machine" now that desktop lists them all.
  const [dialogMachine, setDialogMachine] = useState<MachineViewMeta | null>(null);
  const dialogOpen = dialogMode !== null;
  const [latestCliVersion, setLatestCliVersion] = useState<string | null>(null);

  const sharedWithTeam = resolvedSelectedMachine
    ? (accessByMachineId.get(resolvedSelectedMachine.id)?.sharedWithTeam ?? false)
    : false;
  const isLocal = !!resolvedSelectedMachine && resolvedSelectedMachine.id === localMachineId;
  const isOwn = resolvedSelectedMachine ? isOwnMachine(resolvedSelectedMachine) : false;
  const selectedIsOnline =
    !!resolvedSelectedMachine && onlineMachineIds.has(resolvedSelectedMachine.id);
  const ownerName = resolvedSelectedMachine
    ? (ownerNameMap.get(
        accessByMachineId.get(resolvedSelectedMachine.id)?.ownerUserId ??
          resolvedSelectedMachine.ownerUserId ??
          ''
      ) ?? null)
    : null;
  const selectedCanDelete =
    !!resolvedSelectedMachine &&
    canDeleteOfflineMachine({
      machine: resolvedSelectedMachine,
      isOnline: selectedIsOnline,
      currentUserId,
      localMachineId,
      canManageAllMachines: canManageOthers,
    });
  const selectedOwnerUserId =
    resolvedSelectedMachine && accessByMachineId.get(resolvedSelectedMachine.id)?.ownerUserId
      ? accessByMachineId.get(resolvedSelectedMachine.id)?.ownerUserId
      : resolvedSelectedMachine?.ownerUserId;
  const selectedCanManageLifecycle =
    remoteMachinesAvailable &&
    !!resolvedSelectedMachine &&
    !!currentUserId &&
    selectedOwnerUserId === currentUserId;
  // Probed for the single selected machine (both mobile detail + desktop pills).
  const selectedLifecycleCapability = useMachineLifecycleCapability({
    machineId: resolvedSelectedMachine?.id ?? null,
    enabled: selectedCanManageLifecycle && selectedIsOnline,
  });
  const selectedCanRemoteRestart =
    selectedCanManageLifecycle &&
    selectedIsOnline &&
    selectedLifecycleCapability?.canRemoteRestart === true;
  const selectedCanRemoteUpgrade =
    selectedCanManageLifecycle &&
    selectedIsOnline &&
    selectedLifecycleCapability?.canRemoteUpgrade === true;
  const selectedUpdateAvailable =
    selectedCanRemoteUpgrade &&
    isCliVersionOutdated(resolvedSelectedMachine?.cliVersion, latestCliVersion ?? undefined);
  const selectedDaemonUpdate =
    selectedUpdateAvailable && resolvedSelectedMachine?.cliVersion && latestCliVersion
      ? {
          currentVersion: resolvedSelectedMachine.cliVersion,
          latestVersion: latestCliVersion,
        }
      : undefined;
  const machineMonitor = useMachineMonitor({
    machineId: resolvedSelectedMachine?.id ?? null,
    enabled: mode === 'devices',
    online: selectedIsOnline,
  });
  const monitorSessionMetas = useMemo(() => Object.values(sessionMetaCache), [sessionMetaCache]);
  const openMonitorSession = useCallback(
    (monitoredSession: AcpSessionMonitorSnapshot) => {
      const meta = monitorSessionMetas.find((entry) => entry.id === monitoredSession.sessionId);
      const parentSessionId =
        meta?.parentSessionId ?? monitoredSession.parentSessionId ?? monitoredSession.sessionId;
      const workspaceSlug = activeOrganization?.slug;
      if (!workspaceSlug) return;
      setSettingsDialogOpen(false);
      void navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId: parentSessionId },
        search: {
          tab: formatSessionTabSearch(monitoredSession.sessionId, parentSessionId),
        },
      });
    },
    [activeOrganization?.slug, monitorSessionMetas, navigate, setSettingsDialogOpen]
  );
  const terminateMonitorSession = useCallback(
    async (machine: MachineViewMeta, monitoredSession: AcpSessionMonitorSnapshot) => {
      if (!runtime) {
        throw new Error(
          t('settings.devices.sessions.terminateUnavailable', 'Device is unavailable')
        );
      }
      const response = await runtime.requestSessionTerminate(
        machine.id,
        monitoredSession.sessionId,
        { timeoutMs: 30_000 }
      );
      if (!response?.success) {
        throw new Error(
          response?.error ??
            t('settings.devices.sessions.terminateFailed', 'Failed to terminate ACP process')
        );
      }
      await waitForMonitorSessionRemoval({
        runtime,
        machineId: machine.id,
        sessionId: monitoredSession.sessionId,
        timeoutMs: 15_000,
        timeoutMessage: t(
          'settings.devices.sessions.terminateStillPresent',
          'The ACP process is still present in device monitoring'
        ),
      });
    },
    [runtime, t]
  );

  useEffect(() => {
    // The latest-version probe only feeds the remote upgrade affordance; skip
    // the network call entirely when remote lifecycle is unavailable.
    if (!remoteMachinesAvailable) return undefined;
    let cancelled = false;
    void fetchLatestCliVersion().then((result) => {
      if (cancelled) return;
      setLatestCliVersion(result.ok ? result.latestVersion : null);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteMachinesAvailable]);

  const refreshCapabilities = useCallback(
    async (args: {
      machineId: MachineId;
      configId: AgentConfigId;
      cliType: AgentConfigCliType;
      agentType: string;
      customAcp?: CustomAcpLaunchSpec;
      runtimeOverrides?: AgentConfigMeta['runtimeOverrides'];
      env?: Record<string, string>;
    }) => {
      if (!runtime || !workspaceId) {
        throw new Error(t('chat.validation.missingContext', 'Missing workspace context'));
      }
      if (!args.agentType.trim()) {
        throw new Error(t('agents.validation.missingAgentType', 'Agent type is required'));
      }
      const response = await runtime.requestMachineAcpCapabilitiesRefresh({
        type: 'machine/acp-capabilities-refresh',
        machineId: args.machineId,
        workspaceId,
        configId: args.configId,
        cliType: args.cliType,
        agentType: args.agentType as AgentType,
        customAcp: args.customAcp,
        runtimeOverrides: args.runtimeOverrides,
        env: args.env,
      });
      if (!response) {
        throw new Error(
          t('agents.acpCapabilities.refreshTimeout', 'Refresh timed out, please try again')
        );
      }
      if (!response.success) {
        if (response.authRequired) {
          return response;
        }
        const errorMessage =
          typeof response.error === 'string' && response.error.length > 0
            ? response.error
            : t('agents.acpCapabilities.refreshError', 'Refresh failed');
        throw new Error(errorMessage);
      }
      // The CLI wrote the fresh capabilities to the machine flock doc, which the
      // web only syncs once per session; force a re-sync so chat landing and the
      // settings dialog reflect the new modes/models without a reload.
      await resyncMachineFlockRows(runtime, args.machineId);
      return response;
    },
    [runtime, t, workspaceId]
  );

  const pingMachine = useCallback(
    (machineId: MachineId): Promise<number> => {
      if (!runtime || !workspaceId) {
        return Promise.reject(
          new Error(t('chat.validation.missingContext', 'Missing workspace context'))
        );
      }

      return pingMachineWithRuntime({
        runtime,
        workspaceId,
        machineId,
        timeoutMessage: t('settings.agent.machinePing.timeout', 'Ping timed out'),
        failedMessage: t('settings.agent.machinePing.failed', 'Ping failed'),
      });
    },
    [runtime, t, workspaceId]
  );

  const requestMachineLifecycle = useCallback(
    async (args: {
      machineId: MachineId;
      action: MachineLifecycleAction;
      targetVersion?: string;
    }) => {
      if (!runtime || !workspaceId || !authToken) {
        throw new Error(t('chat.validation.missingContext', 'Missing workspace context'));
      }

      const requestId = createMachineRequestId();
      const minted = await mintMachineLifecycleRequestToken({
        workspaceId,
        machineId: args.machineId,
        action: args.action,
        requestId,
        targetVersion: args.targetVersion,
        sessionToken: authToken,
      });
      if (!minted.ok) {
        throw new Error(minted.error);
      }

      if (args.action === 'restart') {
        const responsePromise = runtime.waitForMachineRestartResponse(args.machineId, requestId, {
          timeoutMs: 30000,
        });
        runtime.sendControl({
          type: 'machine/restart',
          machineId: args.machineId,
          workspaceId,
          requesterUserId: minted.requesterUserId,
          requestToken: minted.requestToken,
          requestId,
        });
        const response = await responsePromise;
        if (!response) {
          throw new Error(
            t('settings.agent.machineLifecycle.restartTimeout', 'Restart request timed out')
          );
        }
        if (!response.success || !response.accepted) {
          throw new Error(
            response.error ||
              t('settings.agent.machineLifecycle.restartFailed', 'Restart request failed')
          );
        }
        return;
      }

      const responsePromise = runtime.waitForMachineUpgradeResponse(args.machineId, requestId, {
        timeoutMs: 120000,
      });
      runtime.sendControl({
        type: 'machine/upgrade',
        machineId: args.machineId,
        workspaceId,
        requesterUserId: minted.requesterUserId,
        requestToken: minted.requestToken,
        requestId,
        targetVersion: args.targetVersion,
      });
      const response = await responsePromise;
      if (!response) {
        throw new Error(
          t('settings.agent.machineLifecycle.upgradeTimeout', 'Update request timed out')
        );
      }
      if (!response.success || !response.accepted) {
        throw new Error(
          response.error ||
            t('settings.agent.machineLifecycle.upgradeFailed', 'Update request failed')
        );
      }
    },
    [authToken, runtime, t, workspaceId]
  );

  const restartMachine = useCallback(
    async (machineId: MachineId) => {
      await requestMachineLifecycle({ machineId, action: 'restart' });
    },
    [requestMachineLifecycle]
  );

  const upgradeMachine = useCallback(
    async (machineId: MachineId, targetVersion: string) => {
      await requestMachineLifecycle({ machineId, action: 'upgrade', targetVersion });
    },
    [requestMachineLifecycle]
  );

  const handleRefreshConfig = useCallback(
    async (config: AgentConfigMeta) => {
      await refreshCapabilities({
        machineId: config.machineId,
        configId: config.id,
        cliType: config.cliType,
        agentType: config.agentType,
        customAcp: config.customAcp,
        runtimeOverrides: config.runtimeOverrides,
        env: config.env,
      });
    },
    [refreshCapabilities]
  );

  const { checkBinaryStatus, installBinary } = useMachineAcpBinaryActions(runtime, workspaceId);

  const openCreateDialog = useCallback((machine: MachineViewMeta) => {
    setDialogMachine(machine);
    setDialogMode({ kind: 'create' });
  }, []);

  const openEditDialog = useCallback((machine: MachineViewMeta, config: AgentConfigMeta) => {
    setDialogMachine(machine);
    setDialogMode({ kind: 'edit', config });
  }, []);

  const handleDialogSubmit = useCallback(
    async (payload: AgentConfigSubmitPayload) => {
      if (!dialogMachine || !dialogMode) return;
      try {
        if (dialogMode.kind === 'create') {
          const config: AgentConfigMeta = {
            id: payload.id,
            name: payload.name,
            description: payload.description,
            cliType: payload.cliType,
            agentType: payload.agentType,
            customAcp: payload.customAcp,
            runtimeOverrides: payload.runtimeOverrides,
            env: payload.env,
            prompt: payload.prompt,
            titleGeneration: payload.titleGeneration,
            brandId: payload.brandId,
            machineId: dialogMachine.id,
          };
          if (payload.backgroundSetup) {
            await createSetup(config);
          } else {
            await createConfig(config);
          }
        } else {
          await updateConfig({
            id: dialogMode.config.id as AgentConfigId,
            machineId: dialogMode.config.machineId,
            name: payload.name,
            description: payload.description,
            cliType: payload.cliType,
            agentType: payload.agentType,
            customAcp: payload.customAcp,
            runtimeOverrides: payload.runtimeOverrides,
            env: payload.env,
            prompt: payload.prompt,
            titleGeneration: payload.titleGeneration,
            brandId: payload.brandId,
          });
        }
      } catch (error) {
        console.error('Failed to save agent config:', error);
        toast.error(
          dialogMode.kind === 'create'
            ? t('agents.createConfigError', 'Failed to create configuration')
            : t('agents.updateConfigError', 'Failed to update configuration')
        );
        throw error;
      }
    },
    [dialogMachine, dialogMode, createConfig, createSetup, updateConfig, t]
  );

  const handleRetrySetup = useCallback(
    async (setup: ProviderSetupTask) => {
      try {
        await retrySetup(setup.id);
      } catch (error) {
        toast.error(t('settings.agent.setup.retryFailed', 'Could not retry provider setup'));
        throw error;
      }
    },
    [retrySetup, t]
  );

  const handleDeleteSetup = useCallback(
    async (setup: ProviderSetupTask) => {
      try {
        await deleteSetup(setup.id);
      } catch (error) {
        toast.error(t('settings.agent.setup.deleteFailed', 'Could not cancel provider setup'));
        throw error;
      }
    },
    [deleteSetup, t]
  );

  const handleDeleteConfig = useCallback(
    async (config: AgentConfigMeta) => {
      try {
        await deleteConfig(config.id);
      } catch (error) {
        console.error('Failed to delete agent config:', error);
        toast.error(t('agents.deleteConfigError', 'Failed to delete configuration'));
        throw error;
      }
    },
    [deleteConfig, t]
  );

  const showBanner = mode === 'agents' && migration.status === 'running';
  const hasMachines = machines.size > 0;

  const banner = showBanner ? (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t('settings.agent.migration.banner', 'Upgrading agent configs to be per-machine…')}
    </div>
  ) : null;

  const dialog =
    dialogMode && dialogMachine ? (
      <AgentConfigDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null);
        }}
        nestedInDialog={!isMobile}
        mode={dialogMode}
        machine={dialogMachine}
        onSubmit={handleDialogSubmit}
        onRefreshCapabilities={refreshCapabilities}
        onCheckBinaryStatus={checkBinaryStatus}
        onInstallBinary={installBinary}
        deferManagedBuiltinCreation
      />
    ) : null;

  if (isLoading && !hasMachines) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('workspace.machines.loadingVisibility', 'Loading machines')}
      </div>
    );
  }

  if (!hasMachines) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        {t('workspace.machines.empty', 'No machines connected')}
      </div>
    );
  }

  // Mobile: detail-only when a machine is selected, else list-only.
  if (isMobile) {
    if (resolvedSelectedMachine) {
      return (
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
          {banner ? <div className="px-3 pt-3">{banner}</div> : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MachineDetailPane
              key={resolvedSelectedMachine.id}
              mode={mode}
              machine={resolvedSelectedMachine}
              configs={configsForMachine}
              setups={setupsForMachine}
              isOwn={isOwn}
              isLocal={isLocal}
              ownerName={ownerName}
              sharedWithTeam={sharedWithTeam}
              canDelete={selectedCanDelete}
              onRename={actions.renameMachine}
              onDelete={actions.deleteMachine}
              onSharedWithTeamChange={
                isOwn && teamSharingAvailable ? actions.setSharedWithTeam : undefined
              }
              onAddConfig={() => openCreateDialog(resolvedSelectedMachine)}
              onEditConfig={(config) => openEditDialog(resolvedSelectedMachine, config)}
              onDeleteConfig={handleDeleteConfig}
              onRefreshConfig={handleRefreshConfig}
              onRetrySetup={handleRetrySetup}
              onDeleteSetup={handleDeleteSetup}
              onPing={developerModeEnabled ? pingMachine : undefined}
              daemonUpdate={selectedDaemonUpdate}
              onRestartDaemon={selectedCanRemoteRestart ? restartMachine : undefined}
              onUpgradeDaemon={selectedDaemonUpdate ? upgradeMachine : undefined}
              monitorSnapshot={machineMonitor.snapshot}
              monitorState={machineMonitor.state}
              monitorSessionMetas={monitorSessionMetas}
              onOpenMonitorSession={openMonitorSession}
              onTerminateMonitorSession={(monitoredSession) =>
                terminateMonitorSession(resolvedSelectedMachine, monitoredSession)
              }
            />
          </div>
          {dialog}
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 p-3">
        {banner}
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          <MachineTabList
            variant="detailed"
            items={tabItems}
            selectedMachineId={null}
            onSelect={(machineId) => onSelectedMachineChange(machineId)}
            filter={filter}
            onFilterChange={setFilter}
            totalBeforeFilter={totalBeforeFilter}
          />
        </div>
      </div>
    );
  }

  // Desktop Agents: a machine pill selector under the title; the selected pill's
  // providers render below. Desktop Devices: machines get their own left column
  // (with per-row share status) and the selected machine renders as a detail
  // pane whose header exposes rename/share/restart/revoke/delete inline.
  const title =
    mode === 'devices'
      ? t('settings.tabs.devices', 'Devices')
      : t('settings.tabs.agentConfig', 'Agents');
  const subtitle =
    mode === 'devices'
      ? remoteMachinesAvailable
        ? t(
            'settings.categories.devices.description',
            'Resource usage and running agents on each connected device.'
          )
        : t(
            'settings.categories.devices.localDescription',
            'Resource usage and running agents on this device.'
          )
      : t(
          'settings.categories.agentConfig.description',
          'Code agents configured on each of your machines.'
        );

  const header = (
    <div className="min-w-0">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );

  if (mode === 'devices') {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        {banner}
        {header}
        <div className="flex min-w-0 items-start gap-5">
          {remoteMachinesAvailable ? (
            <aside className="w-60 shrink-0">
              <MachineTabList
                items={tabItems}
                selectedMachineId={resolvedSelectedMachine?.id ?? null}
                onSelect={(machineId) => onSelectedMachineChange(machineId)}
                filter={filter}
                onFilterChange={setFilter}
                totalBeforeFilter={totalBeforeFilter}
              />
            </aside>
          ) : null}
          <div className="min-w-0 flex-1">
            {resolvedSelectedMachine ? (
              <MachineDetailPane
                key={resolvedSelectedMachine.id}
                mode="devices"
                machine={resolvedSelectedMachine}
                configs={configsForMachine}
                setups={setupsForMachine}
                isOwn={isOwn}
                isLocal={isLocal}
                ownerName={ownerName}
                sharedWithTeam={sharedWithTeam}
                canDelete={selectedCanDelete}
                onRename={actions.renameMachine}
                onDelete={actions.deleteMachine}
                onSharedWithTeamChange={
                  isOwn && teamSharingAvailable ? actions.setSharedWithTeam : undefined
                }
                onAddConfig={() => openCreateDialog(resolvedSelectedMachine)}
                onEditConfig={(config) => openEditDialog(resolvedSelectedMachine, config)}
                onDeleteConfig={handleDeleteConfig}
                onRefreshConfig={handleRefreshConfig}
                onRetrySetup={handleRetrySetup}
                onDeleteSetup={handleDeleteSetup}
                onPing={developerModeEnabled ? pingMachine : undefined}
                daemonUpdate={selectedDaemonUpdate}
                onRestartDaemon={selectedCanRemoteRestart ? restartMachine : undefined}
                onUpgradeDaemon={selectedDaemonUpdate ? upgradeMachine : undefined}
                canRevokeCredentials={isOwn && (credentialState?.revocableCount ?? 0) > 0}
                onRevokeCredentials={revokeMachineCredentials}
                monitorSnapshot={machineMonitor.snapshot}
                monitorState={machineMonitor.state}
                monitorSessionMetas={monitorSessionMetas}
                onOpenMonitorSession={openMonitorSession}
                onTerminateMonitorSession={(monitoredSession) =>
                  terminateMonitorSession(resolvedSelectedMachine, monitoredSession)
                }
              />
            ) : (
              <div className="px-1 py-8 text-center text-sm text-muted-foreground">
                {t('settings.agent.machineTabs.selectPromptDevice', 'Select a device.')}
              </div>
            )}
          </div>
        </div>
        {dialog}
      </div>
    );
  }

  const machinePills = allItems.map((item) => ({
    id: item.machine.id,
    label: item.machine.name || item.machine.id,
    online: item.isOnline,
  }));

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {banner}
      {header}

      <MachinePills
        pills={machinePills}
        selectedId={resolvedSelectedMachine?.id ?? null}
        onSelect={(id) => onSelectedMachineChange(id as MachineId)}
      />

      {resolvedSelectedMachine ? (
        <MachineProvidersSection
          key={resolvedSelectedMachine.id}
          flush
          machine={resolvedSelectedMachine}
          configs={configsForMachine}
          setups={setupsForMachine}
          onAddConfig={() => openCreateDialog(resolvedSelectedMachine)}
          onEditConfig={(config) => openEditDialog(resolvedSelectedMachine, config)}
          onDeleteConfig={handleDeleteConfig}
          onRefreshConfig={handleRefreshConfig}
          onRetrySetup={handleRetrySetup}
          onDeleteSetup={handleDeleteSetup}
        />
      ) : (
        <div className="px-1 py-8 text-center text-sm text-muted-foreground">
          {t('settings.agent.machineTabs.selectPromptAgent', 'Select a machine.')}
        </div>
      )}
      {dialog}
    </div>
  );
}
