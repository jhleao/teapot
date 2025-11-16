import { ElectronAPI } from '@electron-toolkit/preload'
import type { UiStack } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getRepo: () => Promise<UiStack>
    }
  }
}
