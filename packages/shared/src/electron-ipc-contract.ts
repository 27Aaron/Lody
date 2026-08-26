import type { LocalMachineRpcRequest } from './local-machine-rpc';
import type { LocalLoroDataPlaneClientMessage, LocalLoroDataPlaneServerMessage } from './local-loro-data-plane';
import type {
  LocalProjectControlRequest,
  LocalProjectDirectoryListResult,
  LocalProjectFileListResult,
  LocalProjectFileReadResult,
  LocalProjectHistoryCatalogResult,
  LocalProjectHistoryConflictResolveResult,
  LocalProjectHistoryImportResult,
  LocalSessionControlRequest,
} from './message';
import type { SessionId } from './ids';
import type { LocalProjectGitState, LocalProjectHistoryProvider } from './project';
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalOpenParams,
  TerminalOpenResult,
  TerminalSnapshot,
  TerminalTitleEvent,
} from './terminal-protocol';
import type {
  CheckForElectronUpdateResult,
  CopyImageToClipboardInput,
  CopyImageToClipboardResult,
  DesktopOnboardingCompleteResult,
  ElectronAuthCallbackInput,
  ElectronAuthCallbackSession,
  ElectronAutoLaunchStatusResult,
  ElectronCliState,
  ElectronDevEmailPasswordSignInInput,
  ElectronLocalPlatformSnapshot,
  ElectronLocalSessionControlResponseEvent,
  ElectronPublicBrowserBoundsInput,
  ElectronPublicBrowserCreateInput,
  ElectronPublicBrowserIdInput,
  ElectronPublicBrowserNavigateInput,
  ElectronPublicBrowserResult,
  ElectronPublicBrowserState,
  ElectronPublicBrowserVisibilityInput,
  ElectronUpdaterState,
  GetNotificationPermissionStatusResult,
  GlobalShortcutBinding,
  GlobalShortcutTriggeredPayload,
  LaunchLocalPathInput,
  LaunchLocalPathResult,
  OpenExternalUrlResult,
  OpenSystemNotificationSettingsResult,
  QuitAndInstallElectronUpdateResult,
  RestartCliResult,
  SaveImageFileInput,
  SaveImageFileResult,
  SendLocalMachineRpcResult,
  SendLocalProjectControlResult,
  SendLocalSessionControlResult,
  SendSessionFileLocalInput,
  SendSessionFileLocalResult,
  SessionCompletionNotificationClickPayload,
  SetElectronAutoLaunchResult,
  SetGlobalShortcutInput,
  SetGlobalShortcutResult,
  ShowImagePreviewMenuInput,
  ShowImagePreviewMenuResult,
  ShowSessionCompletionNotificationInput,
  ShowSessionCompletionNotificationResult,
  TerminateCliResult,
} from './electron-ipc';

export type CliOutputEvent = {
  runId: string;
  stream: 'stdout' | 'stderr' | 'meta';
  chunk: string;
};

export type RendererFatalErrorReport = {
  scope: string;
  message: string;
  details: string;
  copied?: boolean;
};

export type WindowBadgeInput = { unread: number; waiting: number };

export type SessionControlSendInput = {
  requestId: string;
  message: LocalSessionControlRequest;
};

export type NativeThemeSource = 'dark' | 'light' | 'system';

export interface AuthIpcContract {
    completeCallback: (input: ElectronAuthCallbackInput) => Promise<ElectronAuthCallbackSession>;
    signInWithDevEmailPassword: (input: ElectronDevEmailPasswordSignInInput) => Promise<unknown>;
    signOut: () => Promise<void>;
    getSession: (options?: unknown) => Promise<unknown>;
    listOrganizations: (options?: unknown) => Promise<unknown>;
    getActiveOrganization: (options?: unknown) => Promise<unknown>;
    changeEmail: (payload: unknown) => Promise<unknown>;
    listAccounts: (options?: unknown) => Promise<unknown>;
    updateUser: (payload: unknown) => Promise<unknown>;
    changePassword: (payload: unknown) => Promise<unknown>;
    requestPasswordReset: (payload: unknown) => Promise<unknown>;
    convexToken: (options?: unknown) => Promise<unknown>;
    crossDomainVerifyOneTimeToken: (payload: unknown) => Promise<unknown>;
    getInvitation: (payload: unknown) => Promise<unknown>;
    acceptInvitation: (payload: unknown) => Promise<unknown>;
    listInvitations: (payload?: unknown) => Promise<unknown>;
    inviteMember: (payload: unknown) => Promise<unknown>;
    cancelInvitation: (payload: unknown) => Promise<unknown>;
    removeMember: (payload: unknown) => Promise<unknown>;
    updateMemberRole: (payload: unknown) => Promise<unknown>;
    setActive: (payload: unknown) => Promise<unknown>;
    updateOrganization: (payload: unknown) => Promise<unknown>;
    createOrganization: (payload: unknown) => Promise<unknown>;
    deleteOrganization: (payload: unknown) => Promise<unknown>;
  leaveOrganization: (payload: unknown) => Promise<unknown>;
}

export interface UpdaterIpcContract {
    getState: () => Promise<ElectronUpdaterState>;
    checkForUpdates: () => Promise<CheckForElectronUpdateResult>;
  quitAndInstall: () => Promise<QuitAndInstallElectronUpdateResult>;
}

export interface CliIpcContract {
    getOutputBacklog: () => Promise<CliOutputEvent[]>;
    getState: () => Promise<ElectronCliState>;
    restart: () => Promise<RestartCliResult>;
    terminate: () => Promise<TerminateCliResult>;
    getAutoStartEnabled: () => Promise<{ enabled: boolean }>;
  setAutoStartEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
}

export interface PublicBrowserIpcContract {
    create: (input: ElectronPublicBrowserCreateInput) => Promise<ElectronPublicBrowserResult>;
    navigate: (input: ElectronPublicBrowserNavigateInput) => Promise<ElectronPublicBrowserResult>;
    back: (input: ElectronPublicBrowserIdInput) => Promise<ElectronPublicBrowserResult>;
    forward: (input: ElectronPublicBrowserIdInput) => Promise<ElectronPublicBrowserResult>;
    reload: (input: ElectronPublicBrowserIdInput) => Promise<ElectronPublicBrowserResult>;
    stop: (input: ElectronPublicBrowserIdInput) => Promise<ElectronPublicBrowserResult>;
    setBounds: (input: ElectronPublicBrowserBoundsInput) => Promise<ElectronPublicBrowserResult>;
    setVisible: (
      input: ElectronPublicBrowserVisibilityInput
    ) => Promise<ElectronPublicBrowserResult>;
  destroy: (input: ElectronPublicBrowserIdInput) => Promise<ElectronPublicBrowserResult>;
}

export interface LocalPlatformIpcContract {
  getSnapshot: () => Promise<ElectronLocalPlatformSnapshot | null>;
}

export interface SessionControlIpcContract {
  send: (input: SessionControlSendInput) => Promise<SendLocalSessionControlResult>;
}

export interface MachineRpcIpcContract {
  send: (message: LocalMachineRpcRequest) => Promise<SendLocalMachineRpcResult>;
}

export interface LoroIpcContract {
  isConnected: () => Promise<boolean>;
}

export interface TerminalIpcContract {
  list: (sessionId: string) => Promise<TerminalSnapshot[]>;
  open: (params: TerminalOpenParams) => Promise<TerminalOpenResult>;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
}

export interface NotificationsIpcContract {
  getPermissionStatus: () => Promise<GetNotificationPermissionStatusResult>;
  openSystemSettings: () => Promise<OpenSystemNotificationSettingsResult>;
  showSessionCompletion: (
    payload: ShowSessionCompletionNotificationInput
  ) => Promise<ShowSessionCompletionNotificationResult>;
}

export interface AppIpcContract {
  getFullscreen: () => Promise<boolean>;
  completeOnboarding: () => Promise<DesktopOnboardingCompleteResult>;
  getAutoLaunchStatus: () => Promise<ElectronAutoLaunchStatusResult>;
  setAutoLaunchEnabled: (enabled: boolean) => Promise<SetElectronAutoLaunchResult>;
  getGlobalShortcuts: () => Promise<GlobalShortcutBinding[]>;
  setGlobalShortcut: (input: SetGlobalShortcutInput) => Promise<SetGlobalShortcutResult>;
  setGlobalShortcutsSuspended: (suspended: boolean) => Promise<void>;
  setWindowBadge: (
    badge: WindowBadgeInput
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  openExternalUrl: (url: string) => Promise<OpenExternalUrlResult>;
  launchLocalPath: (input: LaunchLocalPathInput) => Promise<LaunchLocalPathResult>;
  setPreventSleepEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
  getPreventSleepEnabled: () => Promise<{ enabled: boolean }>;
  setLanguage: (locale: string) => Promise<void>;
  setNativeTheme: (source: NativeThemeSource) => Promise<void>;
  notifyRendererMounted: () => Promise<void>;
  reportRendererFatalError: (payload: RendererFatalErrorReport) => Promise<void>;
  requestRendererReload: () => Promise<void>;
}

export interface ImageIpcContract {
  showPreviewMenu: (input: ShowImagePreviewMenuInput) => Promise<ShowImagePreviewMenuResult>;
  copyToClipboard: (input: CopyImageToClipboardInput) => Promise<CopyImageToClipboardResult>;
  saveAs: (input: SaveImageFileInput) => Promise<SaveImageFileResult>;
}

export interface LocalProjectsIpcContract {
  control: (message: LocalProjectControlRequest) => Promise<SendLocalProjectControlResult>;
  sendSessionFileLocal: (input: SendSessionFileLocalInput) => Promise<SendSessionFileLocalResult>;
  selectDirectory: () => Promise<{ rootPath: string; machineId: string } | { error: string } | null>;
  getGitState: (
    workspaceId: string,
    localProjectId: string
  ) => Promise<LocalProjectGitState | { error: string }>;
  listFiles: (
    workspaceId: string,
    localProjectId: string,
    options?: { maxFiles?: number }
  ) => Promise<LocalProjectFileListResult>;
  listDir: (
    workspaceId: string,
    localProjectId: string,
    relativePath: string,
    options?: { limit?: number }
  ) => Promise<LocalProjectDirectoryListResult>;
  readFile: (
    workspaceId: string,
    localProjectId: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ) => Promise<LocalProjectFileReadResult | null>;
  listSessionWorktreeFiles: (
    repoKey: string,
    sessionId: string,
    options?: { maxFiles?: number }
  ) => Promise<LocalProjectFileListResult>;
  readSessionWorktreeFile: (
    repoKey: string,
    sessionId: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ) => Promise<LocalProjectFileReadResult | null>;
  checkoutBranch: (
    workspaceId: string,
    localProjectId: string,
    branchName: string
  ) => Promise<{ success: true; currentBranch: string } | { success: false; error: string }>;
  syncHistory: (
    provider: LocalProjectHistoryProvider,
    workspaceId: string,
    localProjectId: string
  ) => Promise<LocalProjectHistoryCatalogResult | { error: string }>;
  importHistory: (
    provider: LocalProjectHistoryProvider,
    workspaceId: string,
    localProjectId: string,
    acpSessionIds: string[]
  ) => Promise<LocalProjectHistoryImportResult | { error: string }>;
  resolveHistoryConflict: (
    provider: LocalProjectHistoryProvider,
    workspaceId: string,
    localProjectId: string,
    sessionId: SessionId,
    acpSessionId: string
  ) => Promise<LocalProjectHistoryConflictResolveResult | { error: string }>;
}

export type IpcServices = {
  auth: AuthIpcContract;
  updater: UpdaterIpcContract;
  cli: CliIpcContract;
  publicBrowser: PublicBrowserIpcContract;
  localPlatform: LocalPlatformIpcContract;
  sessionControl: SessionControlIpcContract;
  machineRpc: MachineRpcIpcContract;
  loro: LoroIpcContract;
  terminal: TerminalIpcContract;
  notifications: NotificationsIpcContract;
  app: AppIpcContract;
  image: ImageIpcContract;
  localProjects: LocalProjectsIpcContract;
};

export type IpcPushMap = {
  'terminal.event':
    | TerminalDataEvent
    | TerminalExitEvent
    | TerminalTitleEvent
    | { type: 'error'; code: string; message: string };
  'loro.event': LocalLoroDataPlaneServerMessage;
  'loro.status': boolean;
  'cli.output': CliOutputEvent;
  'cli.state': ElectronCliState;
  'updater.state': ElectronUpdaterState;
  'publicBrowser.state': ElectronPublicBrowserState;
  'sessionControl.response': ElectronLocalSessionControlResponseEvent;
  'app.deepLink': string;
  'app.menuAction': string;
  'app.fullscreen': boolean;
  'app.nativeTheme': 'light' | 'dark';
  'app.globalShortcut': GlobalShortcutTriggeredPayload;
  'app.sessionCompletionClick': SessionCompletionNotificationClickPayload;
};

export type IpcSendMap = {
  'terminal.attach': { terminalId: string; cols: number; rows: number };
  'terminal.input': { terminalId: string; data: string };
  'terminal.resize': { terminalId: string; cols: number; rows: number };
  'terminal.close': { terminalId: string };
  'terminal.closeSession': { sessionId: string };
  'loro.send': LocalLoroDataPlaneClientMessage;
  'loro.subscribe': null;
  'cli.subscribe': null;
};

export const IPC_PUSH_CHANNELS = {
  terminalEvent: 'terminal.event',
  loroEvent: 'loro.event',
  loroStatus: 'loro.status',
  cliOutput: 'cli.output',
  cliState: 'cli.state',
  updaterState: 'updater.state',
  publicBrowserState: 'publicBrowser.state',
  sessionControlResponse: 'sessionControl.response',
  appDeepLink: 'app.deepLink',
  appMenuAction: 'app.menuAction',
  appFullscreen: 'app.fullscreen',
  appNativeTheme: 'app.nativeTheme',
  appGlobalShortcut: 'app.globalShortcut',
  appSessionCompletionClick: 'app.sessionCompletionClick',
} as const satisfies { [K: string]: keyof IpcPushMap };

export const IPC_SEND_CHANNELS = {
  terminalAttach: 'terminal.attach',
  terminalInput: 'terminal.input',
  terminalResize: 'terminal.resize',
  terminalClose: 'terminal.close',
  terminalCloseSession: 'terminal.closeSession',
  loroSend: 'loro.send',
  loroSubscribe: 'loro.subscribe',
  cliSubscribe: 'cli.subscribe',
} as const satisfies { [K: string]: keyof IpcSendMap };

export const IPC_INVOKE_CHANNEL_GROUPS = {
  auth: [
    'completeCallback',
    'signInWithDevEmailPassword',
    'signOut',
    'getSession',
    'listOrganizations',
    'getActiveOrganization',
    'changeEmail',
    'listAccounts',
    'updateUser',
    'changePassword',
    'requestPasswordReset',
    'convexToken',
    'crossDomainVerifyOneTimeToken',
    'getInvitation',
    'acceptInvitation',
    'listInvitations',
    'inviteMember',
    'cancelInvitation',
    'removeMember',
    'updateMemberRole',
    'setActive',
    'updateOrganization',
    'createOrganization',
    'deleteOrganization',
    'leaveOrganization',
  ],
  updater: ['getState', 'checkForUpdates', 'quitAndInstall'],
  cli: [
    'getOutputBacklog',
    'getState',
    'restart',
    'terminate',
    'getAutoStartEnabled',
    'setAutoStartEnabled',
  ],
  publicBrowser: [
    'create',
    'navigate',
    'back',
    'forward',
    'reload',
    'stop',
    'setBounds',
    'setVisible',
    'destroy',
  ],
  localPlatform: ['getSnapshot'],
  sessionControl: ['send'],
  machineRpc: ['send'],
  loro: ['isConnected'],
  terminal: ['list', 'open', 'readClipboardText', 'writeClipboardText'],
  notifications: ['getPermissionStatus', 'openSystemSettings', 'showSessionCompletion'],
  app: [
    'getFullscreen',
    'completeOnboarding',
    'getAutoLaunchStatus',
    'setAutoLaunchEnabled',
    'getGlobalShortcuts',
    'setGlobalShortcut',
    'setGlobalShortcutsSuspended',
    'setWindowBadge',
    'openExternalUrl',
    'launchLocalPath',
    'setPreventSleepEnabled',
    'getPreventSleepEnabled',
    'setLanguage',
    'setNativeTheme',
    'notifyRendererMounted',
    'reportRendererFatalError',
    'requestRendererReload',
  ],
  image: ['showPreviewMenu', 'copyToClipboard', 'saveAs'],
  localProjects: [
    'control',
    'sendSessionFileLocal',
    'selectDirectory',
    'getGitState',
    'listFiles',
    'listDir',
    'readFile',
    'listSessionWorktreeFiles',
    'readSessionWorktreeFile',
    'checkoutBranch',
    'syncHistory',
    'importHistory',
    'resolveHistoryConflict',
  ],
} as const satisfies { [G in keyof IpcServices]: readonly (keyof IpcServices[G])[] };

export const IPC_INVOKE_CHANNELS = (
  Object.entries(IPC_INVOKE_CHANNEL_GROUPS) as [
    keyof IpcServices,
    readonly string[],
  ][]
).flatMap(([group, methods]) => methods.map((method) => `${group}.${method}`));

const PUSH_CHANNEL_VALUES: readonly string[] = Object.values(IPC_PUSH_CHANNELS);
const SEND_CHANNEL_VALUES: readonly string[] = Object.values(IPC_SEND_CHANNELS);

export function isIpcInvokeChannel(channel: string): boolean {
  return IPC_INVOKE_CHANNELS.includes(channel);
}

export function isIpcPushChannel(channel: string): channel is keyof IpcPushMap {
  return PUSH_CHANNEL_VALUES.includes(channel);
}

export function isIpcSendChannel(channel: string): channel is keyof IpcSendMap {
  return SEND_CHANNEL_VALUES.includes(channel);
}
