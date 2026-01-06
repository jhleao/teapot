/**
 * Repository Handlers - Thin IPC routing layer
 *
 * Transforms IPC requests into operation/service calls.
 * Never contains business logic - delegates to operations layer.
 */

import { dialog, ipcMain, IpcMainEvent } from 'electron'

import { log } from '@shared/logger'
import {
  IPC_CHANNELS,
  IpcHandlerOf,
  type CheckoutResponse,
  type DetachedWorktree,
  type RebaseOperationResponse,
  type RebaseStatusResponse,
  type ShipItResponse,
  type SyncTrunkResponse
} from '@shared/types'

import * as fs from 'fs'
import { getGitAdapter } from '../adapters/git'
import { gitForgeService } from '../services/ForgeService'
import { GitWatcher } from '../services/GitWatcherService'
import { configStore } from '../store'

import {
  BranchOperation,
  CommitOperation,
  PullRequestOperation,
  RebaseOperation,
  SquashOperation,
  UiStateOperation,
  WorkingTreeOperation,
  WorktreeOperation
} from '../operations'

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolves the effective working path for git operations.
 * Returns the active worktree path if one is set, otherwise the main repo path.
 *
 * Use this for operations that work on the working tree (checkout, commit, stage, etc.)
 * Use repoPath directly for repo-level operations (listing worktrees, getting UI state, etc.)
 */
function resolveWorkingPath(repoPath: string): string {
  return configStore.getActiveWorktree(repoPath) ?? repoPath
}

// ============================================================================
// Repository Handlers
// ============================================================================

const watchRepo: IpcHandlerOf<'watchRepo'> = (event, { repoPath }) => {
  GitWatcher.getInstance().watch(resolveWorkingPath(repoPath), event.sender)
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
  const workingPath = resolveWorkingPath(repoPath)
  log.debug('[handler.submitRebaseIntent] Path resolution', {
    originalRepoPath: repoPath,
    resolvedWorkingPath: workingPath,
    arePathsSame: repoPath === workingPath
  })
  return RebaseOperation.submitRebaseIntent(workingPath, headSha, baseSha)
}

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = async (_event, { repoPath }) => {
  const workingPath = resolveWorkingPath(repoPath)
  log.debug('[handler.confirmRebaseIntent] Path resolution', {
    originalRepoPath: repoPath,
    resolvedWorkingPath: workingPath,
    arePathsSame: repoPath === workingPath
  })
  return RebaseOperation.confirmRebaseIntent(workingPath)
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = async (_event, { repoPath }) => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.cancelRebaseIntent(workingPath)
}

const resolveWorktreeConflictAndRebase: IpcHandlerOf<'resolveWorktreeConflictAndRebase'> = async (
  _event,
  { repoPath, headSha, baseSha, resolutions }
) => {
  const workingPath = resolveWorkingPath(repoPath)
  const git = getGitAdapter()
  const detachedWorktrees: DetachedWorktree[] = []

  const existingWorktrees = await git.listWorktrees(repoPath)
  const worktreeByPath = new Map(existingWorktrees.map((wt) => [wt.path, wt]))

  // Dedupe resolutions by worktree path to avoid repeated operations
  const resolutionsByPath = new Map<string, (typeof resolutions)[number]>()
  for (const resolution of resolutions) {
    resolutionsByPath.set(resolution.worktreePath, resolution)
  }

  for (const resolution of resolutionsByPath.values()) {
    if (!fs.existsSync(resolution.worktreePath)) {
      log.warn(
        `[handler.resolveWorktreeConflictAndRebase] Skipping missing worktree ${resolution.worktreePath}`
      )
      continue
    }

    const worktree = worktreeByPath.get(resolution.worktreePath)
    if (!worktree || !worktree.branch) {
      log.warn(
        `[handler.resolveWorktreeConflictAndRebase] Skipping unresolved worktree ${resolution.worktreePath} (not listed or no branch)`
      )
      continue
    }
    const branch = worktree.branch

    if (resolution.action === 'stash') {
      const stashResult = await WorktreeOperation.stash(resolution.worktreePath)
      if (!stashResult.success) {
        throw new Error(stashResult.error ?? 'Failed to stash worktree changes')
      }

      const detachResult = await WorktreeOperation.detachHead(resolution.worktreePath)
      if (!detachResult.success) {
        throw new Error(detachResult.error ?? 'Failed to detach worktree')
      }

      if (branch) {
        detachedWorktrees.push({ worktreePath: resolution.worktreePath, branch })
      }
    } else {
      const removeResult = await WorktreeOperation.remove(repoPath, resolution.worktreePath, true)
      if (!removeResult.success) {
        throw new Error(removeResult.error ?? 'Failed to delete worktree')
      }
    }
  }

  return RebaseOperation.submitRebaseIntent(workingPath, headSha, baseSha, {
    preDetachedWorktrees: detachedWorktrees
  })
}

// ============================================================================
// Rebase Execution Handlers
// ============================================================================

const continueRebase: IpcHandlerOf<'continueRebase'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.continueRebase(workingPath)
}

const abortRebase: IpcHandlerOf<'abortRebase'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.abortRebase(workingPath)
}

const skipRebaseCommit: IpcHandlerOf<'skipRebaseCommit'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.skipRebaseCommit(workingPath)
}

const getRebaseStatus: IpcHandlerOf<'getRebaseStatus'> = async (
  _event,
  { repoPath }
): Promise<RebaseStatusResponse> => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.getRebaseStatus(workingPath)
}

const resumeRebaseQueue: IpcHandlerOf<'resumeRebaseQueue'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.resumeRebaseQueue(workingPath)
}

const dismissRebaseQueue: IpcHandlerOf<'dismissRebaseQueue'> = async (_event, { repoPath }) => {
  const workingPath = resolveWorkingPath(repoPath)
  return RebaseOperation.dismissRebaseQueue(workingPath)
}

// ============================================================================
// Working Tree Handlers
// ============================================================================

const discardStaged: IpcHandlerOf<'discardStaged'> = async (_event, { repoPath }) => {
  const workingPath = resolveWorkingPath(repoPath)
  await WorkingTreeOperation.discardChanges(workingPath)
  return UiStateOperation.getUiState(repoPath)
}

const amend: IpcHandlerOf<'amend'> = async (_event, { repoPath, message }) => {
  const workingPath = resolveWorkingPath(repoPath)
  await CommitOperation.amend(workingPath, message)
  return UiStateOperation.getUiState(repoPath)
}

const commit: IpcHandlerOf<'commit'> = async (_event, { repoPath, message, newBranchName }) => {
  const workingPath = resolveWorkingPath(repoPath)
  await CommitOperation.commitToNewBranch(workingPath, message, newBranchName)
  return UiStateOperation.getUiState(repoPath)
}

const setFilesStageStatus: IpcHandlerOf<'setFilesStageStatus'> = async (
  _event,
  { repoPath, staged, files }
) => {
  const workingPath = resolveWorkingPath(repoPath)
  await WorkingTreeOperation.updateFileStageStatus(workingPath, files, staged)
  return UiStateOperation.getUiState(repoPath)
}

// ============================================================================
// Branch Handlers
// ============================================================================

const checkoutHandler: IpcHandlerOf<'checkout'> = async (
  _event,
  { repoPath, ref }
): Promise<CheckoutResponse> => {
  const result = await BranchOperation.checkout(resolveWorkingPath(repoPath), ref)
  if (!result.success) {
    // Parse worktree conflict error for a friendlier message
    const worktreeMatch = result.error?.match(/already used by worktree at '([^']+)'/)
    if (worktreeMatch) {
      const worktreePath = worktreeMatch[1]
      throw new Error(`Cannot checkout '${ref}' - already checked out in ${worktreePath}`)
    }
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

// ============================================================================
// Fold / Squash Handlers
// ============================================================================

const getFoldPreview: IpcHandlerOf<'getFoldPreview'> = async (_event, { repoPath, branchName }) => {
  const workingPath = resolveWorkingPath(repoPath)
  return SquashOperation.preview(workingPath, branchName)
}

const foldIntoParent: IpcHandlerOf<'foldIntoParent'> = async (
  _event,
  { repoPath, branchName, commitMessage }
) => {
  const workingPath = resolveWorkingPath(repoPath)
  return SquashOperation.execute(workingPath, branchName, { commitMessage })
}

const createBranchHandler: IpcHandlerOf<'createBranch'> = async (
  _event,
  { repoPath, branchName, commitSha }
) => {
  await BranchOperation.create(repoPath, commitSha, branchName)
  return UiStateOperation.getUiState(repoPath)
}

const renameBranchHandler: IpcHandlerOf<'renameBranch'> = async (
  _event,
  { repoPath, oldBranchName, newBranchName }
) => {
  await BranchOperation.rename(repoPath, oldBranchName, newBranchName)
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
    const mergeStrategy = configStore.getMergeStrategy()
    const result = await PullRequestOperation.shipIt(repoPath, branchName, mergeStrategy)

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
  const workingPath = resolveWorkingPath(repoPath)
  await CommitOperation.uncommit(workingPath, commitSha)
  return UiStateOperation.getUiState(repoPath)
}

// ============================================================================
// Worktree Handlers
// ============================================================================

const getActiveWorktree: IpcHandlerOf<'getActiveWorktree'> = (_event, { repoPath }) => {
  return configStore.getActiveWorktree(repoPath)
}

const switchWorktree: IpcHandlerOf<'switchWorktree'> = async (
  event,
  { repoPath, worktreePath }
) => {
  configStore.setActiveWorktree(repoPath, worktreePath)
  // Re-initialize watcher for the new worktree directory
  GitWatcher.getInstance().watch(worktreePath, event.sender)
  return UiStateOperation.getUiState(repoPath)
}

const removeWorktree: IpcHandlerOf<'removeWorktree'> = async (
  _event,
  { repoPath, worktreePath, force }
) => {
  const result = await WorktreeOperation.remove(repoPath, worktreePath, force)
  if (result.success) {
    const uiState = await UiStateOperation.getUiState(repoPath)
    return { ...result, uiState }
  }
  return result
}

const discardWorktreeChanges: IpcHandlerOf<'discardWorktreeChanges'> = async (
  _event,
  { worktreePath }
) => {
  return WorktreeOperation.discardAllChanges(worktreePath)
}

const checkoutWorktreeBranch: IpcHandlerOf<'checkoutWorktreeBranch'> = async (
  _event,
  { worktreePath, branch }
) => {
  return WorktreeOperation.checkoutBranch(worktreePath, branch)
}

const openWorktreeInEditor: IpcHandlerOf<'openWorktreeInEditor'> = async (
  _event,
  { worktreePath }
) => {
  return WorktreeOperation.openInEditor(worktreePath)
}

const openWorktreeInTerminal: IpcHandlerOf<'openWorktreeInTerminal'> = async (
  _event,
  { worktreePath }
) => {
  return WorktreeOperation.openInTerminal(worktreePath)
}

const copyWorktreePath: IpcHandlerOf<'copyWorktreePath'> = async (_event, { worktreePath }) => {
  return WorktreeOperation.copyPath(worktreePath)
}

const createWorktree: IpcHandlerOf<'createWorktree'> = async (_event, { repoPath, branch }) => {
  const result = await WorktreeOperation.create(repoPath, branch)
  if (result.success) {
    const uiState = await UiStateOperation.getUiState(repoPath)
    return { ...result, uiState }
  }
  return result
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
  ipcMain.handle(IPC_CHANNELS.resolveWorktreeConflictAndRebase, resolveWorktreeConflictAndRebase)

  // Rebase execution
  ipcMain.handle(IPC_CHANNELS.continueRebase, continueRebase)
  ipcMain.handle(IPC_CHANNELS.abortRebase, abortRebase)
  ipcMain.handle(IPC_CHANNELS.skipRebaseCommit, skipRebaseCommit)
  ipcMain.handle(IPC_CHANNELS.getRebaseStatus, getRebaseStatus)
  ipcMain.handle(IPC_CHANNELS.resumeRebaseQueue, resumeRebaseQueue)
  ipcMain.handle(IPC_CHANNELS.dismissRebaseQueue, dismissRebaseQueue)

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
  ipcMain.handle(IPC_CHANNELS.renameBranch, renameBranchHandler)

  // GitHub
  ipcMain.handle(IPC_CHANNELS.createPullRequest, createPullRequest)
  ipcMain.handle(IPC_CHANNELS.shipIt, shipIt)

  // History
  ipcMain.handle(IPC_CHANNELS.uncommit, uncommit)
  ipcMain.handle(IPC_CHANNELS.updatePullRequest, updatePullRequest)
  ipcMain.handle(IPC_CHANNELS.getFoldPreview, getFoldPreview)
  ipcMain.handle(IPC_CHANNELS.foldIntoParent, foldIntoParent)

  // Worktree
  ipcMain.handle(IPC_CHANNELS.getActiveWorktree, getActiveWorktree)
  ipcMain.handle(IPC_CHANNELS.switchWorktree, switchWorktree)
  ipcMain.handle(IPC_CHANNELS.removeWorktree, removeWorktree)
  ipcMain.handle(IPC_CHANNELS.discardWorktreeChanges, discardWorktreeChanges)
  ipcMain.handle(IPC_CHANNELS.checkoutWorktreeBranch, checkoutWorktreeBranch)
  ipcMain.handle(IPC_CHANNELS.openWorktreeInEditor, openWorktreeInEditor)
  ipcMain.handle(IPC_CHANNELS.openWorktreeInTerminal, openWorktreeInTerminal)
  ipcMain.handle(IPC_CHANNELS.copyWorktreePath, copyWorktreePath)
  ipcMain.handle(IPC_CHANNELS.createWorktree, createWorktree)
}
