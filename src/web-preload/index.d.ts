import { ElectronAPI } from '@electron-toolkit/preload'
import type { UiState } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getRepo: () => UiState
      submitRebaseIntent: (args: { headSha: string; baseSha: string }) => UiState
    }
  }
}
