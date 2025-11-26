import {
  IPC_CHANNELS,
  IpcHandlerOf,
  UiState,
  UiWorkingTreeFile,
  type Configuration
} from '@shared/types'
import { ipcMain, IpcMainEvent } from 'electron'
import {
  amend as amendCommit,
  buildRepoModel,
  buildUiStack,
  checkout,
  commitToNewBranch,
  createPullRequest as createPullRequestCore,
  deleteBranch,
  discardChanges,
  uncommit as uncommitCore,
  updateFileStageStatus
} from '../core'
import { gitForgeService } from '../core/forge/service'
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
  const [repo, forgeState] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath)
  ])
  const stack = buildUiStack(repo, forgeState)
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
  const [repo, forgeState] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath)
  ])

  const rebaseIntent = buildRebaseIntent(repo, headSha, baseSha)
  if (!rebaseIntent) {
    return null
  }

  const fullUiState = buildFullUiState(repo, { rebaseIntent, gitForgeState: forgeState })
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

const discardStaged: IpcHandlerOf<'discardStaged'> = async (_event, { repoPath }) => {
  await discardChanges(repoPath)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const amend: IpcHandlerOf<'amend'> = async (_event, { repoPath, message }) => {
  await amendCommit(repoPath, message)
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

const checkoutHandler: IpcHandlerOf<'checkout'> = async (_event, { repoPath, ref }) => {
  await checkout(repoPath, ref)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const deleteBranchHandler: IpcHandlerOf<'deleteBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await deleteBranch(repoPath, branchName)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const createPullRequest: IpcHandlerOf<'createPullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  await createPullRequestCore(repoPath, headBranch)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const uncommit: IpcHandlerOf<'uncommit'> = async (_event, { repoPath, commitSha }) => {
  await uncommitCore(repoPath, commitSha)
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
  ipcMain.handle(IPC_CHANNELS.checkout, checkoutHandler)
  ipcMain.handle(IPC_CHANNELS.deleteBranch, deleteBranchHandler)
  ipcMain.handle(IPC_CHANNELS.watchRepo, watchRepo)
  ipcMain.handle(IPC_CHANNELS.unwatchRepo, unwatchRepo)
  ipcMain.handle(IPC_CHANNELS.createPullRequest, createPullRequest)
  ipcMain.handle(IPC_CHANNELS.uncommit, uncommit)
}
