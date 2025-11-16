import { ipcMain } from 'electron'
import type { UiStack } from '@shared/types'
import { generateMockStack } from '../utils/generate-mock-stack'

function getRepo(): UiStack {
  const now = Date.now()
  const baseTime = now - 172800000 // 2 days ago
  const timeStep = 7200000 // 2 hours between commits

  return generateMockStack(baseTime, timeStep)
}

export function registerRepoHandlers(): void {
  ipcMain.handle('getRepo', getRepo)
}
