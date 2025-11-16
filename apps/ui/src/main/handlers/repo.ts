import { ipcMain } from 'electron'
import type { Stack } from '@teapot/contract'
import { generateMockStack } from '../utils/generate-mock-stack'

function getRepo(): Stack {
  const now = Date.now()
  const baseTime = now - 172800000 // 2 days ago
  const timeStep = 7200000 // 2 hours between commits

  return generateMockStack(baseTime, timeStep)
}

export function registerRepoHandlers(): void {
  ipcMain.handle('getRepo', getRepo)
}
