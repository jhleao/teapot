import { electronAPI } from '@electron-toolkit/preload'
import { log } from '@shared/logger'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcContract,
  type IpcRequest,
  type IpcResponse
} from '@shared/types'
import { contextBridge, ipcRenderer } from 'electron'

function generateApi<T extends typeof IPC_CHANNELS>(channels: T) {
  type ApiType = {
    [K in keyof IpcContract]: (
      ...args: IpcRequest<K> extends void ? [] : [IpcRequest<K>]
    ) => Promise<IpcResponse<K>>
  }

  return Object.fromEntries(
    Object.entries(channels).map(([key, channel]) => [
      key,
      (...args: unknown[]) => {
        const typedChannel = channel as keyof IpcContract
        // void vs non-void request types
        if (args.length === 0) return ipcRenderer.invoke(typedChannel)
        return ipcRenderer.invoke(typedChannel, args[0])
      }
    ])
  ) as ApiType
}

const generatedApi = generateApi(IPC_CHANNELS)

export const api = {
  ...generatedApi,
  onRepoChange: (callback: () => void) => {
    const subscription = (_event: any): void => callback()
    ipcRenderer.on(IPC_EVENTS.repoChange, subscription)
    return (): void => {
      ipcRenderer.removeListener(IPC_EVENTS.repoChange, subscription)
    }
  },
  onRepoError: (callback: (error: string) => void) => {
    const subscription = (_event: any, error: string): void => callback(error)
    ipcRenderer.on(IPC_EVENTS.repoError, subscription)
    return (): void => {
      ipcRenderer.removeListener(IPC_EVENTS.repoError, subscription)
    }
  },
  onRebaseWarning: (callback: (message: string) => void) => {
    const subscription = (_event: any, message: string): void => callback(message)
    ipcRenderer.on(IPC_EVENTS.rebaseWarning, subscription)
    return (): void => {
      ipcRenderer.removeListener(IPC_EVENTS.rebaseWarning, subscription)
    }
  },
  onUpdateDownloading: (callback: (version: string) => void) => {
    const subscription = (_event: any, version: string): void => callback(version)
    ipcRenderer.on(IPC_EVENTS.updateDownloading, subscription)
    return (): void => {
      ipcRenderer.removeListener(IPC_EVENTS.updateDownloading, subscription)
    }
  },
  onUpdateDownloaded: (callback: (version: string) => void) => {
    const subscription = (_event: any, version: string): void => callback(version)
    ipcRenderer.on(IPC_EVENTS.updateDownloaded, subscription)
    return (): void => {
      ipcRenderer.removeListener(IPC_EVENTS.updateDownloaded, subscription)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    log.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
