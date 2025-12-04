/**
 * Rebase Executor
 *
 * Orchestrates the execution of rebase operations. This module bridges the gap
 * between the pure state machine (rebase.ts) and actual Git operations.
 *
 * Responsibilities:
 * - Execute individual rebase jobs via Git adapter
 * - Track commit rewrites (old SHA → new SHA mappings)
 * - Handle conflicts and pause for user resolution
 * - Enqueue child branches after parent completes
 * - Manage session state throughout the process
 */

import type { GitAdapter } from './git-adapter/interface'
import { supportsRebase, supportsRebaseAbort, supportsRebaseContinue, supportsRebaseSkip } from './git-adapter/interface'
import type { Commit, CommitRewrite, RebaseJob, RebasePlan, RebaseState } from '@shared/types'
import { completeJob, enqueueDescendants, nextJob, recordConflict } from '@shared/types'
import {
  rebaseSessionStore,
  updateSessionWithRetry,
  SessionNotFoundError,
  type StoredRebaseSession
} from './rebase-session-store'
import { findNodeByBranch } from './utils/stack-traversal'
import { validateRebaseIntent, validateCanContinueRebase, validateCanAbortRebase } from './rebase-validation'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a rebase execution
 */
export type RebaseExecutionResult =
  | { status: 'completed'; finalState: RebaseState }
  | { status: 'conflict'; job: RebaseJob; conflicts: string[]; state: RebaseState }
  | { status: 'error'; message: string; state?: RebaseState }

/**
 * Result of a single job execution
 */
type JobExecutionResult =
  | { status: 'completed'; newHeadSha: string; rewrites: CommitRewrite[] }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'error'; message: string }

/**
 * Options for the executor
 */
export type ExecutorOptions = {
  /** Function to generate unique job IDs */
  generateJobId?: () => string
  /** Callback when a job starts */
  onJobStart?: (job: RebaseJob) => void
  /** Callback when a job completes */
  onJobComplete?: (job: RebaseJob, newHeadSha: string) => void
  /** Callback when a job hits conflicts */
  onJobConflict?: (job: RebaseJob, conflicts: string[]) => void
}

// ============================================================================
// Main Executor Functions
// ============================================================================

/**
 * Starts executing a rebase plan.
 *
 * This function:
 * 1. Validates the intent can be executed
 * 2. Creates a session in the store
 * 3. Saves the current branch to restore later
 * 4. Processes jobs until complete or blocked by conflicts
 *
 * @param repoPath - Path to the repository
 * @param plan - The rebase plan to execute
 * @param gitAdapter - Git adapter for operations
 * @param options - Executor options
 */
export async function executeRebasePlan(
  repoPath: string,
  plan: RebasePlan,
  gitAdapter: GitAdapter,
  options: ExecutorOptions = {}
): Promise<RebaseExecutionResult> {
  // Validate we can proceed
  const validation = await validateRebaseIntent(repoPath, plan.intent, gitAdapter)
  if (!validation.valid) {
    return { status: 'error', message: validation.message }
  }

  // Check adapter supports rebase
  if (!supportsRebase(gitAdapter)) {
    return { status: 'error', message: 'Git adapter does not support rebase operations' }
  }

  // Get current branch to restore later
  const originalBranch = await gitAdapter.currentBranch(repoPath)
  if (!originalBranch) {
    return { status: 'error', message: 'Could not determine current branch' }
  }

  // Create session
  const createResult = await rebaseSessionStore.createSession(repoPath, {
    intent: plan.intent,
    state: plan.state,
    originalBranch
  })

  if (!createResult.success) {
    return { status: 'error', message: 'A rebase session already exists for this repository' }
  }

  // Execute jobs
  return executeJobs(repoPath, gitAdapter, plan.intent, options)
}

/**
 * Continues a paused rebase after conflicts have been resolved.
 *
 * @param repoPath - Path to the repository
 * @param gitAdapter - Git adapter for operations
 * @param options - Executor options
 */
export async function continueRebase(
  repoPath: string,
  gitAdapter: GitAdapter,
  options: ExecutorOptions = {}
): Promise<RebaseExecutionResult> {
  // Validate we can continue
  const validation = await validateCanContinueRebase(repoPath, gitAdapter)
  if (!validation.valid) {
    return { status: 'error', message: validation.message }
  }

  if (!supportsRebaseContinue(gitAdapter)) {
    return { status: 'error', message: 'Git adapter does not support rebase continue' }
  }

  // Get session
  const session = await rebaseSessionStore.getSession(repoPath)
  if (!session) {
    // Try to continue Git's rebase even without our session
    const result = await gitAdapter.rebaseContinue(repoPath)
    if (result.success) {
      return { status: 'completed', finalState: createMinimalState() }
    }
    if (result.conflicts.length > 0) {
      return {
        status: 'conflict',
        job: createRecoveryJob(),
        conflicts: result.conflicts,
        state: createMinimalState()
      }
    }
    return { status: 'error', message: 'Continue failed and no session found' }
  }

  // Continue Git's rebase
  const result = await gitAdapter.rebaseContinue(repoPath)

  if (!result.success && result.conflicts.length > 0) {
    // Still have conflicts
    const activeJobId = session.state.queue.activeJobId
    const activeJob = activeJobId ? session.state.jobsById[activeJobId] : null

    if (activeJob) {
      const updatedJob = recordConflict({
        job: activeJob,
        workingTree: await gitAdapter.getWorkingTreeStatus(repoPath),
        timestampMs: Date.now()
      })

      const newState = {
        ...session.state,
        jobsById: { ...session.state.jobsById, [updatedJob.id]: updatedJob }
      }

      await updateSessionWithRetry(rebaseSessionStore, repoPath, () => ({ state: newState }))

      return { status: 'conflict', job: updatedJob, conflicts: result.conflicts, state: newState }
    }

    return { status: 'conflict', job: createRecoveryJob(), conflicts: result.conflicts, state: session.state }
  }

  if (result.success) {
    // Job completed, mark it and continue with next jobs
    const newHeadSha = result.currentCommit ?? await gitAdapter.resolveRef(repoPath, 'HEAD')
    await completeCurrentJob(repoPath, session, newHeadSha)

    // Continue executing remaining jobs
    return executeJobs(repoPath, gitAdapter, session.intent, options)
  }

  return { status: 'error', message: 'Continue failed unexpectedly' }
}

/**
 * Aborts the current rebase and restores the repository.
 *
 * @param repoPath - Path to the repository
 * @param gitAdapter - Git adapter for operations
 */
export async function abortRebase(
  repoPath: string,
  gitAdapter: GitAdapter
): Promise<{ success: boolean; message?: string }> {
  // Validate we can abort
  const validation = await validateCanAbortRebase(repoPath, gitAdapter)
  if (!validation.valid) {
    // Not in a rebase, just clear session if any
    await rebaseSessionStore.clearSession(repoPath)
    return { success: true }
  }

  if (!supportsRebaseAbort(gitAdapter)) {
    return { success: false, message: 'Git adapter does not support rebase abort' }
  }

  try {
    await gitAdapter.rebaseAbort(repoPath)
    await rebaseSessionStore.clearSession(repoPath)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      message: `Failed to abort rebase: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Skips the current commit during a rebase.
 *
 * @param repoPath - Path to the repository
 * @param gitAdapter - Git adapter for operations
 * @param options - Executor options
 */
export async function skipRebaseCommit(
  repoPath: string,
  gitAdapter: GitAdapter,
  options: ExecutorOptions = {}
): Promise<RebaseExecutionResult> {
  if (!supportsRebaseSkip(gitAdapter)) {
    return { status: 'error', message: 'Git adapter does not support rebase skip' }
  }

  const session = await rebaseSessionStore.getSession(repoPath)

  const result = await gitAdapter.rebaseSkip(repoPath)

  if (!result.success && result.conflicts.length > 0) {
    // Conflicts on next commit
    return {
      status: 'conflict',
      job: session?.state.queue.activeJobId
        ? session.state.jobsById[session.state.queue.activeJobId] ?? createRecoveryJob()
        : createRecoveryJob(),
      conflicts: result.conflicts,
      state: session?.state ?? createMinimalState()
    }
  }

  if (result.success && session) {
    // Continue with remaining jobs
    return executeJobs(repoPath, gitAdapter, session.intent, options)
  }

  return { status: 'completed', finalState: session?.state ?? createMinimalState() }
}

// ============================================================================
// Internal Execution Logic
// ============================================================================

/**
 * Executes jobs from the queue until complete or blocked.
 */
async function executeJobs(
  repoPath: string,
  gitAdapter: GitAdapter,
  intent: RebasePlan['intent'],
  options: ExecutorOptions
): Promise<RebaseExecutionResult> {
  const generateJobId = options.generateJobId ?? createJobIdGenerator()

  while (true) {
    // Get fresh session state
    const session = await rebaseSessionStore.getSession(repoPath)
    if (!session) {
      throw new SessionNotFoundError('Session disappeared during execution', repoPath)
    }

    // Get next job
    const next = nextJob(session.state, Date.now())
    if (!next) {
      // All jobs complete
      await finalizeRebase(repoPath, session, gitAdapter)
      return { status: 'completed', finalState: session.state }
    }

    const { job, state: stateWithActiveJob } = next

    // Update session with active job
    await updateSessionWithRetry(rebaseSessionStore, repoPath, () => ({
      state: stateWithActiveJob
    }))

    options.onJobStart?.(job)

    // Execute the job
    const result = await executeJob(repoPath, job, gitAdapter)

    if (result.status === 'conflict') {
      // Record conflict and pause
      const updatedJob = recordConflict({
        job,
        workingTree: await gitAdapter.getWorkingTreeStatus(repoPath),
        timestampMs: Date.now()
      })

      const conflictState = {
        ...stateWithActiveJob,
        session: { ...stateWithActiveJob.session, status: 'awaiting-user' as const },
        jobsById: { ...stateWithActiveJob.jobsById, [job.id]: updatedJob }
      }

      await updateSessionWithRetry(rebaseSessionStore, repoPath, () => ({
        state: conflictState
      }))

      options.onJobConflict?.(updatedJob, result.conflicts)

      return { status: 'conflict', job: updatedJob, conflicts: result.conflicts, state: conflictState }
    }

    if (result.status === 'error') {
      return { status: 'error', message: result.message, state: stateWithActiveJob }
    }

    // Job completed successfully
    const completionResult = completeJob({
      job,
      rebasedHeadSha: result.newHeadSha,
      timestampMs: Date.now(),
      rewrites: result.rewrites
    })

    // Find the node for this job to get children
    const node = findNodeByBranch(intent, job.branch)
    let newState: RebaseState = {
      ...stateWithActiveJob,
      session: {
        ...stateWithActiveJob.session,
        commitMap: [...stateWithActiveJob.session.commitMap, ...completionResult.commitRewrites]
      },
      jobsById: { ...stateWithActiveJob.jobsById, [job.id]: completionResult.job },
      queue: {
        ...stateWithActiveJob.queue,
        activeJobId: undefined
      }
    }

    // Enqueue child branches if any
    if (node && node.children.length > 0) {
      newState = enqueueDescendants({
        state: newState,
        parent: node,
        parentNewHeadSha: result.newHeadSha,
        timestampMs: Date.now(),
        generateJobId
      })
    }

    await updateSessionWithRetry(rebaseSessionStore, repoPath, () => ({
      state: newState
    }))

    options.onJobComplete?.(completionResult.job, result.newHeadSha)
  }
}

/**
 * Executes a single rebase job.
 */
async function executeJob(
  repoPath: string,
  job: RebaseJob,
  gitAdapter: GitAdapter
): Promise<JobExecutionResult> {
  if (!supportsRebase(gitAdapter)) {
    return { status: 'error', message: 'Git adapter does not support rebase' }
  }

  try {
    // Record commits before rebase for tracking rewrites
    const commitsBefore = await getCommitsInRange(
      repoPath,
      job.originalBaseSha,
      job.originalHeadSha,
      gitAdapter
    )

    // Checkout the branch to rebase
    await gitAdapter.checkout(repoPath, job.branch)

    // Execute rebase
    const result = await gitAdapter.rebase(repoPath, {
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

    // Get new head SHA
    const newHeadSha = await gitAdapter.resolveRef(repoPath, job.branch)

    // Build commit rewrites by comparing before/after
    const commitsAfter = await getCommitsInRange(
      repoPath,
      job.targetBaseSha,
      newHeadSha,
      gitAdapter
    )

    const rewrites = buildCommitRewrites(job.branch, commitsBefore, commitsAfter)

    return { status: 'completed', newHeadSha, rewrites }
  } catch (error) {
    return {
      status: 'error',
      message: `Rebase failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Completes the current job after a successful continue.
 */
async function completeCurrentJob(
  repoPath: string,
  session: StoredRebaseSession,
  newHeadSha: string
): Promise<void> {
  const activeJobId = session.state.queue.activeJobId
  if (!activeJobId) return

  const activeJob = session.state.jobsById[activeJobId]
  if (!activeJob) return

  const completionResult = completeJob({
    job: activeJob,
    rebasedHeadSha: newHeadSha,
    timestampMs: Date.now(),
    rewrites: [] // Rewrites already tracked
  })

  const newState: RebaseState = {
    ...session.state,
    jobsById: { ...session.state.jobsById, [activeJob.id]: completionResult.job },
    queue: {
      ...session.state.queue,
      activeJobId: undefined
    }
  }

  await updateSessionWithRetry(rebaseSessionStore, repoPath, () => ({
    state: newState
  }))
}

/**
 * Finalizes a rebase after all jobs complete.
 */
async function finalizeRebase(
  repoPath: string,
  session: StoredRebaseSession,
  gitAdapter: GitAdapter
): Promise<void> {
  // Try to restore original branch if it still exists
  try {
    await gitAdapter.checkout(repoPath, session.originalBranch)
  } catch {
    // Original branch might not exist anymore, that's ok
  }

  // Mark session complete
  const finalState: RebaseState = {
    ...session.state,
    session: {
      ...session.state.session,
      status: 'completed',
      completedAtMs: Date.now()
    }
  }

  await updateSessionWithRetry(rebaseSessionStore, repoPath, () => ({
    state: finalState
  }))

  // Clear session
  await rebaseSessionStore.clearSession(repoPath)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets commits in a range from Git.
 */
async function getCommitsInRange(
  repoPath: string,
  baseSha: string,
  headSha: string,
  gitAdapter: GitAdapter
): Promise<Commit[]> {
  // Use git log to get commits from base (exclusive) to head (inclusive)
  const commits = await gitAdapter.log(repoPath, headSha, { depth: 100 })

  // Filter to just the range
  const result: Commit[] = []
  for (const commit of commits) {
    if (commit.sha === baseSha) break
    result.push(commit)
  }

  return result.reverse() // Return oldest to newest
}

/**
 * Builds commit rewrite mappings by matching commits before and after rebase.
 * Assumes commits maintain their order during rebase.
 */
function buildCommitRewrites(
  branch: string,
  before: Commit[],
  after: Commit[]
): CommitRewrite[] {
  const rewrites: CommitRewrite[] = []

  // Match by position (rebased commits maintain order)
  const minLength = Math.min(before.length, after.length)
  for (let i = 0; i < minLength; i++) {
    const oldCommit = before[i]
    const newCommit = after[i]
    if (oldCommit && newCommit && oldCommit.sha !== newCommit.sha) {
      rewrites.push({
        branch,
        oldSha: oldCommit.sha,
        newSha: newCommit.sha
      })
    }
  }

  return rewrites
}

/**
 * Creates a job ID generator.
 */
function createJobIdGenerator(): () => string {
  let counter = 0
  return () => {
    counter++
    return `job-${Date.now()}-${counter}`
  }
}

/**
 * Creates a minimal RebaseState for recovery scenarios.
 */
function createMinimalState(): RebaseState {
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
    queue: {
      pendingJobIds: [],
      blockedJobIds: []
    }
  }
}

/**
 * Creates a recovery job for cases where we lost track.
 */
function createRecoveryJob(): RebaseJob {
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
