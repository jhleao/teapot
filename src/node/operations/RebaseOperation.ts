/**
 * RebaseOperation - rebase capability facade
 *
 * User-facing orchestration for the full rebase flow:
 * - plan/preview intent
 * - confirm/cancel intent
 * - continue/abort/skip during conflicts
 * - status snapshots
 *
 * Internally delegates execution to `RebaseExecutor`.
 */

import type {
  Configuration,
  RebaseOperationResponse,
  RebaseStatusResponse,
  SubmitRebaseIntentResponse,
  UiState
} from '@shared/types'
import { getGitAdapter, supportsGetRebaseState } from '../adapters/git'
import {
  RebaseIntentBuilder,
  RebaseStateMachine,
  RebaseValidator,
  TrunkResolver,
  UiStateBuilder
} from '../domain'
import { RepoModelService, SessionService } from '../services'
import { gitForgeService } from '../services/ForgeService'
import { createJobIdGenerator } from '../shared/job-id'
import { configStore } from '../store'
import { RebaseExecutor } from './RebaseExecutor'
import { UiStateOperation } from './UiStateOperation'

export class RebaseOperation {
  /**
   * Build a rebase plan, store it in session, and return the preview UI payload.
   * Returns null when no rebase intent can be built (e.g., invalid head/base).
   * Returns worktree conflicts if any branches are checked out in other worktrees.
   */
  static async submitRebaseIntent(
    repoPath: string,
    headSha: string,
    baseSha: string
  ): Promise<SubmitRebaseIntentResponse> {
    const config: Configuration = { repoPath }
    const gitAdapter = getGitAdapter()
    const [repo, forgeState, currentBranch] = await Promise.all([
      RepoModelService.buildRepoModel(config),
      gitForgeService.getStateWithStatus(repoPath).then((r) => r.state),
      gitAdapter.currentBranch(repoPath)
    ])

    const rebaseIntent = RebaseIntentBuilder.build(repo, headSha, baseSha)
    if (!rebaseIntent) {
      return null
    }

    // Check for worktree conflicts before proceeding
    const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath
    const worktreeValidation = RebaseValidator.validateNoWorktreeConflicts(
      rebaseIntent,
      repo.worktrees,
      activeWorktreePath
    )

    if (!worktreeValidation.valid) {
      return {
        success: false,
        error: 'WORKTREE_CONFLICT',
        worktreeConflicts: worktreeValidation.conflicts,
        message: worktreeValidation.message
      }
    }

    const plan = RebaseStateMachine.createRebasePlan({
      repo,
      intent: rebaseIntent,
      generateJobId: createJobIdGenerator()
    })

    await SessionService.clearSession(repoPath)
    const storedSession = SessionService.createStoredSession(plan, currentBranch ?? 'HEAD')
    const createResult = await SessionService.rebaseSessionStore.createSession(
      repoPath,
      storedSession
    )
    if (!createResult.success) {
      throw new Error('Failed to create rebase session')
    }

    const fullUiState = UiStateBuilder.buildFullUiState(repo, {
      rebaseIntent,
      gitForgeState: forgeState
    })

    const stack = fullUiState.projectedStack ?? fullUiState.stack
    if (!stack) {
      return null
    }

    const trunkHeadSha = TrunkResolver.getTrunkHeadSha(repo.branches, repo.commits)
    const uiState: UiState = { stack, workingTree: [], trunkHeadSha }

    return { success: true, uiState }
  }

  /**
   * Confirm the current rebase intent and execute it.
   * Returns updated UI state; throws on fatal errors.
   */
  static async confirmRebaseIntent(repoPath: string) {
    const session = await SessionService.getSession(repoPath)

    if (!session) {
      // No session is a benign scenario (e.g., user retried); return current UI state.
      return UiStateOperation.getUiState(repoPath)
    }

    try {
      const result = await RebaseExecutor.execute(
        repoPath,
        { intent: session.intent, state: session.state },
        getGitAdapter()
      )

      if (result.status === 'error') {
        await SessionService.clearSession(repoPath)
        throw new Error(result.message)
      }

      return UiStateOperation.getUiState(repoPath)
    } catch (error) {
      await SessionService.clearSession(repoPath)
      throw error
    }
  }

  /**
   * Cancel the current rebase intent/session and return fresh UI state.
   */
  static async cancelRebaseIntent(repoPath: string) {
    await SessionService.clearSession(repoPath)
    return UiStateOperation.getUiState(repoPath)
  }

  /**
   * Continue a rebase after conflicts are resolved.
   */
  static async continueRebase(repoPath: string): Promise<RebaseOperationResponse> {
    const result = await RebaseExecutor.continue(repoPath)
    const uiState = await UiStateOperation.getUiState(repoPath)

    if (result.status === 'error') {
      throw new Error(result.message)
    }

    if (result.status === 'conflict') {
      return { success: false, uiState, conflicts: result.conflicts }
    }

    return { success: true, uiState }
  }

  /**
   * Abort a rebase and return updated UI state.
   */
  static async abortRebase(repoPath: string): Promise<RebaseOperationResponse> {
    const result = await RebaseExecutor.abort(repoPath)
    const uiState = await UiStateOperation.getUiState(repoPath)

    if (!result.success) {
      throw new Error(result.message || 'Failed to abort rebase')
    }

    return { success: true, uiState }
  }

  /**
   * Skip current rebase commit and return updated UI state.
   */
  static async skipRebaseCommit(repoPath: string): Promise<RebaseOperationResponse> {
    const result = await RebaseExecutor.skip(repoPath)
    const uiState = await UiStateOperation.getUiState(repoPath)

    if (result.status === 'error') {
      throw new Error(result.message)
    }

    if (result.status === 'conflict') {
      return { success: false, uiState, conflicts: result.conflicts }
    }

    return { success: true, uiState }
  }

  /**
   * Get current rebase status snapshot.
   * Does not throw; falls back to a safe default if status cannot be read.
   */
  static async getRebaseStatus(repoPath: string): Promise<RebaseStatusResponse> {
    try {
      const adapter = getGitAdapter()
      const [session, workingTreeStatus] = await Promise.all([
        SessionService.getSession(repoPath),
        adapter.getWorkingTreeStatus(repoPath)
      ])

      let progress: RebaseStatusResponse['progress'] = undefined

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
      return { isRebasing: false, hasSession: false, conflicts: [] }
    }
  }

  /**
   * Resume the rebase queue after an external continue.
   */
  static async resumeRebaseQueue(repoPath: string): Promise<RebaseOperationResponse> {
    const session = await SessionService.getSession(repoPath)
    if (!session) {
      return {
        success: false,
        uiState: await UiStateOperation.getUiState(repoPath),
        error: 'No session found'
      }
    }

    const git = getGitAdapter()
    const result = await RebaseExecutor.execute(
      repoPath,
      { intent: session.intent, state: session.state },
      git
    )

    const uiState = await UiStateOperation.getUiState(repoPath)

    if (result.status === 'error') {
      return { success: false, uiState, error: result.message }
    }
    if (result.status === 'conflict') {
      return { success: false, uiState, conflicts: result.conflicts }
    }
    return { success: true, uiState }
  }

  /**
   * Dismiss the rebase queue without continuing.
   */
  static async dismissRebaseQueue(repoPath: string): Promise<UiState | null> {
    await SessionService.clearSession(repoPath)
    return UiStateOperation.getUiState(repoPath)
  }
}
