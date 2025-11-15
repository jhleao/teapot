import { ElectronAPI } from '@electron-toolkit/preload'
import type { Repo } from '@teapot/contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getRepo: () => Promise<Repo>
    }
  }
}
