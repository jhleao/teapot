import { ElectronAPI } from '@electron-toolkit/preload'
import type { Stack } from '@teapot/contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getRepo: () => Promise<Stack>
    }
  }
}
