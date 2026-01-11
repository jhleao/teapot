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
import { ExecutionContextService, SessionService } from '../services'
import type { ExecutionContext } from '../services/ExecutionContextService'
import type { StoredRebaseSession } from '../services/SessionService'
import { createJobIdGenerator } from '../shared/job-id'
import { parseWorktreeConflictError } from './WorktreeUtils'
import { checkConflictResolution } from '../utils/conflict-markers'
import { WorktreeOperation } from './WorktreeOperation'

export type RebaseExecutionResult =
  | { status: 'completed'; finalState: RebaseState }
  | { status: 'conflict'; job: RebaseJob; conflicts: string[]; state: RebaseState }
  | { status: 'error'; message: string; state?: RebaseState }

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
      // Acquire execution context - will reuse stored context if there's a conflict in progress
      let context: ExecutionContext
      try {
        context = await ExecutionContextService.acquire(repoPath, 'rebase')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { status: 'error', message: `Failed to acquire execution context: ${message}` }
      }

      try {
        const rebaseCheck = await this.validateNoRebaseInProgress(context.executionPath, git)
        if (!rebaseCheck.valid) {
          await ExecutionContextService.release(context)
          return { status: 'error', message: rebaseCheck.message }
        }

        if (!supportsRebase(git)) {
          await ExecutionContextService.release(context)
          return { status: 'error', message: 'Git adapter does not support rebase operations' }
        }

        const result = await this.executeJobs(
          repoPath,
          context.executionPath,
          git,
          existingSession.intent,
          options
        )

        // Handle context based on result
        if (result.status === 'conflict') {
          // Store context for later continue/abort - don't release
          await ExecutionContextService.storeContext(repoPath, context)
        } else {
          // Completed or error - clear any stored context and release
          await ExecutionContextService.clearStoredContext(repoPath)
          await ExecutionContextService.release(context)
        }

        return result
      } catch (error) {
        // On error, release context
        await ExecutionContextService.release(context)
        throw error
      }
    }

    const validation = await this.validateForExecution(repoPath, plan.intent, git)
    if (!validation.valid) {
      return { status: 'error', message: validation.message }
    }

    if (!supportsRebase(git)) {
      return { status: 'error', message: 'Git adapter does not support rebase operations' }
    }

    const originalBranch = await git.currentBranch(repoPath)
    if (!originalBranch) {
      return { status: 'error', message: 'Could not determine current branch' }
    }

    const createResult = await this.createSession(repoPath, plan, originalBranch)
    if (!createResult.success) {
      return { status: 'error', message: 'A rebase session already exists for this repository' }
    }

    // Acquire execution context for new session
    let context: ExecutionContext
    try {
      context = await ExecutionContextService.acquire(repoPath, 'rebase')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await SessionService.clearSession(repoPath)
      return { status: 'error', message: `Failed to acquire execution context: ${message}` }
    }

    try {
      const result = await this.executeJobs(
        repoPath,
        context.executionPath,
        git,
        plan.intent,
        options
      )

      // Handle context based on result
      if (result.status === 'conflict') {
        // Store context for later continue/abort - don't release
        await ExecutionContextService.storeContext(repoPath, context)
      } else {
        // Completed or error - clear any stored context and release
        await ExecutionContextService.clearStoredContext(repoPath)
        await ExecutionContextService.release(context)
      }

      return result
    } catch (error) {
      // On error, release context
      await ExecutionContextService.release(context)
      throw error
    }
  }

  /**
   * Continue rebase after resolving conflicts.
   */
  static async continue(repoPath: string): Promise<RebaseExecutionResult> {
    const git = getGitAdapter()
    const session = await SessionService.getSession(repoPath)

    // Acquire execution context - will reuse stored context from conflict
    let context: ExecutionContext
    try {
      context = await ExecutionContextService.acquire(repoPath, 'rebase')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: `Failed to acquire execution context: ${message}` }
    }

    // Helper to release context and return an error result
    const releaseAndReturnError = async (message: string, state?: RebaseState): Promise<RebaseExecutionResult> => {
      await ExecutionContextService.release(context)
      return state ? { status: 'error', message, state } : { status: 'error', message }
    }

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
      return releaseAndReturnError(validation.message)
    }

    if (!supportsRebaseContinue(git)) {
      return releaseAndReturnError('Git adapter does not support rebase continue')
    }

    if (!session) {
      const result = await git.rebaseContinue(context.executionPath)
      if (result.error) {
        return releaseAndReturnError(result.error)
      }
      if (result.success) {
        await ExecutionContextService.clearStoredContext(repoPath)
        await ExecutionContextService.release(context)
        return { status: 'completed', finalState: this.createMinimalState() }
      }
      if (result.conflicts.length > 0) {
        // Keep context stored for next continue attempt
        await ExecutionContextService.storeContext(repoPath, context)
        return {
          status: 'conflict',
          job: this.createRecoveryJob(),
          conflicts: result.conflicts,
          state: this.createMinimalState()
        }
      }
      return releaseAndReturnError('Continue failed and no session found')
    }

    const result = await git.rebaseContinue(context.executionPath)

    if (result.error) {
      return releaseAndReturnError(result.error, session.state)
    }

    if (!result.success && result.conflicts.length > 0) {
      const activeJobId = session.state.queue.activeJobId
      const activeJob = activeJobId ? session.state.jobsById[activeJobId] : null

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

        SessionService.updateState(repoPath, newState)
        // Keep context stored for next continue attempt
        await ExecutionContextService.storeContext(repoPath, context)
        return { status: 'conflict', job: updatedJob, conflicts: result.conflicts, state: newState }
      }

      // Keep context stored for next continue attempt
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
      const jobsResult = await this.executeJobs(
        repoPath,
        context.executionPath,
        git,
        session.intent,
        {}
      )

      // Handle context based on result
      if (jobsResult.status === 'conflict') {
        // Keep context for next continue
        await ExecutionContextService.storeContext(repoPath, context)
      } else {
        // Completed or error - clear stored context
        await ExecutionContextService.clearStoredContext(repoPath)
        await ExecutionContextService.release(context)
      }

      return jobsResult
    }

    return releaseAndReturnError('Continue failed unexpectedly')
  }

  /**
   * Abort rebase and restore original state.
   */
  static async abort(repoPath: string): Promise<{ success: boolean; message?: string }> {
    const git = getGitAdapter()

    // Get the execution path - either from stored context or use repo path
    const executionPath =
      (await ExecutionContextService.getStoredExecutionPath(repoPath)) ?? repoPath

    const validation = await this.validateCanAbort(executionPath, git)
    if (!validation.valid) {
      // No rebase in progress - just clear session and stored context
      await SessionService.clearSession(repoPath)
      await ExecutionContextService.clearStoredContext(repoPath)
      return { success: true }
    }

    if (!supportsRebaseAbort(git)) {
      return { success: false, message: 'Git adapter does not support rebase abort' }
    }

    try {
      await git.rebaseAbort(executionPath)
      await SessionService.clearSession(repoPath)
      await ExecutionContextService.clearStoredContext(repoPath)
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
      return { status: 'error', message: 'Git adapter does not support rebase skip' }
    }

    // Acquire execution context - will reuse stored context from conflict
    let context: ExecutionContext
    try {
      context = await ExecutionContextService.acquire(repoPath, 'rebase')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: `Failed to acquire execution context: ${message}` }
    }

    const session = await SessionService.getSession(repoPath)
    const result = await git.rebaseSkip(context.executionPath)

    if (!result.success && result.conflicts.length > 0) {
      // Keep context stored for next skip/continue attempt
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
      const jobsResult = await this.executeJobs(
        repoPath,
        context.executionPath,
        git,
        session.intent,
        {}
      )

      // Handle context based on result
      if (jobsResult.status === 'conflict') {
        // Keep context for next continue
        await ExecutionContextService.storeContext(repoPath, context)
      } else {
        // Completed or error - clear stored context
        await ExecutionContextService.clearStoredContext(repoPath)
        await ExecutionContextService.release(context)
      }

      return jobsResult
    }

    // Completed without session
    await ExecutionContextService.clearStoredContext(repoPath)
    await ExecutionContextService.release(context)
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
        throw new Error(`Session not found: ${repoPath}`)
      }

      const next = RebaseStateMachine.nextJob(session.state, Date.now())
      if (!next) {
        await this.finalizeRebase(repoPath, executionPath, session, git)
        return { status: 'completed', finalState: session.state }
      }

      const { job, state: stateWithActiveJob } = next
      SessionService.updateState(repoPath, stateWithActiveJob)
      options.onJobStart?.(job)

      const result = await this.executeJob(executionPath, job, git)

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

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(
          IPC_EVENTS.rebaseWarning,
          `Rebase finished but could not re-checkout: ${warning}`
        )
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
