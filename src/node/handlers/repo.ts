import {
  IPC_CHANNELS,
  IpcHandlerOf,
  UiState,
  UiWorkingTreeFile,
  createRebasePlan,
  type Configuration,
  type RebaseOperationResponse,
  type RebaseStatusResponse
} from '@shared/types'
import { dialog, ipcMain } from 'electron'
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
import { rebaseSessionStore } from '../core/rebase-session-store'
import {
  executeRebasePlan,
  continueRebase as continueRebaseExec,
  abortRebase as abortRebaseExec,
  skipRebaseCommit as skipRebaseCommitExec
} from '../core/rebase-executor'
import { getGitAdapter, supportsGetRebaseState } from '../core/git-adapter'

// ============================================================================
// Helper to get fresh UI state
// ============================================================================

async function getUiState(repoPath: string, declutterTrunk = false): Promise<UiState | null> {
  const config: Configuration = { repoPath }
  const [repo, forgeState] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath)
  ])
  const stack = buildUiStack(repo, forgeState, { declutterTrunk })
  const workingTree = buildUiWorkingTree(repo)

  if (!stack) return null

  return { stack, workingTree }
}

// ============================================================================
// Repository Handlers
// ============================================================================

const watchRepo: IpcHandlerOf<'watchRepo'> = (event, { repoPath }) => {
  GitWatcher.getInstance().watch(repoPath, event.sender)
}

const unwatchRepo: IpcHandlerOf<'unwatchRepo'> = () => {
  GitWatcher.getInstance().stop()
}

const getRepo: IpcHandlerOf<'getRepo'> = async (_event, { repoPath, declutterTrunk = false }) => {
  return getUiState(repoPath, declutterTrunk)
}

// ============================================================================
// Rebase Intent Handlers (Planning Phase)
// ============================================================================

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

  // Store the intent in session for later confirmation
  const plan = createRebasePlan({
    repo,
    intent: rebaseIntent,
    generateJobId: createJobIdGenerator()
  })

  // We don't create a full session yet - just store the intent temporarily
  // The session will be created when the user confirms
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

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = async (_event, { repoPath }) => {
  // Get current repo state and rebuild the intent
  const config: Configuration = { repoPath }
  const repo = await buildRepoModel(config)

  // Check if we have a pending intent in the UI (passed via the original submitRebaseIntent)
  // For now, we need to get this from somewhere - the frontend should pass the intent details
  // This is a limitation of the current design that we need to address

  // TEMPORARY: Try to get any existing session
  const existingSession = await rebaseSessionStore.getSession(repoPath)
  if (existingSession) {
    // Execute the existing plan
    const result = await executeRebasePlan(
      repoPath,
      { intent: existingSession.intent, state: existingSession.state },
      getGitAdapter()
    )

    if (result.status === 'error') {
      throw new Error(result.message)
    }

    return getUiState(repoPath)
  }

  // No session - just return current state
  return getUiState(repoPath)
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = async (_event, { repoPath }) => {
  // Clear any pending session
  await rebaseSessionStore.clearSession(repoPath)
  return getUiState(repoPath)
}

// ============================================================================
// Rebase Execution Handlers
// ============================================================================

const continueRebase: IpcHandlerOf<'continueRebase'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  try {
    const result = await continueRebaseExec(repoPath, getGitAdapter())

    const uiState = await getUiState(repoPath)

    if (result.status === 'error') {
      return {
        success: false,
        error: result.message,
        uiState
      }
    }

    if (result.status === 'conflict') {
      return {
        success: false,
        uiState,
        conflicts: result.conflicts
      }
    }

    return {
      success: true,
      uiState
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      uiState: await getUiState(repoPath)
    }
  }
}

const abortRebase: IpcHandlerOf<'abortRebase'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  try {
    const result = await abortRebaseExec(repoPath, getGitAdapter())

    const uiState = await getUiState(repoPath)

    if (!result.success) {
      return {
        success: false,
        error: result.message,
        uiState
      }
    }

    return {
      success: true,
      uiState
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      uiState: await getUiState(repoPath)
    }
  }
}

const skipRebaseCommit: IpcHandlerOf<'skipRebaseCommit'> = async (
  _event,
  { repoPath }
): Promise<RebaseOperationResponse> => {
  try {
    const result = await skipRebaseCommitExec(repoPath, getGitAdapter())

    const uiState = await getUiState(repoPath)

    if (result.status === 'error') {
      return {
        success: false,
        error: result.message,
        uiState
      }
    }

    if (result.status === 'conflict') {
      return {
        success: false,
        uiState,
        conflicts: result.conflicts
      }
    }

    return {
      success: true,
      uiState
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      uiState: await getUiState(repoPath)
    }
  }
}

const getRebaseStatus: IpcHandlerOf<'getRebaseStatus'> = async (
  _event,
  { repoPath }
): Promise<RebaseStatusResponse> => {
  try {
    const adapter = getGitAdapter()
    const [session, workingTreeStatus] = await Promise.all([
      rebaseSessionStore.getSession(repoPath),
      adapter.getWorkingTreeStatus(repoPath)
    ])

    let progress: RebaseStatusResponse['progress'] = undefined

    // Try to get Git's rebase state for progress info
    if (supportsGetRebaseState(adapter) && workingTreeStatus.isRebasing) {
      const gitRebaseState = await adapter.getRebaseState(repoPath)
      if (gitRebaseState) {
        progress = {
          currentStep: gitRebaseState.currentStep,
          totalSteps: gitRebaseState.totalSteps,
          branch: gitRebaseState.branch
        }
      }
    }

    return {
      isRebasing: workingTreeStatus.isRebasing,
      hasSession: session !== null,
      state: session?.state,
      conflicts: workingTreeStatus.conflicted,
      progress
    }
  } catch (error) {
    return {
      isRebasing: false,
      hasSession: false,
      conflicts: []
    }
  }
}

// ============================================================================
// Other Handlers
// ============================================================================

const discardStaged: IpcHandlerOf<'discardStaged'> = async (_event, { repoPath }) => {
  await discardChanges(repoPath)
  return getUiState(repoPath)
}

const amend: IpcHandlerOf<'amend'> = async (_event, { repoPath, message }) => {
  await amendCommit(repoPath, message)
  return getUiState(repoPath)
}

const commit: IpcHandlerOf<'commit'> = async (_event, { repoPath, message, newBranchName }) => {
  await commitToNewBranch(repoPath, message, newBranchName)
  return getUiState(repoPath)
}

const setFilesStageStatus: IpcHandlerOf<'setFilesStageStatus'> = async (
  _event,
  { repoPath, staged, files }
) => {
  await updateFileStageStatus(repoPath, files, staged)
  return getUiState(repoPath)
}

const checkoutHandler: IpcHandlerOf<'checkout'> = async (_event, { repoPath, ref }) => {
  await checkout(repoPath, ref)
  return getUiState(repoPath)
}

const deleteBranchHandler: IpcHandlerOf<'deleteBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await deleteBranch(repoPath, branchName)
  return getUiState(repoPath)
}

const createPullRequest: IpcHandlerOf<'createPullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  try {
    await createPullRequestCore(repoPath, headBranch)
    return getUiState(repoPath)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Show user-friendly error dialog
    await dialog.showMessageBox({
      type: 'error',
      title: 'Failed to Create Pull Request',
      message: 'Unable to create pull request',
      detail: errorMessage,
      buttons: ['OK']
    })

    // Re-throw so the frontend can also handle it if needed
    throw error
  }
}

const uncommit: IpcHandlerOf<'uncommit'> = async (_event, { repoPath, commitSha }) => {
  await uncommitCore(repoPath, commitSha)
  return getUiState(repoPath)
}

// ============================================================================
// Utilities
// ============================================================================

function createJobIdGenerator(): () => string {
  let counter = 0
  return () => {
    counter++
    return `job-${Date.now()}-${counter}`
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerRepoHandlers(): void {
  // Repository
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.watchRepo, watchRepo)
  ipcMain.handle(IPC_CHANNELS.unwatchRepo, unwatchRepo)

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

  // GitHub
  ipcMain.handle(IPC_CHANNELS.createPullRequest, createPullRequest)

  // History
  ipcMain.handle(IPC_CHANNELS.uncommit, uncommit)
}
