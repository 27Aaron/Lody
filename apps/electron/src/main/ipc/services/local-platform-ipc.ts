import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { LocalPlatformIpcContract } from '@lody/shared/electron-ipc'
import { isLocalPlatform, readLocalPlatformSnapshot } from '../../platform'

export class LocalPlatformIpc extends IpcService implements LocalPlatformIpcContract {
  static readonly groupName = 'localPlatform'

  @IpcMethod()
  async getSnapshot() {
    if (!isLocalPlatform()) return null
    return await readLocalPlatformSnapshot()
  }
}
