import { ElectronAPI } from '@electron-toolkit/preload'
import type { UiStack } from '@teapot/contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getRepo: () => Promise<UiStack>
    }
  }
}
