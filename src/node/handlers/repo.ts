import { ipcMain } from 'electron'
import { IPC_CHANNELS, UiState, UiWorkingTreeFile, type IpcHandlerOf } from '@shared/types'
import { buildRepoModel, buildUiState, loadConfiguration } from '../core'
import { buildFullUiState } from '../core/utils/build-ui-state'

const getRepo: IpcHandlerOf<'getRepo'> = async () => {
  const workingTree = [] as UiWorkingTreeFile[]

  const config = loadConfiguration()
  const repo = await buildRepoModel(config)
  const stack = buildUiState(repo)

  if (!stack) return null

  const uiState: UiState = {
    stack,
    workingTree
  }

  return uiState
}

const submitRebaseIntent: IpcHandlerOf<'submitRebaseIntent'> = async (args) => {
  const workingTree = [] as UiWorkingTreeFile[]

  const { repo, config = loadConfiguration(), generateJobId } = options;
  
  const repoModel = repo ?? (await buildRepoModel(config));

  const fullUiState = buildFullUiState(repoModel, {
    rebaseIntent: headSha,
    generateJobId
  })
  
  const uiState: UiState = {
    fullUiState.projectedStack,
    workingTree
  }

  return uiState
}

export function registerRepoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, submitRebaseIntent)
}

/*

import { ipcMain } from 'electron'
import { IPC_CHANNELS, UiWorkingTreeFile, type IpcHandlerOf, type UiStack } from '@shared/types'
import { buildRepoModel, buildUiState, loadConfiguration } from '../core'

const getRepo: IpcHandlerOf<'getRepo'> = async () => buildUiStateResponse()

const submitRebaseIntent: IpcHandlerOf<'submitRebaseIntent'> = async (_intent) =>
  buildUiStateResponse()

export function registerRepoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, submitRebaseIntent)
}

async function buildUiStateResponse(): Promise<{
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
}> {
  const config = loadConfiguration()
  const repo = await buildRepoModel(config)
  const stack = buildUiState(repo) ?? createEmptyStack()

  // TODO: wire up a real working-tree projection once available
  const workingTree: UiWorkingTreeFile[] = []

  return { stack, workingTree }
}

function createEmptyStack(): UiStack {
  return {
    commits: [],
    isTrunk: true
  }
}

*/
