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

import { log } from '@shared/logger'
import type {
  Configuration,
  DetachedWorktree,
  RebaseOperationResponse,
  RebaseStatusResponse,
  SubmitRebaseIntentResponse,
  UiState,
  WorktreeConflict
} from '@shared/types'
import { getGitAdapter, supportsGetRebaseState } from '../adapters/git'
import {
  RebaseIntentBuilder,
  RebaseStateMachine,
  RebaseValidator,
  TrunkResolver,
  UiStateBuilder
} from '../domain'
import { ExecutionContextService, RepoModelService, SessionService } from '../services'
import { createJobIdGenerator } from '../shared/job-id'
import { configStore } from '../store'
import { RebaseExecutor, type RebaseErrorCode } from './RebaseExecutor'
import { UiStateOperation } from './UiStateOperation'
import { WorktreeOperation } from './WorktreeOperation'

/**
 * Custom error class for rebase operation failures that preserves error codes
 * for specific handling in the frontend.
 *
 * The error code is encoded in the error name (e.g., 'RebaseOperationError:WORKTREE_CREATION_FAILED')
 * so it survives IPC serialization. Additionally, toJSON() provides explicit serialization
 * for better debugging and potential future use.
 */
export class RebaseOperationError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: RebaseErrorCode
  ) {
    super(message)
    // Encode error code in name so it survives IPC serialization
    this.name = errorCode ? `RebaseOperationError:${errorCode}` : 'RebaseOperationError'
  }

  /**
   * Custom JSON serialization for better error transmission across IPC.
   * Ensures all error properties are preserved when the error is serialized.
   */
  toJSON(): {
    name: string
    message: string
    errorCode: RebaseErrorCode | undefined
    stack: string | undefined
  } {
    return {
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
      stack: this.stack
    }
  }

  /**
   * Extracts error code from an error name string.
   * Used by frontend to decode error codes that survive IPC serialization.
   * @param errorName - The error name (e.g., 'RebaseOperationError:WORKTREE_CREATION_FAILED')
   * @returns The error code or null if not found/invalid
   */
  static extractErrorCode(errorName: string): RebaseErrorCode | null {
    const match = errorName.match(/^RebaseOperationError:([A-Z_]+)$/)
    if (!match) return null

    const code = match[1]
    // Validate against known error codes
    const validCodes: RebaseErrorCode[] = [
      'WORKTREE_CREATION_FAILED',
      'REBASE_IN_PROGRESS',
      'GIT_ADAPTER_UNSUPPORTED',
      'VALIDATION_FAILED',
      'SESSION_EXISTS',
      'BRANCH_NOT_FOUND',
      'CONTEXT_ACQUISITION_FAILED',
      'GENERIC'
    ]

    return validCodes.includes(code as RebaseErrorCode) ? (code as RebaseErrorCode) : null
  }
}

export class RebaseOperation {
  /**
   * Build a rebase plan, store it in session, and return the preview UI payload.
   * Returns null when no rebase intent can be built (e.g., invalid head/base).
   * Returns worktree conflicts if any branches are checked out in other worktrees.
   */
  static async submitRebaseIntent(
    repoPath: string,
    headSha: string,
    baseSha: string,
    options: { preDetachedWorktrees?: DetachedWorktree[] } = {}
  ): Promise<SubmitRebaseIntentResponse> {
    log.debug('[RebaseOperation] submitRebaseIntent() called', {
      repoPath,
      headSha: headSha?.slice(0, 8),
      baseSha: baseSha?.slice(0, 8),
      preDetachedWorktreeCount: options.preDetachedWorktrees?.length ?? 0
    })

    const config: Configuration = { repoPath }
    const gitAdapter = getGitAdapter()
    // Don't fetch forge state here - it blocks on network and is only used for PR enrichment.
    // Frontend will enrich the preview with cached PR data from ForgeStateContext.
    const [repo, currentBranch] = await Promise.all([
      RepoModelService.buildRepoModel(config),
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

    let autoDetachedWorktrees = [...(options.preDetachedWorktrees ?? [])]

    if (!worktreeValidation.valid) {
      const { clean, dirty } = RebaseValidator.partitionWorktreeConflicts(
        worktreeValidation.conflicts
      )

      if (dirty.length > 0) {
        return {
          success: false,
          error: 'WORKTREE_CONFLICT',
          worktreeConflicts: dirty,
          message: RebaseValidator.formatWorktreeConflictMessage(dirty)
        }
      }

      const { detached, failures } = await RebaseOperation.detachCleanWorktrees(clean)

      if (failures.length > 0) {
        const conflicts = [...dirty, ...failures]
        return {
          success: false,
          error: 'WORKTREE_CONFLICT',
          worktreeConflicts: conflicts,
          message: RebaseValidator.formatWorktreeConflictMessage(conflicts)
        }
      }

      autoDetachedWorktrees = RebaseOperation.mergeDetachedWorktrees(
        autoDetachedWorktrees,
        detached
      )
    }

    const plan = RebaseStateMachine.createRebasePlan({
      repo,
      intent: rebaseIntent,
      generateJobId: createJobIdGenerator()
    })

    await SessionService.clearSession(repoPath)
    const storedSession = SessionService.createStoredSession(plan, currentBranch ?? 'HEAD', {
      autoDetachedWorktrees
    })
    const createResult = await SessionService.rebaseSessionStore.createSession(
      repoPath,
      storedSession
    )
    if (!createResult.success) {
      throw new Error('Failed to create rebase session')
    }

    const fullUiState = UiStateBuilder.buildFullUiState(repo, {
      rebaseIntent,
      gitForgeState: { pullRequests: [] }
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
  static async confirmRebaseIntent(repoPath: string): Promise<RebaseOperationResponse> {
    log.debug('[RebaseOperation] confirmRebaseIntent() called', { repoPath })
    const session = await SessionService.getSession(repoPath)
    log.debug('[RebaseOperation] confirmRebaseIntent() session state', {
      hasSession: !!session,
      intentTargetCount: session?.intent.targets.length,
      pendingJobCount: session?.state.queue.pendingJobIds.length
    })

    if (!session) {
      // No session is a benign scenario (e.g., user retried); return current UI state.
      const uiState = await UiStateOperation.getUiState(repoPath)
      return { success: true, uiState }
    }

    try {
      const result = await RebaseExecutor.execute(
        repoPath,
        { intent: session.intent, state: session.state },
        getGitAdapter()
      )

      if (result.status === 'error') {
        log.error('[RebaseOperation] confirmRebaseIntent() execution failed', {
          repoPath,
          errorCode: result.errorCode,
          message: result.message
        })
        // For dirty worktree errors, keep the session so the user can clean up and retry
        if (result.errorCode !== 'DIRTY_WORKTREE') {
          await SessionService.clearSession(repoPath)
        }
        throw new RebaseOperationError(result.message, result.errorCode)
      }

      const uiState = await UiStateOperation.getUiState(repoPath)

      if (result.status === 'conflict') {
        return { success: false, uiState, conflicts: result.conflicts }
      }

      return { success: true, uiState }
    } catch (error) {
      // Don't clear session for dirty worktree errors
      if (error instanceof RebaseOperationError && error.errorCode === 'DIRTY_WORKTREE') {
        throw error
      }
      await SessionService.clearSession(repoPath)
      throw error
    }
  }

  /**
   * Cancel the current rebase intent/session and return fresh UI state.
   * Also cleans up any stored execution context and temp worktree from parallel mode.
   */
  static async cancelRebaseIntent(repoPath: string) {
    log.debug('[RebaseOperation] cancelRebaseIntent() called', { repoPath })
    // Get session info BEFORE clearing - we need originalBranch to restore active worktree
    const session = await SessionService.getSession(repoPath)
    log.debug('[RebaseOperation] cancelRebaseIntent() session state', {
      hasSession: !!session,
      originalBranch: session?.originalBranch
    })

    // Check for stored execution context (temp worktree)
    const storedContext = await ExecutionContextService.getStoredContext(repoPath)

    // Clear the session first
    await SessionService.clearSession(repoPath)

    // If there was a stored context (temp worktree), clean it up
    if (storedContext) {
      const git = getGitAdapter()
      const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath

      // If there's a rebase in progress in the temp worktree, abort it first
      try {
        const tempStatus = await git.getWorkingTreeStatus(storedContext.executionPath)
        if (tempStatus.isRebasing && 'rebaseAbort' in git && git.rebaseAbort) {
          await git.rebaseAbort(storedContext.executionPath)
        }
      } catch {
        // Temp worktree might not exist anymore, ignore
      }

      // Release the temp worktree
      try {
        await ExecutionContextService.release({
          executionPath: storedContext.executionPath,
          isTemporary: storedContext.isTemporary,
          requiresCleanup: storedContext.isTemporary,
          createdAt: storedContext.createdAt,
          operation: storedContext.operation,
          repoPath: storedContext.repoPath
        })
      } catch {
        // Best effort cleanup
      }

      // Clear the stored context
      await ExecutionContextService.clearStoredContext(repoPath)

      // Restore original branch in active worktree if it was detached for parallel mode
      if (storedContext.isTemporary && session?.originalBranch) {
        try {
          const status = await git.getWorkingTreeStatus(activeWorktreePath)
          if (status.detached) {
            await git.checkout(activeWorktreePath, session.originalBranch)
          }
        } catch {
          // Best effort - user can manually checkout
        }
      }
    }

    return UiStateOperation.getUiState(repoPath)
  }

  /**
   * Continue a rebase after conflicts are resolved.
   */
  static async continueRebase(repoPath: string): Promise<RebaseOperationResponse> {
    log.debug('[RebaseOperation] continueRebase() called', { repoPath })
    const result = await RebaseExecutor.continue(repoPath)
    log.debug('[RebaseOperation] continueRebase() result', {
      status: result.status,
      hasConflicts: result.status === 'conflict' ? result.conflicts?.length : undefined
    })
    const uiState = await UiStateOperation.getUiState(repoPath)

    if (result.status === 'error') {
      throw new RebaseOperationError(result.message, result.errorCode)
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
    log.debug('[RebaseOperation] abortRebase() called', { repoPath })
    const result = await RebaseExecutor.abort(repoPath)
    log.debug('[RebaseOperation] abortRebase() result', { success: result.success })
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
      throw new RebaseOperationError(result.message, result.errorCode)
    }

    if (result.status === 'conflict') {
      return { success: false, uiState, conflicts: result.conflicts }
    }

    return { success: true, uiState }
  }

  /**
   * Get current rebase status snapshot.
   * Does not throw; falls back to a safe default if status cannot be read.
   *
   * When a rebase is running in a temp worktree (parallel mode), this checks
   * the execution context path for rebase state, not the main repo path.
   */
  static async getRebaseStatus(repoPath: string): Promise<RebaseStatusResponse> {
    log.debug('[RebaseOperation] getRebaseStatus() called', { repoPath })
    try {
      const adapter = getGitAdapter()
      const session = await SessionService.getSession(repoPath)

      // Check if there's a stored execution context (temp worktree with conflict)
      // If so, we need to check that path for rebase state, not the main repo
      const storedContext = await ExecutionContextService.getStoredContext(repoPath)
      const executionPath = storedContext?.executionPath ?? repoPath

      const workingTreeStatus = await adapter.getWorkingTreeStatus(executionPath)

      let progress: RebaseStatusResponse['progress'] = undefined

      if (supportsGetRebaseState(adapter) && workingTreeStatus.isRebasing) {
        const gitRebaseState = await adapter.getRebaseState(executionPath)
        if (gitRebaseState) {
          progress = {
            currentStep: gitRebaseState.currentStep,
            totalSteps: gitRebaseState.totalSteps,
            branch: gitRebaseState.branch
          }
        }
      }

      const status: RebaseStatusResponse = {
        isRebasing: workingTreeStatus.isRebasing,
        hasSession: session !== null,
        state: session?.state,
        conflicts: workingTreeStatus.conflicted,
        progress
      }
      log.debug('[RebaseOperation] getRebaseStatus() returning', {
        isRebasing: status.isRebasing,
        hasSession: status.hasSession,
        conflictCount: status.conflicts?.length ?? 0,
        sessionStatus: session?.state.session.status,
        executionPath
      })
      return status
    } catch (error) {
      log.debug('[RebaseOperation] getRebaseStatus() error, returning default', {
        error: error instanceof Error ? error.message : String(error)
      })
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

  private static async detachCleanWorktrees(
    conflicts: WorktreeConflict[]
  ): Promise<{ detached: DetachedWorktree[]; failures: WorktreeConflict[] }> {
    if (conflicts.length === 0) return { detached: [], failures: [] }

    const conflictsByPath = new Map<string, WorktreeConflict>()
    for (const conflict of conflicts) {
      if (!conflictsByPath.has(conflict.worktreePath)) {
        conflictsByPath.set(conflict.worktreePath, conflict)
      }
    }

    const detached: DetachedWorktree[] = []
    const failures: WorktreeConflict[] = []

    for (const conflict of conflictsByPath.values()) {
      const result = await WorktreeOperation.detachHead(conflict.worktreePath)
      if (!result.success) {
        failures.push({ ...conflict, isDirty: true })
        continue
      }
      detached.push({ worktreePath: conflict.worktreePath, branch: conflict.branch })
    }

    return { detached, failures }
  }

  private static mergeDetachedWorktrees(
    existing: DetachedWorktree[],
    next: DetachedWorktree[]
  ): DetachedWorktree[] {
    if (!next.length) return existing

    const byPath = new Map<string, DetachedWorktree>()
    for (const entry of [...existing, ...next]) {
      byPath.set(entry.worktreePath, entry)
    }
    return Array.from(byPath.values())
  }
}
