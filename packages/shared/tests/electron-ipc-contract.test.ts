import { describe, expect, it } from 'vitest';
import {
  IPC_INVOKE_CHANNELS,
  IPC_PUSH_CHANNELS,
  IPC_SEND_CHANNELS,
  isIpcInvokeChannel,
  isIpcPushChannel,
  isIpcSendChannel,
} from '../src/electron-ipc-contract';

describe('IPC channel allowlists', () => {
  it('accepts registered invoke channels and rejects unknown ones', () => {
    expect(isIpcInvokeChannel('auth.getSession')).toBe(true);
    expect(isIpcInvokeChannel('lodyAuth:getSession')).toBe(false);
    expect(IPC_INVOKE_CHANNELS).toContain('localPlatform.getSnapshot');
    expect(IPC_INVOKE_CHANNELS).toContain('sessionControl.send');
  });

  it('types push and send maps onto the new group.method names', () => {
    expect(IPC_PUSH_CHANNELS.sessionControlResponse).toBe('sessionControl.response');
    expect(IPC_PUSH_CHANNELS.terminalEvent).toBe('terminal.event');
    expect(IPC_SEND_CHANNELS.terminalInput).toBe('terminal.input');
    expect(isIpcPushChannel('sessionControl.response')).toBe(true);
    expect(isIpcSendChannel('loro.send')).toBe(true);
    expect(isIpcPushChannel('lodySessionControl:response')).toBe(false);
  });
});
