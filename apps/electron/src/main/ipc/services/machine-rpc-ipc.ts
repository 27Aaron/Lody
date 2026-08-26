import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { LocalMachineRpcRequest } from '@lody/shared/local-machine-rpc'
import type { MachineRpcIpcContract } from '@lody/shared/electron-ipc'
import { getIpcServiceDeps } from '../ipc-service-deps'

export class MachineRpcIpc extends IpcService implements MachineRpcIpcContract {
  static readonly groupName = 'machineRpc'

  @IpcMethod()
  async send(message: LocalMachineRpcRequest) {
    return await getIpcServiceDeps().cliService.sendLocalMachineRpc(message)
  }
}
