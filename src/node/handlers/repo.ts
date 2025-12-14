import {
  createRebasePlan,
  IPC_CHANNELS,
  IpcHandlerOf,
  UiStack,
  UiState,
  UiWorkingTreeFile,
  type CheckoutResponse,
  type Configuration,
  type RebaseOperationResponse,
  type RebaseStatusResponse,
  type ShipItResponse
} from '@shared/types'
import { dialog, ipcMain, IpcMainEvent } from 'electron'
import {
  amend as amendCommit,
  buildRepoModel,
  buildUiStack,
  commitToNewBranch,
  createPullRequest as createPullRequestCore,
  deleteBranch,
  discardChanges,
  uncommit as uncommitCore,
  updateFileStageStatus,
  updatePullRequest as updatePullRequestCore
} from '../core'
import { parseRemoteBranch } from '../core/utils/branch-utils'
import { smartCheckout } from '../core/utils/smart-checkout'
import { cleanupBranch } from '../core/utils/cleanup-branch'
import { gitForgeService } from '../core/forge/service'
import { getGitAdapter, supportsGetRebaseState, supportsMerge } from '../core/git-adapter'
import { GitWatcher } from '../core/git-watcher'
import {
  abortRebase as abortRebaseExec,
  continueRebase as continueRebaseExec,
  executeRebasePlan,
  skipRebaseCommit as skipRebaseCommitExec
} from '../core/rebase-executor'
import { createStoredSession, rebaseSessionStore } from '../core/rebase-session-store'
import { buildRebaseIntent } from '../core/utils/build-rebase-intent'
import { buildFullUiState } from '../core/utils/build-ui-state'
import { buildUiWorkingTree } from '../core/utils/build-ui-working-tree'
import { detectMergedBranches } from '../core/utils/detect-merged-branches'
import { getTrunkHeadSha } from '../core/utils/get-trunk-head-sha'
import { createJobIdGenerator } from '../core/utils/job-id-generator'

// ============================================================================
// Helper to get fresh UI state
// ============================================================================

async function getUiState(repoPath: string, declutterTrunk?: boolean): Promise<UiState | null> {
  const config: Configuration = { repoPath }
  const gitAdapter = getGitAdapter()

  const [repo, forgeState, session, workingTreeStatus] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath),
    rebaseSessionStore.getSession(repoPath),
    gitAdapter.getWorkingTreeStatus(repoPath)
  ])

  // Enhance forge state with local merged branch detection (fallback for when API doesn't have PR data)
  // Find trunk ref for ancestor checking
  const trunkBranch = repo.branches.find((b) => b.isTrunk && !b.isRemote) ??
    repo.branches.find((b) => b.isTrunk)
  const trunkRef = trunkBranch?.ref ?? 'main'

  // Detect locally merged branches (branches whose head is ancestor of trunk)
  const mergedBranchNames = await detectMergedBranches(repoPath, repo.branches, trunkRef, gitAdapter)

  // Merge local detection with forge state
  const enhancedForgeState = forgeState
    ? { ...forgeState, mergedBranchNames }
    : { pullRequests: [], mergedBranchNames }

  const stack = buildUiStack(repo, enhancedForgeState, { declutterTrunk })
  const workingTree = buildUiWorkingTree(repo)

  if (!stack) {
    return null
  }

  // Handle rebase state
  if (session) {
    if (workingTreeStatus.isRebasing) {
      // We're mid-rebase - show the appropriate status
      const activeJobId = session.state.queue.activeJobId
      const activeJob = activeJobId ? session.state.jobsById[activeJobId] : null

      if (activeJob) {
        const hasConflicts = workingTreeStatus.conflicted.length > 0
        applyRebaseStatusToStack(stack, activeJob.branch, hasConflicts ? 'conflicted' : 'resolved')
      }
    } else {
      // Git is no longer rebasing but we have a session - external tool completed the rebase
      // Clean up the stale session
      await rebaseSessionStore.clearSession(repoPath)
    }
  } else if (workingTreeStatus.isRebasing) {
    // Git is rebasing but we have no session - this is an orphaned rebase
    // (e.g., the app was restarted mid-rebase, or rebase started externally)
    // Try to recover the branch name from Git's rebase state
    if (supportsGetRebaseState(gitAdapter)) {
      const gitRebaseState = await gitAdapter.getRebaseState(repoPath)
      if (gitRebaseState?.branch) {
        const hasConflicts = workingTreeStatus.conflicted.length > 0
        applyRebaseStatusToStack(stack, gitRebaseState.branch, hasConflicts ? 'conflicted' : 'resolved')
      }
    }
  }

  const trunkHeadSha = getTrunkHeadSha(repo.branches, repo.commits)
  return { stack, workingTree, trunkHeadSha }
}

/**
 * Recursively finds commits belonging to a branch and marks them with the given rebase status
 */
function applyRebaseStatusToStack(
  stack: UiStack,
  branchName: string,
  status: 'conflicted' | 'resolved'
): void {
  for (const commit of stack.commits) {
    // Check if this commit belongs to the branch being rebased
    if (commit.branches.some((b) => b.name === branchName)) {
      commit.rebaseStatus = status
    }

    // Recurse into spinoffs
    for (const spinoff of commit.spinoffs) {
      applyRebaseStatusToStack(spinoff, branchName, status)
    }
  }
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

const getRepo: IpcHandlerOf<'getRepo'> = async (_event, { repoPath, declutterTrunk = true }) => {
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
  const gitAdapter = getGitAdapter()
  const [repo, forgeState, currentBranch] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath),
    gitAdapter.currentBranch(repoPath)
  ])

  const rebaseIntent = buildRebaseIntent(repo, headSha, baseSha)
  if (!rebaseIntent) {
    return null
  }

  // Create the rebase plan
  const plan = createRebasePlan({
    repo,
    intent: rebaseIntent,
    generateJobId: createJobIdGenerator()
  })

  // Clear any existing session first (in case of stale state)
  await rebaseSessionStore.clearSession(repoPath)

  // Store the plan in the session store for later confirmation
  const storedSession = createStoredSession(plan, currentBranch ?? 'HEAD')
  const createResult = await rebaseSessionStore.createSession(repoPath, storedSession)

  if (!createResult.success) {
    // Session already exists - this shouldn't happen after clearSession, but handle gracefully
    console.warn('Failed to create rebase session:', createResult.reason)
  }

  // Build the UI state with the rebase preview
  const fullUiState = buildFullUiState(repo, { rebaseIntent, gitForgeState: forgeState })
  const stack = fullUiState.projectedStack ?? fullUiState.stack
  if (!stack) {
    return null
  }

  const trunkHeadSha = getTrunkHeadSha(repo.branches, repo.commits)
  return { stack, workingTree, trunkHeadSha }
}

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = async (_event, { repoPath }) => {
  // Get the stored session from submitRebaseIntent
  const session = await rebaseSessionStore.getSession(repoPath)

  if (!session) {
    // No pending rebase intent - nothing to confirm
    console.warn('confirmRebaseIntent called but no session found for:', repoPath)
    return getUiState(repoPath)
  }

  try {
    // Execute the stored plan
    const result = await executeRebasePlan(
      repoPath,
      { intent: session.intent, state: session.state },
      getGitAdapter()
    )

    if (result.status === 'error') {
      // Clear session on error so user can retry
      await rebaseSessionStore.clearSession(repoPath)
      throw new Error(result.message)
    }

    if (result.status === 'conflict') {
      // Keep session active for conflict resolution
      // The UI will show conflicts and allow continue/abort
      return getUiState(repoPath)
    }

    // Success - clear the session
    await rebaseSessionStore.clearSession(repoPath)
    return getUiState(repoPath)
  } catch (error) {
    // Clear session on unexpected error
    await rebaseSessionStore.clearSession(repoPath)
    throw error
  }
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
  } catch {
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

const checkoutHandler: IpcHandlerOf<'checkout'> = async (
  _event,
  { repoPath, ref }
): Promise<CheckoutResponse> => {
  const result = await smartCheckout(repoPath, ref)
  if (!result.success) {
    throw new Error(result.error || 'Checkout failed')
  }

  const uiState = await getUiState(repoPath)

  // Generate message for remote checkouts
  let message: string | undefined
  const parsed = parseRemoteBranch(ref)
  if (parsed) {
    message = `Synced to ${parsed.localBranch}`
  }

  return { uiState, message }
}

const deleteBranchHandler: IpcHandlerOf<'deleteBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await deleteBranch(repoPath, branchName)
  return getUiState(repoPath)
}

const cleanupBranchHandler: IpcHandlerOf<'cleanupBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await cleanupBranch(repoPath, branchName)
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

const updatePullRequest: IpcHandlerOf<'updatePullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  await updatePullRequestCore(repoPath, headBranch)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const shipIt: IpcHandlerOf<'shipIt'> = async (
  _event,
  { repoPath, branchName }
): Promise<ShipItResponse> => {
  try {
    const gitAdapter = getGitAdapter()

    // 1. Get forge state to find PR number and target branch
    const forgeState = await gitForgeService.getState(repoPath)
    const pr = forgeState.pullRequests.find(
      (p) => p.headRefName === branchName && p.state === 'open'
    )

    if (!pr) {
      throw new Error(`No open PR found for branch "${branchName}"`)
    }

    // 2. Get current branch before merging (for navigation decision)
    const currentBranch = await gitAdapter.currentBranch(repoPath)
    const wasOnShippedBranch = currentBranch === branchName
    const targetBranch = pr.baseRefName

    // 3. Check if shipped branch has children (other PRs targeting it)
    const hasChildren = forgeState.pullRequests.some(
      (p) => p.baseRefName === branchName && p.state === 'open'
    )

    // 4. Merge via GitHub API (squash merge)
    await gitForgeService.mergePullRequest(repoPath, pr.number)

    // 5. Fetch to update remote refs
    await gitAdapter.fetch(repoPath)

    // 6. Navigate to appropriate branch after shipping
    let message: string
    if (wasOnShippedBranch) {
      // User was on the shipped branch - move them to the PR target (usually main)
      await gitAdapter.checkout(repoPath, targetBranch)

      // Try to fast-forward to match remote
      const remoteBranch = `origin/${targetBranch}`
      if (supportsMerge(gitAdapter)) {
        try {
          await gitAdapter.merge(repoPath, remoteBranch, { ffOnly: true })
        } catch {
          // Fast-forward failed - that's okay, user is still on target branch
        }
      }

      message = `Shipped! Switched to ${targetBranch}.`
    } else {
      message = 'Shipped!'
    }

    // Add rebase notice if there are child branches
    if (hasChildren) {
      message += ' Remaining branches need rebasing.'
    }

    // 7. Return updated UI state with navigation result
    const uiState = await getUiState(repoPath)
    return {
      uiState,
      message,
      needsRebase: hasChildren
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
// Utilities
// ============================================================================

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
  ipcMain.handle(IPC_CHANNELS.cleanupBranch, cleanupBranchHandler)

  // GitHub
  ipcMain.handle(IPC_CHANNELS.createPullRequest, createPullRequest)
  ipcMain.handle(IPC_CHANNELS.shipIt, shipIt)

  // History
  ipcMain.handle(IPC_CHANNELS.uncommit, uncommit)
  ipcMain.handle(IPC_CHANNELS.updatePullRequest, updatePullRequest)
}
