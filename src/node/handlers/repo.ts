import { IPC_CHANNELS, IpcHandlerOf, UiState, UiWorkingTreeFile } from '@shared/types'
import { ipcMain } from 'electron'
import { buildRepoModel, buildUiState, loadConfiguration } from '../core'
import { buildFullUiState } from '../core/utils/build-ui-state'
import { buildRebaseIntent } from '../core/utils/build-rebase-intent'

const getRepo = async () => {
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

const submitRebaseIntent = async ({ headSha, baseSha }) => {
  const workingTree = [] as UiWorkingTreeFile[]

  const config = loadConfiguration()
  const repo = await buildRepoModel(config)

  const rebaseIntent = buildRebaseIntent(repo, headSha, baseSha)
  if (!rebaseIntent) {
    return null
  }

  const fullUiState = buildFullUiState(repo, { rebaseIntent })
  const stack = fullUiState.projectedStack ?? fullUiState.stack
  if (!stack) {
    return null
  }

  const uiState: UiState = {
    stack,
    workingTree
  }

  return uiState
}

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = () => {
  // TODO: Implement actual rebase confirmation logic
  return getRepo()
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = () => {
  // TODO: Implement rebase cancellation logic
  return getRepo()
}

const discardStaged: IpcHandlerOf<'discardStaged'> = () => {
  // TODO: Implement discard staged changes logic
  return getRepo()
}

const amend: IpcHandlerOf<'amend'> = (_event, { message }) => {
  // TODO: Implement amend commit logic
  void message
  return getRepo()
}

const commit: IpcHandlerOf<'commit'> = (_event, { message }) => {
  // TODO: Implement commit logic
  void message
  return getRepo()
}

const setFilesStageStatus: IpcHandlerOf<'setFilesStageStatus'> = (_event, { staged, files }) => {
  // TODO: Implement set files stage status logic
  void staged
  void files
  return getRepo()
}

export function registerRepoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, (_event, request) => submitRebaseIntent(request))
  ipcMain.handle(IPC_CHANNELS.confirmRebaseIntent, confirmRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.cancelRebaseIntent, cancelRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.discardStaged, discardStaged)
  ipcMain.handle(IPC_CHANNELS.amend, amend)
  ipcMain.handle(IPC_CHANNELS.commit, commit)
  ipcMain.handle(IPC_CHANNELS.setFilesStageStatus, setFilesStageStatus)
}