import { ipcMain } from 'electron'
import { IPC_CHANNELS, IpcHandlerOf } from '@shared/types'
import { generateMockStack, generateMockWorkingTreeFiles } from '../utils/generate-mock-stack'

const getRepo: IpcHandlerOf<'getRepo'> = () => {
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
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, getRepo)
}
