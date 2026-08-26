import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { LoroIpcContract } from '@lody/shared/electron-ipc'
import { getIpcServiceDeps } from '../ipc-service-deps'

export class LoroIpc extends IpcService implements LoroIpcContract {
  static readonly groupName = 'loro'

  @IpcMethod()
  async isConnected() {
    return getIpcServiceDeps().loroDataPlaneRelay.isConnected()
  }
}
