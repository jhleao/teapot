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

import type {
  Commit,
  CommitRewrite,
  RebaseIntent,
  RebaseJob,
  RebasePlan,
  RebaseState
} from '@shared/types'
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
import { SessionService } from '../services'
import type { StoredRebaseSession } from '../services/SessionService'
import { createJobIdGenerator } from '../shared/job-id'

const { SessionNotFoundError } = SessionService

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
   */
  static async execute(
    repoPath: string,
    plan: RebasePlan,
    git: GitAdapter,
    options: ExecutorOptions = {}
  ): Promise<RebaseExecutionResult> {
    const existingSession = await SessionService.getSession(repoPath)

    if (existingSession) {
      const workingTreeCheck = await this.validateCleanWorkingTree(repoPath, git)
      if (!workingTreeCheck.valid) {
        return { status: 'error', message: workingTreeCheck.message }
      }

      const rebaseCheck = await this.validateNoRebaseInProgress(repoPath, git)
      if (!rebaseCheck.valid) {
        return { status: 'error', message: rebaseCheck.message }
      }

      if (!supportsRebase(git)) {
        return { status: 'error', message: 'Git adapter does not support rebase operations' }
      }

      return this.executeJobs(repoPath, git, existingSession.intent, options)
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

    return this.executeJobs(repoPath, git, plan.intent, options)
  }

  /**
   * Continue rebase after resolving conflicts.
   */
  static async continue(repoPath: string): Promise<RebaseExecutionResult> {
    const git = getGitAdapter()

    const validation = await this.validateCanContinue(repoPath, git)
    if (!validation.valid) {
      return { status: 'error', message: validation.message }
    }

    if (!supportsRebaseContinue(git)) {
      return { status: 'error', message: 'Git adapter does not support rebase continue' }
    }

    const session = await SessionService.getSession(repoPath)
    if (!session) {
      const result = await git.rebaseContinue(repoPath)
      if (result.error) {
        return { status: 'error', message: result.error }
      }
      if (result.success) {
        return { status: 'completed', finalState: this.createMinimalState() }
      }
      if (result.conflicts.length > 0) {
        return {
          status: 'conflict',
          job: this.createRecoveryJob(),
          conflicts: result.conflicts,
          state: this.createMinimalState()
        }
      }
      return { status: 'error', message: 'Continue failed and no session found' }
    }

    const result = await git.rebaseContinue(repoPath)

    if (result.error) {
      return { status: 'error', message: result.error, state: session.state }
    }

    if (!result.success && result.conflicts.length > 0) {
      const activeJobId = session.state.queue.activeJobId
      const activeJob = activeJobId ? session.state.jobsById[activeJobId] : null

      if (activeJob) {
        const updatedJob = RebaseStateMachine.recordConflict({
          job: activeJob,
          workingTree: await git.getWorkingTreeStatus(repoPath),
          timestampMs: Date.now()
        })

        const newState = {
          ...session.state,
          jobsById: { ...session.state.jobsById, [updatedJob.id]: updatedJob }
        }

        await SessionService.updateSessionWithRetry(repoPath, () => ({ state: newState }))
        return { status: 'conflict', job: updatedJob, conflicts: result.conflicts, state: newState }
      }

      return {
        status: 'conflict',
        job: this.createRecoveryJob(),
        conflicts: result.conflicts,
        state: session.state
      }
    }

    if (result.success) {
      const newHeadSha = result.currentCommit ?? (await git.resolveRef(repoPath, 'HEAD'))
      await this.completeCurrentJob(repoPath, session, newHeadSha)
      return this.executeJobs(repoPath, git, session.intent, {})
    }

    return { status: 'error', message: 'Continue failed unexpectedly' }
  }

  /**
   * Abort rebase and restore original state.
   */
  static async abort(repoPath: string): Promise<{ success: boolean; message?: string }> {
    const git = getGitAdapter()

    const validation = await this.validateCanAbort(repoPath, git)
    if (!validation.valid) {
      await SessionService.clearSession(repoPath)
      return { success: true }
    }

    if (!supportsRebaseAbort(git)) {
      return { success: false, message: 'Git adapter does not support rebase abort' }
    }

    try {
      await git.rebaseAbort(repoPath)
      await SessionService.clearSession(repoPath)
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

    const session = await SessionService.getSession(repoPath)
    const result = await git.rebaseSkip(repoPath)

    if (!result.success && result.conflicts.length > 0) {
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
      return this.executeJobs(repoPath, git, session.intent, {})
    }

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

    const checks = [
      () => this.validateCleanWorkingTree(repoPath, git),
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

  private static async validateCleanWorkingTree(
    repoPath: string,
    git: GitAdapter
  ): Promise<ValidationResult> {
    const status = await git.getWorkingTreeStatus(repoPath)
    return RebaseValidator.validateCleanWorkingTree(status)
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
    git: GitAdapter,
    intent: RebaseIntent,
    options: ExecutorOptions
  ): Promise<RebaseExecutionResult> {
    const generateJobId = options.generateJobId ?? createJobIdGenerator()

    while (true) {
      const session = await SessionService.getSession(repoPath)
      if (!session) {
        throw new SessionNotFoundError('Session disappeared during execution', repoPath)
      }

      const next = RebaseStateMachine.nextJob(session.state, Date.now())
      if (!next) {
        await this.finalizeRebase(repoPath, session, git)
        return { status: 'completed', finalState: session.state }
      }

      const { job, state: stateWithActiveJob } = next
      await SessionService.updateSessionWithRetry(repoPath, () => ({ state: stateWithActiveJob }))
      options.onJobStart?.(job)

      const result = await this.executeJob(repoPath, job, git)

      if (result.status === 'conflict') {
        return this.handleConflict(
          repoPath,
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
      return {
        status: 'error',
        message: `Rebase failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  private static async handleConflict(
    repoPath: string,
    job: RebaseJob,
    state: RebaseState,
    conflicts: string[],
    git: GitAdapter,
    options: ExecutorOptions
  ): Promise<RebaseExecutionResult> {
    const updatedJob = RebaseStateMachine.recordConflict({
      job,
      workingTree: await git.getWorkingTreeStatus(repoPath),
      timestampMs: Date.now()
    })

    const conflictState: RebaseState = {
      ...state,
      session: { ...state.session, status: 'awaiting-user' },
      jobsById: { ...state.jobsById, [job.id]: updatedJob }
    }

    await SessionService.updateSessionWithRetry(repoPath, () => ({ state: conflictState }))
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

    await SessionService.updateSessionWithRetry(repoPath, () => ({ state: newState }))
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
    session: StoredRebaseSession,
    git: GitAdapter
  ): Promise<void> {
    try {
      await git.checkout(repoPath, session.originalBranch)
    } catch {
      // Original branch might not exist anymore
    }

    const finalState: RebaseState = {
      ...session.state,
      session: {
        ...session.state.session,
        status: 'completed',
        completedAtMs: Date.now()
      }
    }

    await SessionService.updateSessionWithRetry(repoPath, () => ({ state: finalState }))
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

    await SessionService.updateSessionWithRetry(repoPath, () => ({ state: newState }))
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
