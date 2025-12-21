/**
 * Rebase State Machine
 *
 * Pure state machine for managing rebase operations.
 * Contains only pure functions that transform state - no I/O.
 *
 * This module provides immutable state transitions for:
 * - Creating rebase plans and sessions
 * - Managing the job queue (next job, enqueue descendants)
 * - Recording conflicts and completions
 * - Resuming sessions from Git state
 */

import type {
  BranchStatus,
  CompleteJobParams,
  CompleteJobResult,
  ConflictFile,
  CreateRebasePlanParams,
  EnqueueDescendantsParams,
  NextJobResult,
  RebaseJob,
  RebaseJobId,
  RebasePlan,
  RebaseQueueState,
  RebaseSession,
  RebaseState,
  RecordConflictParams,
  ResumeRebaseSessionParams,
  StackMutation,
  StartRebaseSessionParams
} from '@shared/types'
import type { WorkingTreeStatus } from '@shared/types/repo'

/**
 * Pure state machine for rebase operations.
 * All methods are static and produce new state without side effects.
 */
export class RebaseStateMachine {
  private constructor() {
    // Static-only class
  }

  /**
   * Creates a complete rebase plan from an intent.
   * The plan includes the initial session state ready for execution.
   */
  static createRebasePlan({ repo, intent, generateJobId }: CreateRebasePlanParams): RebasePlan {
    if (intent.targets.length === 0) {
      throw new Error('Cannot create rebase plan without targets')
    }

    const state = RebaseStateMachine.createRebaseSession({
      sessionId: intent.id,
      repo,
      targets: intent.targets,
      startedAtMs: intent.createdAtMs,
      generateJobId
    })

    return {
      intent,
      state
    }
  }

  /**
   * Creates a new rebase session from targets.
   * Initializes all jobs as 'queued' and sets up the processing queue.
   */
  static createRebaseSession({
    sessionId,
    repo,
    targets,
    startedAtMs,
    generateJobId
  }: StartRebaseSessionParams): RebaseState {
    if (!targets.length) {
      throw new Error('Cannot create rebase session without targets')
    }

    const trunk = repo.branches.find((branch) => branch.isTrunk && !branch.isRemote)
    if (!trunk) {
      throw new Error('Unable to determine trunk branch')
    }

    const jobsById: Record<RebaseJobId, RebaseJob> = {}
    const pendingJobIds: RebaseJobId[] = []

    for (const target of targets) {
      const jobId = generateJobId()
      const job: RebaseJob = {
        id: jobId,
        branch: target.node.branch,
        originalBaseSha: target.node.baseSha,
        originalHeadSha: target.node.headSha,
        targetBaseSha: target.targetBaseSha,
        status: 'queued',
        createdAtMs: startedAtMs
      }
      jobsById[jobId] = job
      pendingJobIds.push(jobId)
    }

    const session: RebaseSession = {
      id: sessionId,
      startedAtMs,
      status: 'pending',
      initialTrunkSha: trunk.headSha,
      jobs: [...pendingJobIds],
      commitMap: []
    }

    const queue: RebaseQueueState = {
      activeJobId: undefined,
      pendingJobIds
    }

    return {
      session,
      jobsById,
      queue
    }
  }

  /**
   * Resumes a rebase session by reconciling with current Git state.
   * Updates job statuses based on whether Git is still rebasing and conflict state.
   */
  static resumeRebaseSession({
    state,
    workingTree,
    timestampMs
  }: ResumeRebaseSessionParams): RebaseState {
    const session = { ...state.session }
    const jobsById = { ...state.jobsById }
    const queue: RebaseQueueState = {
      activeJobId: state.queue.activeJobId,
      pendingJobIds: [...state.queue.pendingJobIds]
    }

    if (queue.activeJobId) {
      const existingActiveJob = jobsById[queue.activeJobId]
      if (existingActiveJob) {
        const activeJob = { ...existingActiveJob }
        if (workingTree.isRebasing) {
          activeJob.status = workingTree.conflicted.length ? 'awaiting-user' : 'applying'
          activeJob.updatedAtMs = timestampMs
        } else {
          activeJob.status = 'completed'
          activeJob.updatedAtMs = timestampMs
          queue.activeJobId = undefined
        }
        jobsById[activeJob.id] = activeJob
      }
    } else if (workingTree.isRebasing && state.session.status === 'pending') {
      // Git reports a rebase in progress but we have not marked an active job.
      session.status = workingTree.conflicted.length ? 'awaiting-user' : 'running'
    }

    if (workingTree.conflicted.length) {
      session.status = 'awaiting-user'
    } else if (queue.activeJobId) {
      session.status = 'running'
    } else if (!queue.pendingJobIds.length) {
      session.status = 'completed'
      session.completedAtMs = session.completedAtMs ?? timestampMs
    } else if (session.status === 'completed') {
      session.status = 'pending'
    }

    return {
      session,
      jobsById,
      queue
    }
  }

  /**
   * Enqueues child branches to be rebased after their parent completes.
   * Used to cascade rebases through a branch stack.
   */
  static enqueueDescendants({
    state,
    parent,
    parentNewHeadSha,
    timestampMs,
    generateJobId
  }: EnqueueDescendantsParams): RebaseState {
    if (!parent.children.length) {
      return state
    }

    const session = {
      ...state.session,
      jobs: [...state.session.jobs]
    }
    const jobsById = { ...state.jobsById }
    const queue: RebaseQueueState = {
      activeJobId: state.queue.activeJobId,
      pendingJobIds: [...state.queue.pendingJobIds]
    }

    for (const child of parent.children) {
      const jobId = generateJobId()
      const job: RebaseJob = {
        id: jobId,
        branch: child.branch,
        originalBaseSha: child.baseSha,
        originalHeadSha: child.headSha,
        targetBaseSha: parentNewHeadSha,
        status: 'queued',
        createdAtMs: timestampMs
      }
      jobsById[jobId] = job
      queue.pendingJobIds.push(jobId)
      session.jobs.push(jobId)
    }

    return {
      session,
      jobsById,
      queue
    }
  }

  /**
   * Gets the next job from the queue and marks it as active.
   * Returns null if there's already an active job or no pending jobs.
   */
  static nextJob(state: RebaseState, timestampMs: number): NextJobResult {
    if (state.queue.activeJobId || !state.queue.pendingJobIds.length) {
      return null
    }

    const nextJobId = state.queue.pendingJobIds[0]
    if (!nextJobId) {
      return null
    }
    const ensuredJobId: RebaseJobId = nextJobId
    const rest = state.queue.pendingJobIds.slice(1)
    const nextJobEntry = state.jobsById[ensuredJobId]
    if (!nextJobEntry) {
      return null
    }
    const job: RebaseJob = {
      ...nextJobEntry,
      status: 'applying',
      updatedAtMs: timestampMs
    }
    const queue: RebaseQueueState = {
      activeJobId: ensuredJobId,
      pendingJobIds: rest
    }
    const session: RebaseSession = {
      ...state.session,
      status: 'running'
    }
    const jobsById = {
      ...state.jobsById,
      [ensuredJobId]: job
    }

    return {
      job,
      state: {
        session,
        jobsById,
        queue
      }
    }
  }

  /**
   * Records a conflict on a job, marking it as awaiting user resolution.
   */
  static recordConflict({
    job,
    workingTree,
    timestampMs,
    stageInfo = {}
  }: RecordConflictParams): RebaseJob {
    const conflicts: ConflictFile[] = workingTree.conflicted.map((path) => ({
      path,
      stages: stageInfo[path] ?? {},
      resolved: false
    }))

    return {
      ...job,
      status: 'awaiting-user',
      conflicts,
      updatedAtMs: timestampMs
    }
  }

  /**
   * Completes a job with the rebased head SHA.
   * Returns the updated job along with stack mutations and commit rewrites.
   */
  static completeJob({
    job,
    rebasedHeadSha,
    timestampMs,
    rewrites
  }: CompleteJobParams): CompleteJobResult {
    const updatedJob: RebaseJob = {
      ...job,
      status: 'completed',
      rebasedHeadSha,
      updatedAtMs: timestampMs
    }

    const stackMutations: StackMutation[] = [
      {
        branch: job.branch,
        newBaseSha: job.targetBaseSha,
        newHeadSha: rebasedHeadSha
      }
    ]

    return {
      job: updatedJob,
      stackMutations,
      commitRewrites: rewrites
    }
  }

  /**
   * Decorates working tree status with rebase session information.
   * Used to provide UI with combined status information.
   */
  static decorateWorkingTreeStatus(status: WorkingTreeStatus, state?: RebaseState): BranchStatus {
    if (!state) {
      return {
        ...status,
        operation: 'idle'
      }
    }

    const activeJob = state.queue.activeJobId ? state.jobsById[state.queue.activeJobId] : undefined
    const operation =
      state.session.status === 'pending' || state.session.status === 'completed'
        ? 'idle'
        : 'rebasing'
    const conflictedBranch =
      state.session.status === 'awaiting-user' && activeJob ? activeJob.branch : undefined

    return {
      ...status,
      operation,
      rebaseSessionId: state.session.id,
      conflictedBranch
    }
  }
}
