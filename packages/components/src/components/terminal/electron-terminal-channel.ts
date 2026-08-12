import type {
  TerminalChannel,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalOpenParams,
  TerminalOpenResult,
  TerminalSnapshot,
  TerminalTitleEvent,
  Unsubscribe,
} from './terminal-channel';

type ElectronTerminalApi = NonNullable<NonNullable<Window['api']>['terminal']>;

export class ElectronTerminalChannel implements TerminalChannel {
  constructor(private readonly api: ElectronTerminalApi) {}

  list(sessionId: string): Promise<TerminalSnapshot[]> {
    return this.api.list(sessionId);
  }

  open(params: TerminalOpenParams): Promise<TerminalOpenResult> {
    return this.api.open(params);
  }

  attach(terminalId: string, cols: number, rows: number): void {
    this.api.attach(terminalId, cols, rows);
  }

  input(terminalId: string, data: string): void {
    this.api.input(terminalId, data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.api.resize(terminalId, cols, rows);
  }

  close(terminalId: string): void {
    this.api.close(terminalId);
  }

  closeSession(sessionId: string): void {
    this.api.closeSession(sessionId);
  }

  readClipboardText(): string {
    return this.api.readClipboardText();
  }

  writeClipboardText(text: string): void {
    this.api.writeClipboardText(text);
  }

  onData(handler: (event: TerminalDataEvent) => void): Unsubscribe {
    return this.api.onData(handler);
  }

  onExit(handler: (event: TerminalExitEvent) => void): Unsubscribe {
    return this.api.onExit(handler);
  }

  onTitle(handler: (event: TerminalTitleEvent) => void): Unsubscribe {
    return this.api.onTitle(handler);
  }
}

export function createElectronTerminalChannel(): ElectronTerminalChannel | null {
  const terminalApi = typeof window === 'undefined' ? undefined : window.api?.terminal;
  return terminalApi ? new ElectronTerminalChannel(terminalApi) : null;
}
