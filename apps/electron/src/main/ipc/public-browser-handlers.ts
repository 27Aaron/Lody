import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  ElectronPublicBrowserBoundsInputSchema,
  ElectronPublicBrowserCreateInputSchema,
  ElectronPublicBrowserIdInputSchema,
  ElectronPublicBrowserNavigateInputSchema,
  ElectronPublicBrowserVisibilityInputSchema
} from '@lody/shared/electron-ipc'
import type { PublicBrowserService } from '../services/public-browser-service'

type RegisterPublicBrowserHandlersOptions = {
  service: PublicBrowserService
  getMainWindow: () => BrowserWindow | null
}

const assertTrustedSender = (
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null
): void => {
  const window = getMainWindow()
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Rejected public browser IPC from an untrusted renderer.')
  }
}

export function registerPublicBrowserHandlers(options: RegisterPublicBrowserHandlersOptions): void {
  ipcMain.handle('lodyPublicBrowser:create', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserCreateInputSchema.parse(raw)
    return options.service.create(input.browserId, input.bounds)
  })
  ipcMain.handle('lodyPublicBrowser:navigate', async (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserNavigateInputSchema.parse(raw)
    return await options.service.navigate(input.browserId, input.url)
  })
  ipcMain.handle('lodyPublicBrowser:back', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return options.service.goBack(input.browserId)
  })
  ipcMain.handle('lodyPublicBrowser:forward', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return options.service.goForward(input.browserId)
  })
  ipcMain.handle('lodyPublicBrowser:reload', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return options.service.reload(input.browserId)
  })
  ipcMain.handle('lodyPublicBrowser:stop', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return options.service.stop(input.browserId)
  })
  ipcMain.handle('lodyPublicBrowser:setBounds', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserBoundsInputSchema.parse(raw)
    return options.service.setBounds(input.browserId, input.bounds)
  })
  ipcMain.handle('lodyPublicBrowser:setVisible', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserVisibilityInputSchema.parse(raw)
    return options.service.setVisible(input.browserId, input.visible)
  })
  ipcMain.handle('lodyPublicBrowser:destroy', (event, raw: unknown) => {
    assertTrustedSender(event, options.getMainWindow)
    const input = ElectronPublicBrowserIdInputSchema.parse(raw)
    return options.service.destroy(input.browserId)
  })
}
