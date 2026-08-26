import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { UpdaterIpcContract } from '@lody/shared/electron-ipc'
import { getIpcServiceDeps } from '../ipc-service-deps'

export class UpdaterIpc extends IpcService implements UpdaterIpcContract {
  static readonly groupName = 'updater'

  @IpcMethod()
  async getState() {
    return getIpcServiceDeps().appUpdaterService.getState()
  }

  @IpcMethod()
  async checkForUpdates() {
    return await getIpcServiceDeps().appUpdaterService.checkForUpdates()
  }

  @IpcMethod()
  async quitAndInstall() {
    return getIpcServiceDeps().appUpdaterService.quitAndInstall()
  }
}
