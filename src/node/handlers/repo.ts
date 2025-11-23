import {
  IPC_CHANNELS,
  IpcHandlerOf,
  UiState,
  UiWorkingTreeFile,
  type Configuration
} from '@shared/types'
import { ipcMain, IpcMainEvent } from 'electron'
import { buildRepoModel, buildUiStack, commitToNewBranch, updateFileStageStatus } from '../core'
import { GitWatcher } from '../core/git-watcher'
import { buildRebaseIntent } from '../core/utils/build-rebase-intent'
import { buildFullUiState } from '../core/utils/build-ui-state'
import { buildUiWorkingTree } from '../core/utils/build-ui-working-tree'

const watchRepo: IpcHandlerOf<'watchRepo'> = (event, { repoPath }) => {
  GitWatcher.getInstance().watch(repoPath, event.sender)
}

const unwatchRepo: IpcHandlerOf<'unwatchRepo'> = () => {
  GitWatcher.getInstance().stop()
}

const getRepo: IpcHandlerOf<'getRepo'> = async (_event, { repoPath }) => {
  const config: Configuration = { repoPath }
  const repo = await buildRepoModel(config)
  const stack = buildUiStack(repo)
  const workingTree = buildUiWorkingTree(repo)

  if (!stack) return null

  const uiState: UiState = {
    stack,
    workingTree
  }

  return uiState
}

const submitRebaseIntent: IpcHandlerOf<'submitRebaseIntent'> = async (
  _event,
  { repoPath, headSha, baseSha }
) => {
  const workingTree = [] as UiWorkingTreeFile[]

  const config: Configuration = { repoPath }
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

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = (_event, { repoPath }) => {
  // TODO: Implement actual rebase confirmation logic
  return getRepo({} as IpcMainEvent, { repoPath })
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = (_event, { repoPath }) => {
  // TODO: Implement rebase cancellation logic
  return getRepo({} as IpcMainEvent, { repoPath })
}

const discardStaged: IpcHandlerOf<'discardStaged'> = (_event, { repoPath }) => {
  // TODO: Implement discard staged changes logic
  return getRepo({} as IpcMainEvent, { repoPath })
}

const amend: IpcHandlerOf<'amend'> = (_event, { repoPath, message }) => {
  // TODO: Implement amend commit logic
  void message
  return getRepo({} as IpcMainEvent, { repoPath })
}

const commit: IpcHandlerOf<'commit'> = async (_event, { repoPath, message, newBranchName }) => {
  await commitToNewBranch(repoPath, message, newBranchName)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const setFilesStageStatus: IpcHandlerOf<'setFilesStageStatus'> = async (
  _event,
  { repoPath, staged, files }
) => {
  await updateFileStageStatus(repoPath, files, staged)
  return getRepo({} as IpcMainEvent, { repoPath })
}

export function registerRepoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, submitRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.confirmRebaseIntent, confirmRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.cancelRebaseIntent, cancelRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.discardStaged, discardStaged)
  ipcMain.handle(IPC_CHANNELS.amend, amend)
  ipcMain.handle(IPC_CHANNELS.commit, commit)
  ipcMain.handle(IPC_CHANNELS.setFilesStageStatus, setFilesStageStatus)
  ipcMain.handle(IPC_CHANNELS.watchRepo, watchRepo)
  ipcMain.handle(IPC_CHANNELS.unwatchRepo, unwatchRepo)
}
