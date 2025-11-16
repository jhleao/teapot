import type { Repo, WorkingTreeStatus } from '../../shared/types/git.js'

export type RebaseSessionStatus = 'pending' | 'running' | 'awaiting-user' | 'aborted' | 'completed'

export type RebaseJobStatus = 'queued' | 'applying' | 'awaiting-user' | 'completed' | 'failed'

export type RebaseJobId = string

export type RebaseSession = {
  id: string
  startedAtMs: number
  completedAtMs?: number
  status: RebaseSessionStatus
  /** Trunk SHA before any rewrites start. */
  initialTrunkSha: string
  /** Final trunk SHA after the entire stack successfully replays. */
  finalTrunkSha?: string
  jobs: RebaseJobId[]
  /** Map of every rewritten commit so the UI can reconcile stack nodes. */
  commitMap: CommitRewrite[]
}

export type RebaseJob = {
  id: RebaseJobId
  branch: string
  originalBaseSha: string
  originalHeadSha: string
  targetBaseSha: string
  status: RebaseJobStatus
  createdAtMs: number
  updatedAtMs?: number
  rebasedHeadSha?: string
  conflicts?: ConflictFile[]
}

export type ConflictFile = {
  path: string
  stages: ConflictStages
  resolved: boolean
}

export type ConflictStages = {
  oursSha?: string
  theirsSha?: string
  baseSha?: string
}

export type RebaseQueueState = {
  activeJobId?: RebaseJobId
  pendingJobIds: RebaseJobId[]
  blockedJobIds: RebaseJobId[]
}

export type RebaseIntent = {
  id: string
  createdAtMs: number
  targets: RebaseTarget[]
}

export type CommitRewrite = {
  branch: string
  oldSha: string
  newSha: string
}

export type StackMutation = {
  branch: string
  newBaseSha: string
  newHeadSha: string
}

export type StackNodeState = {
  branch: string
  headSha: string
  baseSha: string
  children: StackNodeState[]
}

export type BranchStatus = WorkingTreeStatus & {
  rebaseSessionId?: string
  operation: 'idle' | 'rebasing'
  conflictedBranch?: string
}

export type RebaseTarget = {
  node: StackNodeState
  targetBaseSha: string
}

export type RebaseState = {
  session: RebaseSession
  jobsById: Record<RebaseJobId, RebaseJob>
  queue: RebaseQueueState
}

export type RebasePlan = {
  intent: RebaseIntent
  state: RebaseState
}

export type StartRebaseSessionParams = {
  sessionId: string
  repo: Repo
  targets: RebaseTarget[]
  startedAtMs: number
  generateJobId: () => RebaseJobId
}

export type ResumeRebaseSessionParams = {
  state: RebaseState
  workingTree: WorkingTreeStatus
  timestampMs: number
}

export type EnqueueDescendantsParams = {
  state: RebaseState
  parent: StackNodeState
  parentNewHeadSha: string
  timestampMs: number
  generateJobId: () => RebaseJobId
}

export type NextJobResult = {
  job: RebaseJob
  state: RebaseState
} | null

export type RecordConflictParams = {
  job: RebaseJob
  workingTree: WorkingTreeStatus
  timestampMs: number
  stageInfo?: Record<string, ConflictStages>
}

export type CompleteJobParams = {
  job: RebaseJob
  rebasedHeadSha: string
  timestampMs: number
  rewrites: CommitRewrite[]
}

export type CompleteJobResult = {
  job: RebaseJob
  stackMutations: StackMutation[]
  commitRewrites: CommitRewrite[]
}

export type CreateRebasePlanParams = {
  repo: Repo
  intent: RebaseIntent
  generateJobId: () => RebaseJobId
}

export type RebaseProjection =
  | {
      kind: 'idle'
    }
  | {
      kind: 'planning'
      plan: RebasePlan
    }
  | {
      kind: 'rebasing'
      session: RebaseState
    }

export const createRebasePlan = ({
  repo,
  intent,
  generateJobId
}: CreateRebasePlanParams): RebasePlan => {
  if (intent.targets.length === 0) {
    throw new Error('Cannot create rebase plan without targets')
  }

  const state = createRebaseSession({
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

export const createRebaseSession = ({
  sessionId,
  repo,
  targets,
  startedAtMs,
  generateJobId
}: StartRebaseSessionParams): RebaseState => {
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
    pendingJobIds,
    blockedJobIds: []
  }

  return {
    session,
    jobsById,
    queue
  }
}

export const resumeRebaseSession = ({
  state,
  workingTree,
  timestampMs
}: ResumeRebaseSessionParams): RebaseState => {
  const session = { ...state.session }
  const jobsById = { ...state.jobsById }
  const queue: RebaseQueueState = {
    activeJobId: state.queue.activeJobId,
    pendingJobIds: [...state.queue.pendingJobIds],
    blockedJobIds: [...state.queue.blockedJobIds]
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
  } else if (!queue.pendingJobIds.length && !queue.blockedJobIds.length) {
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

export const enqueueDescendants = ({
  state,
  parent,
  parentNewHeadSha,
  timestampMs,
  generateJobId
}: EnqueueDescendantsParams): RebaseState => {
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
    pendingJobIds: [...state.queue.pendingJobIds],
    blockedJobIds: [...state.queue.blockedJobIds]
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

export const nextJob = (state: RebaseState, timestampMs: number): NextJobResult => {
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
    pendingJobIds: rest,
    blockedJobIds: [...state.queue.blockedJobIds]
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

export const recordConflict = ({
  job,
  workingTree,
  timestampMs,
  stageInfo = {}
}: RecordConflictParams): RebaseJob => {
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

export const completeJob = ({
  job,
  rebasedHeadSha,
  timestampMs,
  rewrites
}: CompleteJobParams): CompleteJobResult => {
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

export const decorateWorkingTreeStatus = (
  status: WorkingTreeStatus,
  state?: RebaseState
): BranchStatus => {
  if (!state) {
    return {
      ...status,
      operation: 'idle'
    }
  }

  const activeJob = state.queue.activeJobId ? state.jobsById[state.queue.activeJobId] : undefined
  const operation =
    state.session.status === 'pending' || state.session.status === 'completed' ? 'idle' : 'rebasing'
  const conflictedBranch =
    state.session.status === 'awaiting-user' && activeJob ? activeJob.branch : undefined

  return {
    ...status,
    operation,
    rebaseSessionId: state.session.id,
    conflictedBranch
  }
}
