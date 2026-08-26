import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_INVOKE_CHANNELS } from '../../../../../packages/shared/src/electron-ipc-contract.ts'

void test('invoke allowlist includes localPlatform.getSnapshot', () => {
  assert.ok(IPC_INVOKE_CHANNELS.includes('localPlatform.getSnapshot'))
})
