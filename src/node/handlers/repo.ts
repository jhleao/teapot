import { ipcMain } from 'electron'
import type { UiState } from '@shared/types'
import { generateMockStack, generateMockWorkingTreeFiles } from '../utils/generate-mock-stack'

function getRepo(): UiState {
  const now = Date.now()
  const baseTime = now - 172800000 // 2 days ago
  const timeStep = 7200000 // 2 hours between commits

  const stack = generateMockStack(baseTime, timeStep)
  const workingTree = generateMockWorkingTreeFiles()

  return {
    stack,
    workingTree
  }
}

export function registerRepoHandlers(): void {
  ipcMain.handle('submitRebaseIntent', getRepo)
}
