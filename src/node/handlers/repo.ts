/**
 * Repository Handlers - Thin IPC routing layer
 *
 * Transforms IPC requests into operation/service calls.
 * Never contains business logic - delegates to operations layer.
 */

import { dialog, ipcMain, IpcMainEvent } from 'electron'

import {
  IPC_CHANNELS,
  IpcHandlerOf,
  type CheckoutResponse,
  type RebaseOperationResponse,
  type RebaseStatusResponse,
  type ShipItResponse,
  type SyncTrunkResponse
} from '@shared/types'

import { gitForgeService } from '../services/ForgeService'
import { GitWatcher } from '../services/GitWatcherService'

import {
  BranchOperation,
  CommitOperation,
  PullRequestOperation,
  RebaseOperation,
  UiStateOperation,
  WorkingTreeOperation
} from '../operations'

// ============================================================================
// Repository Handlers
// ============================================================================

const watchRepo: IpcHandlerOf<'watchRepo'> = (event, { repoPath }) => {
  GitWatcher.getInstance().watch(repoPath, event.sender)
}

const unwatchRepo: IpcHandlerOf<'unwatchRepo'> = () => {
  GitWatcher.getInstance().stop()
}

const getRepo: IpcHandlerOf<'getRepo'> = async (_event, { repoPath, declutterTrunk = true }) => {
  return UiStateOperation.getUiState(repoPath, { declutterTrunk })
}

const getForgeState: IpcHandlerOf<'getForgeState'> = async (_event, { repoPath }) => {
  return gitForgeService.getStateWithStatus(repoPath)
}

// ============================================================================
// Rebase Intent Handlers (Planning Phase)
// ============================================================================

const submitRebaseIntent: IpcHandlerOf<'submitRebaseIntent'> = async (
  _event,
  { repoPath, headSha, baseSha }
) => {
  return RebaseOperation.submitRebaseIntent(repoPath, headSha, baseSha)
}

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = async (_event, { repoPath }) => {
  return RebaseOperation.confirmRebaseIntent(repoPath)
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = async (_event, { repoPath }) => {
  return RebaseOperation.cancelRebaseIntent(repoPath)
}

// ============================================================================
// Rebase Execution Handlers
// ============================================================================

const continueRebase: IpcHandlerOf<'continueRebase'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  return RebaseOperation.continueRebase(repoPath)
}

const abortRebase: IpcHandlerOf<'abortRebase'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  return RebaseOperation.abortRebase(repoPath)
}

const skipRebaseCommit: IpcHandlerOf<'skipRebaseCommit'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  return RebaseOperation.skipRebaseCommit(repoPath)
}

const getRebaseStatus: IpcHandlerOf<'getRebaseStatus'> = async (
  _event,
  { repoPath }
): Promise<RebaseStatusResponse> => {
  return RebaseOperation.getRebaseStatus(repoPath)
}

// ============================================================================
// Working Tree Handlers
// ============================================================================

const discardStaged: IpcHandlerOf<'discardStaged'> = async (_event, { repoPath }) => {
  await WorkingTreeOperation.discardChanges(repoPath)
  return UiStateOperation.getUiState(repoPath)
}

const amend: IpcHandlerOf<'amend'> = async (_event, { repoPath, message }) => {
  await CommitOperation.amend(repoPath, message)
  return UiStateOperation.getUiState(repoPath)
}

const commit: IpcHandlerOf<'commit'> = async (_event, { repoPath, message, newBranchName }) => {
  await CommitOperation.commitToNewBranch(repoPath, message, newBranchName)
  return UiStateOperation.getUiState(repoPath)
}

const setFilesStageStatus: IpcHandlerOf<'setFilesStageStatus'> = async (
  _event,
  { repoPath, staged, files }
) => {
  await WorkingTreeOperation.updateFileStageStatus(repoPath, files, staged)
  return UiStateOperation.getUiState(repoPath)
}

// ============================================================================
// Branch Handlers
// ============================================================================

const checkoutHandler: IpcHandlerOf<'checkout'> = async (
  _event,
  { repoPath, ref }
): Promise<CheckoutResponse> => {
  const result = await BranchOperation.checkout(repoPath, ref)
  if (!result.success) {
    throw new Error(result.error || 'Checkout failed')
  }

  const uiState = await UiStateOperation.getUiState(repoPath)
  return { uiState }
}

const deleteBranchHandler: IpcHandlerOf<'deleteBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await BranchOperation.delete(repoPath, branchName)
  return UiStateOperation.getUiState(repoPath)
}

const cleanupBranchHandler: IpcHandlerOf<'cleanupBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await BranchOperation.cleanup(repoPath, branchName)
  return UiStateOperation.getUiState(repoPath)
}

const createBranchHandler: IpcHandlerOf<'createBranch'> = async (
  _event,
  { repoPath, branchName, commitSha }
) => {
  await BranchOperation.create(repoPath, commitSha, branchName)
  return UiStateOperation.getUiState(repoPath)
}

const syncTrunk: IpcHandlerOf<'syncTrunk'> = async (
  _event,
  { repoPath }
): Promise<SyncTrunkResponse> => {
  const result = await BranchOperation.syncTrunk(repoPath)
  const uiState = await UiStateOperation.getUiState(repoPath)

  return {
    uiState,
    status: result.status,
    message: result.message
  }
}

// ============================================================================
// Pull Request Handlers
// ============================================================================

const createPullRequest: IpcHandlerOf<'createPullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  try {
    await PullRequestOperation.create(repoPath, headBranch)
    return UiStateOperation.getUiState(repoPath)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await dialog.showMessageBox({
      type: 'error',
      title: 'Failed to Create Pull Request',
      message: 'Unable to create pull request',
      detail: errorMessage,
      buttons: ['OK']
    })

    throw error
  }
}

const updatePullRequest: IpcHandlerOf<'updatePullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  await PullRequestOperation.update(repoPath, headBranch)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const shipIt: IpcHandlerOf<'shipIt'> = async (
  _event,
  { repoPath, branchName }
): Promise<ShipItResponse> => {
  try {
    const result = await PullRequestOperation.shipIt(repoPath, branchName)

    if (!result.success) {
      throw new Error(result.error)
    }

    const uiState = await UiStateOperation.getUiState(repoPath)
    return {
      uiState,
      message: result.message,
      needsRebase: result.needsRebase
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await dialog.showMessageBox({
      type: 'error',
      title: 'Ship It Failed',
      message: 'Unable to merge pull request',
      detail: errorMessage,
      buttons: ['OK']
    })

    throw error
  }
}

// ============================================================================
// History Handlers
// ============================================================================

const uncommit: IpcHandlerOf<'uncommit'> = async (_event, { repoPath, commitSha }) => {
  await CommitOperation.uncommit(repoPath, commitSha)
  return UiStateOperation.getUiState(repoPath)
}

// ============================================================================
// Registration
// ============================================================================

export function registerRepoHandlers(): void {
  // Repository
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.getForgeState, getForgeState)
  ipcMain.handle(IPC_CHANNELS.watchRepo, watchRepo)
  ipcMain.handle(IPC_CHANNELS.unwatchRepo, unwatchRepo)
  ipcMain.handle(IPC_CHANNELS.syncTrunk, syncTrunk)

  // Rebase planning
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, submitRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.confirmRebaseIntent, confirmRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.cancelRebaseIntent, cancelRebaseIntent)

  // Rebase execution
  ipcMain.handle(IPC_CHANNELS.continueRebase, continueRebase)
  ipcMain.handle(IPC_CHANNELS.abortRebase, abortRebase)
  ipcMain.handle(IPC_CHANNELS.skipRebaseCommit, skipRebaseCommit)
  ipcMain.handle(IPC_CHANNELS.getRebaseStatus, getRebaseStatus)

  // Working tree
  ipcMain.handle(IPC_CHANNELS.discardStaged, discardStaged)
  ipcMain.handle(IPC_CHANNELS.amend, amend)
  ipcMain.handle(IPC_CHANNELS.commit, commit)
  ipcMain.handle(IPC_CHANNELS.setFilesStageStatus, setFilesStageStatus)

  // Branches
  ipcMain.handle(IPC_CHANNELS.checkout, checkoutHandler)
  ipcMain.handle(IPC_CHANNELS.deleteBranch, deleteBranchHandler)
  ipcMain.handle(IPC_CHANNELS.cleanupBranch, cleanupBranchHandler)
  ipcMain.handle(IPC_CHANNELS.createBranch, createBranchHandler)

  // GitHub
  ipcMain.handle(IPC_CHANNELS.createPullRequest, createPullRequest)
  ipcMain.handle(IPC_CHANNELS.shipIt, shipIt)

  // History
  ipcMain.handle(IPC_CHANNELS.uncommit, uncommit)
  ipcMain.handle(IPC_CHANNELS.updatePullRequest, updatePullRequest)
}
