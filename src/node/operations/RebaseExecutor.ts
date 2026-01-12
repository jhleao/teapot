/**
 * RebaseExecutor - Rebase execution orchestration
 *
 * Orchestrates the execution of rebase operations. This module bridges the gap
 * between the pure state machine (RebaseStateMachine) and actual Git operations.
 *
 * Responsibilities:
 * - Execute individual rebase jobs via Git adapter
 * - Track commit rewrites (old SHA → new SHA mappings)
 * - Handle conflicts and pause for user resolution
 * - Enqueue child branches after parent completes
 * - Manage session state throughout the process
 */

import { log } from '@shared/logger'
import {
  IPC_EVENTS,
  type Commit,
  type CommitRewrite,
  type RebaseIntent,
  type RebaseJob,
  type RebasePlan,
  type RebaseState
} from '@shared/types'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import type { GitAdapter } from '../adapters/git'
import {
  getGitAdapter,
  supportsRebase,
  supportsRebaseAbort,
  supportsRebaseContinue,
  supportsRebaseSkip
} from '../adapters/git'
import { RebaseStateMachine, RebaseValidator, StackAnalyzer } from '../domain'
import type { ValidationResult } from '../domain/RebaseValidator'
import { ExecutionContextService, SessionService, TransactionService } from '../services'
import { WorktreeCreationError, type ExecutionContext } from '../services/ExecutionContextService'
import type { StoredRebaseSession } from '../services/SessionService'
import { createJobIdGenerator } from '../shared/job-id'
import { configStore } from '../store'
import { checkConflictResolution } from '../utils/conflict-markers'
import { WorktreeOperation } from './WorktreeOperation'
import { parseWorktreeConflictError } from './WorktreeUtils'

/**
 * Tracks cleanup failures for observability.
 * In production, this could be wired to metrics/alerting.
 */
let cleanupFailureCount = 0

/** Get cleanup failure count for observability */
export function getCleanupFailureCount(): number {
  return cleanupFailureCount
}

/** Reset cleanup failure count (for testing) */
export function resetCleanupFailureCount(): void {
  cleanupFailureCount = 0
}

/**
 * Safely release an execution context, logging but not throwing on failure.
 * This ensures cleanup failures don't mask successful operation results.
 * Tracks failures for observability.
 */
async function safeReleaseContext(
  repoPath: string,
  context: ExecutionContext,
  clearStored: boolean
): Promise<void> {
  try {
    if (clearStored) {
      await ExecutionContextService.clearStoredContext(repoPath)
    }
    await ExecutionContextService.release(context)
  } catch (error) {
    cleanupFailureCount++
    log.warn('[RebaseExecutor] Context cleanup failed (non-fatal):', {
      repoPath,
      executionPath: context.executionPath,
      isTemporary: context.isTemporary,
      clearStored,
      failureCount: cleanupFailureCount,
      error
    })
  }
}

/**
 * Safely clear stored context without acquiring one.
 * Used by abort() when no context needs to be released.
 */
async function safeClearStoredContext(repoPath: string): Promise<void> {
  try {
    await ExecutionContextService.clearStoredContext(repoPath)
  } catch (error) {
    cleanupFailureCount++
    log.warn('[RebaseExecutor] Context cleanup failed during abort (non-fatal):', {
      repoPath,
      failureCount: cleanupFailureCount,
      error
    })
  }
}

/** Error codes for rebase operations - used for specific frontend handling */
export type RebaseErrorCode =
  | 'WORKTREE_CREATION_FAILED'
  | 'REBASE_IN_PROGRESS'
  | 'GIT_ADAPTER_UNSUPPORTED'
  | 'VALIDATION_FAILED'
  | 'SESSION_EXISTS'
  | 'BRANCH_NOT_FOUND'
  | 'CONTEXT_ACQUISITION_FAILED'
  | 'GENERIC'

export type RebaseExecutionResult =
  | { status: 'completed'; finalState: RebaseState }
  | { status: 'conflict'; job: RebaseJob; conflicts: string[]; state: RebaseState }
  | { status: 'error'; message: string; errorCode?: RebaseErrorCode; state?: RebaseState }

/** Result of acquiring an execution context */
type ContextAcquisitionResult =
  | { success: true; context: ExecutionContext }
  | { success: false; error: RebaseExecutionResult }

/**
 * Gets the first pending job's branch from a rebase state.
 * Used to optimize worktree creation by creating it at the target branch directly.
 */
function getFirstPendingBranch(state: RebaseState): string | undefined {
  const firstPendingId = state.queue.pendingJobIds[0]
  if (!firstPendingId) return undefined
  const job = state.jobsById[firstPendingId]
  return job?.branch
}

/**
 * Acquires an execution context with proper error handling.
 * Returns either a context or an error result that can be returned directly.
 *
 * @param repoPath - Path to the git repository
 * @param targetBranch - Optional branch that will be operated on (helps optimize worktree creation)
 */
async function acquireContext(
  repoPath: string,
  targetBranch?: string
): Promise<ContextAcquisitionResult> {
  try {
    const context = await ExecutionContextService.acquire(repoPath, {
      operation: 'rebase',
      targetBranch
    })
    return { success: true, context }
  } catch (error) {
    if (error instanceof WorktreeCreationError) {
      return {
        success: false,
        error: {
          status: 'error',
          errorCode: 'WORKTREE_CREATION_FAILED',
          message:
            'Could not create temporary worktree for rebase. Please commit or stash your changes and try again.'
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: {
        status: 'error',
        errorCode: 'CONTEXT_ACQUISITION_FAILED',
        message: `Failed to acquire execution context: ${message}`
      }
    }
  }
}

/**
 * Executes an operation with a context, handling cleanup based on result.
 * - On conflict: stores context for later continue/abort
 * - On completion/error: releases context (best-effort)
 */
async function executeWithContext<T extends RebaseExecutionResult>(
  repoPath: string,
  context: ExecutionContext,
  operation: () => Promise<T>
): Promise<T> {
  try {
    const result = await operation()

    // Handle context based on result
    if (result.status === 'conflict') {
      // Store context for later continue/abort - don't release
      await ExecutionContextService.storeContext(repoPath, context)
    } else {
      // Completed or error - clear any stored context and release (best-effort)
      await safeReleaseContext(repoPath, context, true)
    }

    return result
  } catch (error) {
    // On error, release context (best-effort)
    await safeReleaseContext(repoPath, context, false)
    throw error
  }
}

type JobExecutionResult =
  | { status: 'completed'; newHeadSha: string; rewrites: CommitRewrite[] }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'error'; message: string }

export type ExecutorOptions = {
  generateJobId?: () => string
  onJobStart?: (job: RebaseJob) => void
  onJobComplete?: (job: RebaseJob, newHeadSha: string) => void
  onJobConflict?: (job: RebaseJob, conflicts: string[]) => void
}

export class RebaseExecutor {
  /**
   * Execute a rebase plan.
   * Automatically acquires an execution context (clean worktree) if the active worktree is dirty.
   */
  static async execute(
    repoPath: string,
    plan: RebasePlan,
    git: GitAdapter,
    options: ExecutorOptions = {}
  ): Promise<RebaseExecutionResult> {
    const existingSession = await SessionService.getSession(repoPath)

    if (existingSession) {
      log.info('[RebaseExecutor] Found existing session, continuing', {
        repoPath,
        activeJobId: existingSession.state.queue.activeJobId,
        pendingJobIds: existingSession.state.queue.pendingJobIds,
        jobCount: Object.keys(existingSession.state.jobsById).length
      })
      // Acquire execution context - will reuse stored context if there's a conflict in progress
      const targetBranch = getFirstPendingBranch(existingSession.state)
      const acquisition = await acquireContext(repoPath, targetBranch)
      if (!acquisition.success) {
        return acquisition.error
      }
      const context = acquisition.context

      return executeWithContext(repoPath, context, async () => {
        // Note: We do NOT validate for "no rebase in progress" here because:
        // 1. If there's a conflict in progress, that's expected - we need to handle it
        // 2. If we're between jobs, the worktree should be clean anyway
        // The rebase state check happens in executeJobs which handles conflicts properly

        if (!supportsRebase(git)) {
          return {
            status: 'error',
            errorCode: 'GIT_ADAPTER_UNSUPPORTED',
            message: 'Git adapter does not support rebase operations'
          } as RebaseExecutionResult
        }

        return this.executeJobs(
          repoPath,
          context.executionPath,
          git,
          existingSession.intent,
          options
        )
      })
    }

    const validation = await this.validateForExecution(repoPath, plan.intent, git)
    if (!validation.valid) {
      return {
        status: 'error',
        errorCode: 'VALIDATION_FAILED',
        message: validation.message
      }
    }

    if (!supportsRebase(git)) {
      return {
        status: 'error',
        errorCode: 'GIT_ADAPTER_UNSUPPORTED',
        message: 'Git adapter does not support rebase operations'
      }
    }

    const originalBranch = await git.currentBranch(repoPath)
    if (!originalBranch) {
      return {
        status: 'error',
        errorCode: 'BRANCH_NOT_FOUND',
        message: 'Could not determine current branch'
      }
    }

    const createResult = await this.createSession(repoPath, plan, originalBranch)
    if (!createResult.success) {
      return {
        status: 'error',
        errorCode: 'SESSION_EXISTS',
        message: 'A rebase session already exists for this repository'
      }
    }

    // Acquire execution context for new session - pass first branch to optimize worktree creation
    const targetBranch = getFirstPendingBranch(plan.state)
    const acquisition = await acquireContext(repoPath, targetBranch)
    if (!acquisition.success) {
      await SessionService.clearSession(repoPath)
      return acquisition.error
    }
    const context = acquisition.context

    return executeWithContext(repoPath, context, async () => {
      return this.executeJobs(repoPath, context.executionPath, git, plan.intent, options)
    })
  }

  /**
   * Continue rebase after resolving conflicts.
   */
  static async continue(repoPath: string): Promise<RebaseExecutionResult> {
    const git = getGitAdapter()
    const session = await SessionService.getSession(repoPath)

    // Acquire execution context - will reuse stored context from conflict
    // Pass target branch in case we need to create a new context (e.g., stored context was cleared)
    const targetBranch = session ? getFirstPendingBranch(session.state) : undefined
    const acquisition = await acquireContext(repoPath, targetBranch)
    if (!acquisition.success) {
      return acquisition.error
    }
    const context = acquisition.context

    // Auto-stage resolved files before continuing
    // Files are "resolved" when conflict markers have been removed from the file
    const workingTreeStatus = await git.getWorkingTreeStatus(context.executionPath)
    if (workingTreeStatus.conflicted.length > 0) {
      const resolutionStatus = await checkConflictResolution(
        context.executionPath,
        workingTreeStatus.conflicted
      )
      const resolvedFiles = workingTreeStatus.conflicted.filter(
        (filePath) => resolutionStatus.get(filePath) === true
      )

      if (resolvedFiles.length > 0) {
        await git.add(context.executionPath, resolvedFiles)
      }
    }

    const validation = await this.validateCanContinue(context.executionPath, git)
    if (!validation.valid) {
      return {
        status: 'error',
        errorCode: 'VALIDATION_FAILED',
        message: validation.message
      }
    }

    if (!supportsRebaseContinue(git)) {
      return {
        status: 'error',
        errorCode: 'GIT_ADAPTER_UNSUPPORTED',
        message: 'Git adapter does not support rebase continue'
      }
    }

    if (!session) {
      // No session - handle continue in recovery mode with proper context cleanup
      const result = await git.rebaseContinue(context.executionPath)
      if (result.error) {
        await safeReleaseContext(repoPath, context, true)
        return { status: 'error', errorCode: 'GENERIC', message: result.error }
      }
      if (result.success) {
        await safeReleaseContext(repoPath, context, true)
        return { status: 'completed', finalState: this.createMinimalState() }
      }
      if (result.conflicts.length > 0) {
        // Store context for next continue attempt
        await ExecutionContextService.storeContext(repoPath, context)
        return {
          status: 'conflict',
          job: this.createRecoveryJob(),
          conflicts: result.conflicts,
          state: this.createMinimalState()
        }
      }
      await safeReleaseContext(repoPath, context, true)
      return {
        status: 'error',
        errorCode: 'GENERIC',
        message: 'Continue failed and no session found'
      }
    }

    // Write transaction intent BEFORE executing git operation
    // This ensures we can recover if a crash happens during the operation
    const activeJobId = session.state.queue.activeJobId
    await TransactionService.writeIntent(repoPath, {
      id: `continue-${Date.now()}`,
      type: 'continue',
      expectedStateBefore: {
        activeJobId: activeJobId ?? undefined,
        pendingJobCount: session.state.queue.pendingJobIds.length,
        sessionStatus: session.state.session.status
      },
      context: {
        jobId: activeJobId ?? undefined,
        executionPath: context.executionPath
      }
    })

    try {
      await TransactionService.markExecuting(repoPath)
      const result = await git.rebaseContinue(context.executionPath)

      if (result.error) {
        await TransactionService.markFailed(repoPath, { message: result.error })
        await TransactionService.commitIntent(repoPath)
        await safeReleaseContext(repoPath, context, true)
        return {
          status: 'error',
          errorCode: 'GENERIC',
          message: result.error,
          state: session.state
        }
      }

      if (!result.success && result.conflicts.length > 0) {
        const currentActiveJobId = session.state.queue.activeJobId
        const activeJob = currentActiveJobId ? session.state.jobsById[currentActiveJobId] : null

        if (activeJob) {
          const updatedJob = RebaseStateMachine.recordConflict({
            job: activeJob,
            workingTree: await git.getWorkingTreeStatus(context.executionPath),
            timestampMs: Date.now()
          })

          const newState = {
            ...session.state,
            jobsById: { ...session.state.jobsById, [updatedJob.id]: updatedJob }
          }

          try {
            SessionService.updateState(repoPath, newState)
          } catch (error) {
            // Session may have been cleared externally - log and continue with conflict response
            log.warn(
              '[RebaseExecutor] Failed to update conflict state, session may have been cleared',
              { repoPath, error }
            )
          }

          // Commit intent - conflict is a valid stopping point
          await TransactionService.commitIntent(repoPath)

          // Store context for next continue attempt
          await ExecutionContextService.storeContext(repoPath, context)
          return {
            status: 'conflict',
            job: updatedJob,
            conflicts: result.conflicts,
            state: newState
          }
        }

        // Commit intent even without active job
        await TransactionService.commitIntent(repoPath)

        // Store context for next continue attempt
        await ExecutionContextService.storeContext(repoPath, context)
        return {
          status: 'conflict',
          job: this.createRecoveryJob(),
          conflicts: result.conflicts,
          state: session.state
        }
      }

      if (result.success) {
        const newHeadSha =
          result.currentCommit ?? (await git.resolveRef(context.executionPath, 'HEAD'))
        await this.completeCurrentJob(repoPath, session, newHeadSha)

        // Commit intent - job completion is a valid checkpoint
        await TransactionService.commitIntent(repoPath)

        return executeWithContext(repoPath, context, async () => {
          return this.executeJobs(repoPath, context.executionPath, git, session.intent, {})
        })
      }

      await TransactionService.markFailed(repoPath, { message: 'Continue failed unexpectedly' })
      await TransactionService.commitIntent(repoPath)
      await safeReleaseContext(repoPath, context, true)
      return { status: 'error', errorCode: 'GENERIC', message: 'Continue failed unexpectedly' }
    } catch (error) {
      // Mark transaction as failed on unexpected error
      await TransactionService.markFailed(repoPath, {
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Abort rebase and restore original state.
   */
  static async abort(repoPath: string): Promise<{ success: boolean; message?: string }> {
    const git = getGitAdapter()

    // Get the stored context to properly release temp worktree if exists
    const storedContext = await ExecutionContextService.getStoredContext(repoPath)
    const executionPath = storedContext?.executionPath ?? repoPath

    // Get session info BEFORE clearing - we need originalBranch to restore active worktree
    const session = await SessionService.getSession(repoPath)
    const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath

    const validation = await this.validateCanAbort(executionPath, git)
    if (!validation.valid) {
      // No rebase in progress - just clear session and release context (best-effort)
      await SessionService.clearSession(repoPath)
      if (storedContext) {
        await safeReleaseContext(
          repoPath,
          {
            executionPath: storedContext.executionPath,
            isTemporary: storedContext.isTemporary,
            requiresCleanup: storedContext.isTemporary,
            createdAt: storedContext.createdAt,
            operation: storedContext.operation,
            repoPath: storedContext.repoPath
          },
          true
        )
        // Restore original branch in active worktree if it was detached for parallel mode
        if (storedContext.isTemporary && session?.originalBranch) {
          await this.restoreActiveWorktree(activeWorktreePath, session.originalBranch, git)
        }
      }
      return { success: true }
    }

    if (!supportsRebaseAbort(git)) {
      return { success: false, message: 'Git adapter does not support rebase abort' }
    }

    try {
      await git.rebaseAbort(executionPath)
      await SessionService.clearSession(repoPath)
      // Release the temp worktree if we had a stored context
      if (storedContext) {
        await safeReleaseContext(
          repoPath,
          {
            executionPath: storedContext.executionPath,
            isTemporary: storedContext.isTemporary,
            requiresCleanup: storedContext.isTemporary,
            createdAt: storedContext.createdAt,
            operation: storedContext.operation,
            repoPath: storedContext.repoPath
          },
          true
        )
        // Restore original branch in active worktree if it was detached for parallel mode
        if (storedContext.isTemporary && session?.originalBranch) {
          await this.restoreActiveWorktree(activeWorktreePath, session.originalBranch, git)
        }
      } else {
        await safeClearStoredContext(repoPath)
      }
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: `Failed to abort rebase: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * Skip current commit and continue rebase.
   */
  static async skip(repoPath: string): Promise<RebaseExecutionResult> {
    const git = getGitAdapter()

    if (!supportsRebaseSkip(git)) {
      return {
        status: 'error',
        errorCode: 'GIT_ADAPTER_UNSUPPORTED',
        message: 'Git adapter does not support rebase skip'
      }
    }

    // Acquire execution context - will reuse stored context from conflict
    const session = await SessionService.getSession(repoPath)
    const targetBranch = session ? getFirstPendingBranch(session.state) : undefined
    const acquisition = await acquireContext(repoPath, targetBranch)
    if (!acquisition.success) {
      return acquisition.error
    }
    const context = acquisition.context

    const result = await git.rebaseSkip(context.executionPath)

    if (!result.success && result.conflicts.length > 0) {
      // Store context for next skip/continue attempt
      await ExecutionContextService.storeContext(repoPath, context)
      return {
        status: 'conflict',
        job: session?.state.queue.activeJobId
          ? (session.state.jobsById[session.state.queue.activeJobId] ?? this.createRecoveryJob())
          : this.createRecoveryJob(),
        conflicts: result.conflicts,
        state: session?.state ?? this.createMinimalState()
      }
    }

    if (result.success && session) {
      return executeWithContext(repoPath, context, async () => {
        return this.executeJobs(repoPath, context.executionPath, git, session.intent, {})
      })
    }

    // Completed without session - clear stored context (best-effort)
    await safeReleaseContext(repoPath, context, true)
    return { status: 'completed', finalState: session?.state ?? this.createMinimalState() }
  }

  /**
   * Check if a rebase session is in progress.
   */
  static async isInProgress(repoPath: string): Promise<boolean> {
    return SessionService.hasSession(repoPath)
  }

  /**
   * Get the current rebase session.
   */
  static async getSession(repoPath: string) {
    return SessionService.getSession(repoPath)
  }

  /**
   * Restore the active worktree to its original branch after parallel mode abort.
   * The active worktree was detached to allow branch checkout in the temp worktree.
   */
  private static async restoreActiveWorktree(
    activeWorktreePath: string,
    originalBranch: string,
    git: GitAdapter
  ): Promise<void> {
    try {
      const status = await git.getWorkingTreeStatus(activeWorktreePath)
      // Only restore if currently detached
      if (status.detached) {
        log.info('[RebaseExecutor] Restoring active worktree to original branch', {
          activeWorktreePath,
          originalBranch
        })
        await git.checkout(activeWorktreePath, originalBranch)
      }
    } catch (error) {
      // Log but don't fail - user can manually checkout
      log.warn('[RebaseExecutor] Failed to restore active worktree branch (non-fatal)', {
        activeWorktreePath,
        originalBranch,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private static async validateForExecution(
    repoPath: string,
    intent: RebaseIntent,
    git: GitAdapter
  ): Promise<ValidationResult> {
    if (!intent.targets.length) {
      return { valid: false, code: 'INVALID_INTENT', message: 'Rebase intent has no targets' }
    }

    // Note: validateCleanWorkingTree is intentionally NOT included here.
    // ExecutionContextService handles dirty worktrees by finding/creating a clean worktree.
    const checks = [
      () => this.validateNoRebaseInProgress(repoPath, git),
      () => this.validateNoExistingSession(repoPath),
      () => this.validateNotDetached(repoPath, git)
    ]

    for (const check of checks) {
      const result = await check()
      if (!result.valid) return result
    }

    return this.validateTargetRefs(repoPath, intent, git)
  }

  private static async validateNoRebaseInProgress(
    repoPath: string,
    git: GitAdapter
  ): Promise<ValidationResult> {
    const status = await git.getWorkingTreeStatus(repoPath)
    return RebaseValidator.validateNoRebaseInProgress(status)
  }

  private static async validateNoExistingSession(repoPath: string): Promise<ValidationResult> {
    const hasSession = await SessionService.hasSession(repoPath)
    if (hasSession) {
      return {
        valid: false,
        code: 'SESSION_EXISTS',
        message:
          'A rebase session is already active for this repository. Please complete or cancel it first.'
      }
    }
    return { valid: true }
  }

  private static async validateNotDetached(
    repoPath: string,
    git: GitAdapter
  ): Promise<ValidationResult> {
    const status = await git.getWorkingTreeStatus(repoPath)
    return RebaseValidator.validateNotDetached(status)
  }

  private static async validateTargetRefs(
    repoPath: string,
    intent: RebaseIntent,
    git: GitAdapter
  ): Promise<ValidationResult> {
    for (const target of intent.targets) {
      const branchSha = await git.resolveRef(repoPath, target.node.branch)
      if (!branchSha) {
        return {
          valid: false,
          code: 'BRANCH_NOT_FOUND',
          message: `Branch '${target.node.branch}' not found`
        }
      }

      if (branchSha !== target.node.headSha) {
        return {
          valid: false,
          code: 'BRANCH_MOVED',
          message: `Branch '${target.node.branch}' has moved since the rebase was planned. Please refresh and try again.`
        }
      }

      const targetBaseSha = await git.resolveRef(repoPath, target.targetBaseSha)
      if (!targetBaseSha) {
        return {
          valid: false,
          code: 'TARGET_NOT_FOUND',
          message: `Target base commit '${target.targetBaseSha.slice(0, 8)}' not found`
        }
      }

      if (target.node.baseSha === target.targetBaseSha) {
        return {
          valid: false,
          code: 'SAME_BASE',
          message: `Branch '${target.node.branch}' is already based on the target commit`
        }
      }
    }

    return { valid: true }
  }

  private static async validateCanContinue(
    repoPath: string,
    git: GitAdapter
  ): Promise<ValidationResult> {
    const status = await git.getWorkingTreeStatus(repoPath)
    return RebaseValidator.validateCanContinueRebase(status)
  }

  private static async validateCanAbort(
    repoPath: string,
    git: GitAdapter
  ): Promise<ValidationResult> {
    const status = await git.getWorkingTreeStatus(repoPath)
    return RebaseValidator.validateCanAbortRebase(status)
  }

  private static async createSession(
    repoPath: string,
    plan: RebasePlan,
    originalBranch: string
  ): Promise<{ success: boolean }> {
    return SessionService.rebaseSessionStore.createSession(repoPath, {
      intent: plan.intent,
      state: plan.state,
      originalBranch
    })
  }

  private static async executeJobs(
    repoPath: string,
    executionPath: string,
    git: GitAdapter,
    intent: RebaseIntent,
    options: ExecutorOptions
  ): Promise<RebaseExecutionResult> {
    const generateJobId = options.generateJobId ?? createJobIdGenerator()

    while (true) {
      const session = await SessionService.getSession(repoPath)
      if (!session) {
        // Session was cleared externally - return error instead of throwing
        log.error('[RebaseExecutor] Session not found during job execution', { repoPath })
        return {
          status: 'error',
          errorCode: 'GENERIC',
          message: 'Rebase session was cleared unexpectedly. Please try again.'
        }
      }

      // Check if there's a conflict in progress (active job with awaiting-user status)
      // This happens when we're resuming after a conflict was detected
      if (session.state.queue.activeJobId && session.state.session.status === 'awaiting-user') {
        const activeJob = session.state.jobsById[session.state.queue.activeJobId]
        if (activeJob) {
          log.info('[RebaseExecutor] Conflict in progress, returning conflict state', {
            repoPath,
            activeJobId: session.state.queue.activeJobId,
            jobStatus: activeJob.status
          })
          // Return the conflict state - user needs to resolve and call continue()
          const workingTreeStatus = await git.getWorkingTreeStatus(executionPath)
          return {
            status: 'conflict',
            job: activeJob,
            conflicts: workingTreeStatus.conflicted,
            state: session.state
          }
        }
      }

      const next = RebaseStateMachine.nextJob(session.state, Date.now())
      if (!next) {
        log.info('[RebaseExecutor] No more jobs to execute, finalizing', {
          repoPath,
          activeJobId: session.state.queue.activeJobId,
          pendingJobIds: session.state.queue.pendingJobIds,
          jobCount: Object.keys(session.state.jobsById).length
        })
        await this.finalizeRebase(repoPath, executionPath, session, git)
        return { status: 'completed', finalState: session.state }
      }

      const { job, state: stateWithActiveJob } = next
      log.info('[RebaseExecutor] Processing job', {
        jobId: job.id,
        branch: job.branch,
        status: job.status,
        targetBaseSha: job.targetBaseSha?.slice(0, 8)
      })
      try {
        SessionService.updateState(repoPath, stateWithActiveJob)
      } catch (error) {
        log.error('[RebaseExecutor] Failed to update session state', { repoPath, error })
        return {
          status: 'error',
          errorCode: 'GENERIC',
          message: `Failed to update rebase state: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      options.onJobStart?.(job)

      const result = await this.executeJob(executionPath, job, git)
      log.info('[RebaseExecutor] Job execution result', {
        jobId: job.id,
        branch: job.branch,
        status: result.status,
        message: result.status === 'error' ? result.message : undefined
      })

      if (result.status === 'conflict') {
        return this.handleConflict(
          repoPath,
          executionPath,
          job,
          stateWithActiveJob,
          result.conflicts,
          git,
          options
        )
      }

      if (result.status === 'error') {
        return { status: 'error', message: result.message, state: stateWithActiveJob }
      }

      await this.handleJobCompletion(
        repoPath,
        job,
        stateWithActiveJob,
        intent,
        result.newHeadSha,
        result.rewrites,
        generateJobId,
        options
      )
    }
  }

  private static async executeJob(
    repoPath: string,
    job: RebaseJob,
    git: GitAdapter
  ): Promise<JobExecutionResult> {
    if (!supportsRebase(git)) {
      return { status: 'error', message: 'Git adapter does not support rebase' }
    }

    try {
      const commitsBefore = await this.getCommitsInRange(
        repoPath,
        job.originalBaseSha,
        job.originalHeadSha,
        git
      )

      await git.checkout(repoPath, job.branch)

      const result = await git.rebase(repoPath, {
        onto: job.targetBaseSha,
        from: job.originalBaseSha,
        to: job.branch
      })

      if (!result.success) {
        if (result.conflicts.length > 0) {
          return { status: 'conflict', conflicts: result.conflicts }
        }
        return { status: 'error', message: 'Rebase failed without conflicts' }
      }

      const newHeadSha = await git.resolveRef(repoPath, job.branch)

      const commitsAfter = await this.getCommitsInRange(
        repoPath,
        job.targetBaseSha,
        newHeadSha,
        git
      )

      const rewrites = this.buildCommitRewrites(job.branch, commitsBefore, commitsAfter)

      return { status: 'completed', newHeadSha, rewrites }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Detect worktree conflict errors from git using shared utility
      const worktreeConflict = parseWorktreeConflictError(error)
      if (worktreeConflict) {
        return {
          status: 'error',
          message: `Cannot rebase: branch "${job.branch}" is checked out in worktree at ${worktreeConflict.worktreePath}. Switch to that worktree and checkout a different branch first.`
        }
      }

      return {
        status: 'error',
        message: `Rebase failed: ${errorMessage}`
      }
    }
  }

  private static async handleConflict(
    repoPath: string,
    executionPath: string,
    job: RebaseJob,
    state: RebaseState,
    conflicts: string[],
    git: GitAdapter,
    options: ExecutorOptions
  ): Promise<RebaseExecutionResult> {
    const updatedJob = RebaseStateMachine.recordConflict({
      job,
      workingTree: await git.getWorkingTreeStatus(executionPath),
      timestampMs: Date.now()
    })

    const conflictState: RebaseState = {
      ...state,
      session: { ...state.session, status: 'awaiting-user' },
      jobsById: { ...state.jobsById, [job.id]: updatedJob }
    }

    SessionService.updateState(repoPath, conflictState)
    options.onJobConflict?.(updatedJob, conflicts)

    return { status: 'conflict', job: updatedJob, conflicts, state: conflictState }
  }

  private static async handleJobCompletion(
    repoPath: string,
    job: RebaseJob,
    state: RebaseState,
    intent: RebaseIntent,
    newHeadSha: string,
    rewrites: CommitRewrite[],
    generateJobId: () => string,
    options: ExecutorOptions
  ): Promise<void> {
    const completionResult = RebaseStateMachine.completeJob({
      job,
      rebasedHeadSha: newHeadSha,
      timestampMs: Date.now(),
      rewrites
    })

    const node = StackAnalyzer.findNodeByBranch(intent, job.branch)
    let newState: RebaseState = {
      ...state,
      session: {
        ...state.session,
        commitMap: [...state.session.commitMap, ...completionResult.commitRewrites]
      },
      jobsById: { ...state.jobsById, [job.id]: completionResult.job },
      queue: { ...state.queue, activeJobId: undefined }
    }

    if (node && node.children.length > 0) {
      newState = RebaseStateMachine.enqueueDescendants({
        state: newState,
        parent: node,
        parentNewHeadSha: newHeadSha,
        timestampMs: Date.now(),
        generateJobId
      })
    }

    SessionService.updateState(repoPath, newState)
    options.onJobComplete?.(completionResult.job, newHeadSha)
  }

  private static async getCommitsInRange(
    repoPath: string,
    baseSha: string,
    headSha: string,
    git: GitAdapter
  ): Promise<Commit[]> {
    const commits = await git.log(repoPath, headSha, { depth: 100 })
    const result: Commit[] = []

    for (const commit of commits) {
      if (commit.sha === baseSha) break
      result.push(commit)
    }

    return result.reverse()
  }

  private static buildCommitRewrites(
    branch: string,
    before: Commit[],
    after: Commit[]
  ): CommitRewrite[] {
    const rewrites: CommitRewrite[] = []
    const minLength = Math.min(before.length, after.length)

    for (let i = 0; i < minLength; i++) {
      const oldCommit = before[i]
      const newCommit = after[i]
      if (oldCommit && newCommit && oldCommit.sha !== newCommit.sha) {
        rewrites.push({ branch, oldSha: oldCommit.sha, newSha: newCommit.sha })
      }
    }

    return rewrites
  }

  private static async finalizeRebase(
    repoPath: string,
    executionPath: string,
    session: StoredRebaseSession,
    git: GitAdapter
  ): Promise<void> {
    const detachedWorktrees = session.autoDetachedWorktrees ?? []
    const reattachFailures: { worktreePath: string; branch: string; error?: string }[] = []

    for (const { worktreePath, branch } of detachedWorktrees) {
      if (!fs.existsSync(worktreePath)) continue
      const result = await WorktreeOperation.checkoutBranchInWorktree(worktreePath, branch)
      if (!result.success) {
        log.error(
          `[RebaseExecutor] Failed to re-checkout ${branch} in worktree ${worktreePath}: ${result.error}`
        )
        reattachFailures.push({ worktreePath, branch, error: result.error })
      }
    }

    // Only checkout to original branch in execution path (not the active worktree)
    try {
      await git.checkout(executionPath, session.originalBranch)
    } catch {
      // Original branch might not exist anymore; ignore checkout failure
    }

    if (reattachFailures.length > 0) {
      SessionService.clearAutoDetachedWorktrees(repoPath)
      const warning = reattachFailures
        .map(
          (failure) =>
            `${failure.branch} @ ${failure.worktreePath}${failure.error ? ` (${failure.error})` : ''}`
        )
        .join(', ')

      // Send warning to all windows - wrap in try-catch since windows may be destroyed
      BrowserWindow.getAllWindows().forEach((win) => {
        try {
          win.webContents.send(
            IPC_EVENTS.rebaseWarning,
            `Rebase finished but could not re-checkout: ${warning}`
          )
        } catch {
          // Window may have been destroyed between getAllWindows and send - ignore
        }
      })
    }

    const finalState: RebaseState = {
      ...session.state,
      session: {
        ...session.state.session,
        status: 'completed',
        completedAtMs: Date.now()
      }
    }

    SessionService.updateState(repoPath, finalState)
    await SessionService.clearSession(repoPath)
  }

  private static async completeCurrentJob(
    repoPath: string,
    session: StoredRebaseSession,
    newHeadSha: string
  ): Promise<void> {
    const activeJobId = session.state.queue.activeJobId
    if (!activeJobId) return

    const activeJob = session.state.jobsById[activeJobId]
    if (!activeJob) return

    // Guard against double-completion: if job is already completed, skip
    if (activeJob.status === 'completed') {
      log.warn('[RebaseExecutor] Job already completed, skipping double completion', {
        jobId: activeJobId,
        branch: activeJob.branch
      })
      return
    }

    const completionResult = RebaseStateMachine.completeJob({
      job: activeJob,
      rebasedHeadSha: newHeadSha,
      timestampMs: Date.now(),
      rewrites: []
    })

    let newState: RebaseState = {
      ...session.state,
      jobsById: { ...session.state.jobsById, [activeJob.id]: completionResult.job },
      queue: { ...session.state.queue, activeJobId: undefined }
    }

    const node = StackAnalyzer.findNodeByBranch(session.intent, activeJob.branch)
    if (node && node.children.length > 0) {
      newState = RebaseStateMachine.enqueueDescendants({
        state: newState,
        parent: node,
        parentNewHeadSha: newHeadSha,
        timestampMs: Date.now(),
        generateJobId: createJobIdGenerator()
      })
    }

    SessionService.updateState(repoPath, newState)
  }

  private static createMinimalState(): RebaseState {
    return {
      session: {
        id: 'recovery',
        startedAtMs: Date.now(),
        status: 'running',
        initialTrunkSha: '',
        jobs: [],
        commitMap: []
      },
      jobsById: {},
      queue: { pendingJobIds: [] }
    }
  }

  private static createRecoveryJob(): RebaseJob {
    return {
      id: 'recovery-job',
      branch: 'unknown',
      originalBaseSha: '',
      originalHeadSha: '',
      targetBaseSha: '',
      status: 'awaiting-user',
      createdAtMs: Date.now()
    }
  }
}

// Exported for use by CommitOperation
export async function executeRebasePlan(
  repoPath: string,
  plan: RebasePlan,
  git: GitAdapter,
  options: ExecutorOptions = {}
): Promise<RebaseExecutionResult> {
  return RebaseExecutor.execute(repoPath, plan, git, options)
}
