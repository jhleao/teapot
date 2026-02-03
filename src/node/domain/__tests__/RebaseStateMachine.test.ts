/**
 * RebaseStateMachine Tests
 *
 * Tests for the pure state machine that manages rebase operations.
 * All functions are pure - no I/O or mocks needed.
 */

import type {
  Branch,
  Commit,
  RebaseJob,
  RebaseJobId,
  RebaseState,
  RebaseTarget,
  Repo,
  StackNodeState,
  WorkingTreeStatus
} from '@shared/types'
import { describe, expect, it } from 'vitest'
import { RebaseStateMachine } from '../RebaseStateMachine'

describe('RebaseStateMachine', () => {
  describe('createRebasePlan', () => {
    it('creates a plan from a valid intent', () => {
      const repo = createRepo({
        commits: [createCommit('A', ''), createCommit('B', 'A')],
        branches: [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'B')]
      })
      const intent = createIntent([createTarget('feature', 'B', 'A', 'A')])

      const plan = RebaseStateMachine.createRebasePlan({
        repo,
        intent,
        generateJobId: createJobIdGenerator()
      })

      expect(plan.intent).toBe(intent)
      expect(plan.state.session.id).toBe(intent.id)
      expect(plan.state.session.status).toBe('pending')
      expect(plan.state.queue.pendingJobIds).toHaveLength(1)
    })

    it('throws when intent has no targets', () => {
      const repo = createRepo({
        commits: [createCommit('A', '')],
        branches: [createBranch('main', 'A', { isTrunk: true })]
      })
      const intent = createIntent([])

      expect(() =>
        RebaseStateMachine.createRebasePlan({
          repo,
          intent,
          generateJobId: createJobIdGenerator()
        })
      ).toThrow('Cannot create rebase plan without targets')
    })
  })

  describe('createRebaseSession', () => {
    it('creates session with correct initial state', () => {
      const repo = createRepo({
        commits: [createCommit('A', ''), createCommit('B', 'A')],
        branches: [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'B')]
      })
      const targets = [createTarget('feature', 'B', 'A', 'A')]

      const state = RebaseStateMachine.createRebaseSession({
        sessionId: 'test-session',
        repo,
        targets,
        startedAtMs: 1000,
        generateJobId: createJobIdGenerator()
      })

      expect(state.session.id).toBe('test-session')
      expect(state.session.status).toBe('pending')
      expect(state.session.startedAtMs).toBe(1000)
      expect(state.session.initialTrunkSha).toBe('A')
      expect(state.session.jobs).toHaveLength(1)
      expect(state.queue.activeJobId).toBeUndefined()
      expect(state.queue.pendingJobIds).toHaveLength(1)
    })

    it('creates jobs for each target', () => {
      const repo = createRepo({
        commits: [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')],
        branches: [
          createBranch('main', 'A', { isTrunk: true }),
          createBranch('feature-1', 'B'),
          createBranch('feature-2', 'C')
        ]
      })
      const targets = [
        createTarget('feature-1', 'B', 'A', 'A'),
        createTarget('feature-2', 'C', 'B', 'B')
      ]

      const state = RebaseStateMachine.createRebaseSession({
        sessionId: 'test-session',
        repo,
        targets,
        startedAtMs: 1000,
        generateJobId: createJobIdGenerator()
      })

      expect(Object.keys(state.jobsById)).toHaveLength(2)
      expect(state.queue.pendingJobIds).toHaveLength(2)

      const job1 = state.jobsById[state.queue.pendingJobIds[0]!]
      expect(job1?.branch).toBe('feature-1')
      expect(job1?.status).toBe('queued')
      expect(job1?.originalBaseSha).toBe('A')
      expect(job1?.originalHeadSha).toBe('B')
    })

    it('throws when no trunk branch found', () => {
      const repo = createRepo({
        commits: [createCommit('A', '')],
        branches: [createBranch('feature', 'A')] // No trunk
      })

      expect(() =>
        RebaseStateMachine.createRebaseSession({
          sessionId: 'test',
          repo,
          targets: [createTarget('feature', 'A', '', 'X')],
          startedAtMs: 1000,
          generateJobId: createJobIdGenerator()
        })
      ).toThrow('Unable to determine trunk branch')
    })

    it('throws when no targets provided', () => {
      const repo = createRepo({
        commits: [createCommit('A', '')],
        branches: [createBranch('main', 'A', { isTrunk: true })]
      })

      expect(() =>
        RebaseStateMachine.createRebaseSession({
          sessionId: 'test',
          repo,
          targets: [],
          startedAtMs: 1000,
          generateJobId: createJobIdGenerator()
        })
      ).toThrow('Cannot create rebase session without targets')
    })
  })

  describe('nextJob', () => {
    it('returns first pending job and marks it active', () => {
      const state = createStateWithJobs(['job-1', 'job-2'], { status: 'pending' })

      const result = RebaseStateMachine.nextJob(state, 2000)

      expect(result).not.toBeNull()
      expect(result!.job.id).toBe('job-1')
      expect(result!.job.status).toBe('applying')
      expect(result!.job.updatedAtMs).toBe(2000)
      expect(result!.state.queue.activeJobId).toBe('job-1')
      expect(result!.state.queue.pendingJobIds).toEqual(['job-2'])
      expect(result!.state.session.status).toBe('running')
    })

    it('returns null when there is already an active job', () => {
      const state = createStateWithJobs(['job-1', 'job-2'], {
        status: 'running',
        activeJobId: 'job-1'
      })

      const result = RebaseStateMachine.nextJob(state, 2000)

      expect(result).toBeNull()
    })

    it('returns null when no pending jobs remain', () => {
      const state = createStateWithJobs([], { status: 'pending' })

      const result = RebaseStateMachine.nextJob(state, 2000)

      expect(result).toBeNull()
    })

    it('does not mutate original state', () => {
      const state = createStateWithJobs(['job-1'], { status: 'pending' })
      const originalPendingIds = [...state.queue.pendingJobIds]

      RebaseStateMachine.nextJob(state, 2000)

      expect(state.queue.pendingJobIds).toEqual(originalPendingIds)
      expect(state.queue.activeJobId).toBeUndefined()
    })
  })

  describe('recordConflict', () => {
    it('marks job as awaiting-user with conflict info', () => {
      const job = createJob('job-1', 'feature', { status: 'applying' })
      const workingTree = createWorkingTreeStatus({
        isRebasing: true,
        conflicted: ['file1.ts', 'file2.ts']
      })

      const result = RebaseStateMachine.recordConflict({
        job,
        workingTree,
        timestampMs: 3000,
        stageInfo: {
          'file1.ts': { oursSha: 'abc', theirsSha: 'def' }
        }
      })

      expect(result.status).toBe('awaiting-user')
      expect(result.updatedAtMs).toBe(3000)
      expect(result.conflicts).toHaveLength(2)
      expect(result.conflicts![0]!.path).toBe('file1.ts')
      expect(result.conflicts![0]!.stages.oursSha).toBe('abc')
      expect(result.conflicts![1]!.path).toBe('file2.ts')
      expect(result.conflicts![1]!.resolved).toBe(false)
    })

    it('does not mutate original job', () => {
      const job = createJob('job-1', 'feature', { status: 'applying' })
      const workingTree = createWorkingTreeStatus({
        isRebasing: true,
        conflicted: ['file.ts']
      })

      const result = RebaseStateMachine.recordConflict({
        job,
        workingTree,
        timestampMs: 3000
      })

      expect(job.status).toBe('applying')
      expect(result.status).toBe('awaiting-user')
    })
  })

  describe('completeJob', () => {
    it('marks job as completed with rebased SHA', () => {
      const job = createJob('job-1', 'feature', { status: 'applying' })

      const result = RebaseStateMachine.completeJob({
        job,
        rebasedHeadSha: 'new-sha',
        timestampMs: 4000,
        rewrites: [{ branch: 'feature', oldSha: 'old', newSha: 'new-sha' }]
      })

      expect(result.job.status).toBe('completed')
      expect(result.job.rebasedHeadSha).toBe('new-sha')
      expect(result.job.updatedAtMs).toBe(4000)
    })

    it('returns stack mutations for branch update', () => {
      const job = createJob('job-1', 'feature', {
        status: 'applying',
        targetBaseSha: 'target-base'
      })

      const result = RebaseStateMachine.completeJob({
        job,
        rebasedHeadSha: 'new-sha',
        timestampMs: 4000,
        rewrites: []
      })

      expect(result.stackMutations).toHaveLength(1)
      expect(result.stackMutations[0]!.branch).toBe('feature')
      expect(result.stackMutations[0]!.newBaseSha).toBe('target-base')
      expect(result.stackMutations[0]!.newHeadSha).toBe('new-sha')
    })

    it('passes through commit rewrites', () => {
      const job = createJob('job-1', 'feature', { status: 'applying' })
      const rewrites = [
        { branch: 'feature', oldSha: 'old1', newSha: 'new1' },
        { branch: 'feature', oldSha: 'old2', newSha: 'new2' }
      ]

      const result = RebaseStateMachine.completeJob({
        job,
        rebasedHeadSha: 'new2',
        timestampMs: 4000,
        rewrites
      })

      expect(result.commitRewrites).toEqual(rewrites)
    })
  })

  describe('enqueueDescendants', () => {
    it('adds child branches to queue', () => {
      const state = createStateWithJobs(['job-1'], { status: 'running' })
      const parent = createStackNode('parent', 'parent-head', 'base', [
        createStackNode('child-1', 'child-1-head', 'parent-head', []),
        createStackNode('child-2', 'child-2-head', 'parent-head', [])
      ])

      const result = RebaseStateMachine.enqueueDescendants({
        state,
        parent,
        parentNewHeadSha: 'new-parent-head',
        timestampMs: 5000,
        generateJobId: createJobIdGenerator()
      })

      expect(result.queue.pendingJobIds).toHaveLength(3) // original + 2 children
      expect(result.session.jobs).toHaveLength(3)

      // Check new jobs were created with correct target base
      const newJobIds = result.queue.pendingJobIds.slice(1)
      for (const jobId of newJobIds) {
        const job = result.jobsById[jobId]
        expect(job?.targetBaseSha).toBe('new-parent-head')
        expect(job?.status).toBe('queued')
      }
    })

    it('returns unchanged state when no children', () => {
      const state = createStateWithJobs(['job-1'], { status: 'running' })
      const parent = createStackNode('parent', 'head', 'base', [])

      const result = RebaseStateMachine.enqueueDescendants({
        state,
        parent,
        parentNewHeadSha: 'new-head',
        timestampMs: 5000,
        generateJobId: createJobIdGenerator()
      })

      expect(result).toBe(state) // Same reference - no change
    })

    it('does not mutate original state', () => {
      const state = createStateWithJobs(['job-1'], { status: 'running' })
      const originalJobCount = Object.keys(state.jobsById).length
      const parent = createStackNode('parent', 'head', 'base', [
        createStackNode('child', 'child-head', 'head', [])
      ])

      RebaseStateMachine.enqueueDescendants({
        state,
        parent,
        parentNewHeadSha: 'new-head',
        timestampMs: 5000,
        generateJobId: createJobIdGenerator()
      })

      expect(Object.keys(state.jobsById).length).toBe(originalJobCount)
    })
  })

  describe('resumeRebaseSession', () => {
    it('marks active job as applying when rebase in progress without conflicts', () => {
      const state = createStateWithJobs(['job-1', 'job-2'], {
        status: 'running',
        activeJobId: 'job-1'
      })
      const workingTree = createWorkingTreeStatus({ isRebasing: true })

      const result = RebaseStateMachine.resumeRebaseSession({
        state,
        workingTree,
        timestampMs: 6000
      })

      expect(result.jobsById['job-1']?.status).toBe('applying')
      expect(result.session.status).toBe('running')
    })

    it('marks active job as awaiting-user when conflicts detected', () => {
      const state = createStateWithJobs(['job-1'], {
        status: 'running',
        activeJobId: 'job-1'
      })
      const workingTree = createWorkingTreeStatus({
        isRebasing: true,
        conflicted: ['file.ts']
      })

      const result = RebaseStateMachine.resumeRebaseSession({
        state,
        workingTree,
        timestampMs: 6000
      })

      expect(result.jobsById['job-1']?.status).toBe('awaiting-user')
      expect(result.session.status).toBe('awaiting-user')
    })

    it('marks job as completed when rebase finished', () => {
      const state = createStateWithJobs(['job-1'], {
        status: 'running',
        activeJobId: 'job-1'
      })
      const workingTree = createWorkingTreeStatus({ isRebasing: false })

      const result = RebaseStateMachine.resumeRebaseSession({
        state,
        workingTree,
        timestampMs: 6000
      })

      expect(result.jobsById['job-1']?.status).toBe('completed')
      expect(result.queue.activeJobId).toBeUndefined()
    })

    it('marks session as completed when no pending jobs and rebase finished', () => {
      const state = createStateWithJobs([], {
        status: 'running',
        activeJobId: undefined
      })
      const workingTree = createWorkingTreeStatus({ isRebasing: false })

      const result = RebaseStateMachine.resumeRebaseSession({
        state,
        workingTree,
        timestampMs: 6000
      })

      expect(result.session.status).toBe('completed')
      expect(result.session.completedAtMs).toBe(6000)
    })

    it('handles recovery from crash during pending state', () => {
      const state = createStateWithJobs(['job-1'], { status: 'pending' })
      const workingTree = createWorkingTreeStatus({
        isRebasing: true,
        conflicted: ['file.ts']
      })

      const result = RebaseStateMachine.resumeRebaseSession({
        state,
        workingTree,
        timestampMs: 6000
      })

      // Session should detect the rebase in progress
      expect(result.session.status).toBe('awaiting-user')
    })
  })

  describe('decorateWorkingTreeStatus', () => {
    it('returns idle status when no rebase state', () => {
      const status = createWorkingTreeStatus()

      const result = RebaseStateMachine.decorateWorkingTreeStatus(status, undefined)

      expect(result.operation).toBe('idle')
      expect(result.rebaseSessionId).toBeUndefined()
    })

    it('returns rebasing status with session info during active rebase', () => {
      const status = createWorkingTreeStatus({ isRebasing: true })
      const state = createStateWithJobs(['job-1'], {
        status: 'running',
        activeJobId: 'job-1'
      })
      state.session.id = 'session-123'
      state.jobsById['job-1']!.branch = 'feature'

      const result = RebaseStateMachine.decorateWorkingTreeStatus(status, state)

      expect(result.operation).toBe('rebasing')
      expect(result.rebaseSessionId).toBe('session-123')
    })

    it('includes conflicted branch when awaiting user', () => {
      const status = createWorkingTreeStatus({ isRebasing: true, conflicted: ['file.ts'] })
      const state = createStateWithJobs(['job-1'], {
        status: 'awaiting-user',
        activeJobId: 'job-1'
      })
      state.jobsById['job-1']!.branch = 'conflicted-branch'

      const result = RebaseStateMachine.decorateWorkingTreeStatus(status, state)

      expect(result.conflictedBranch).toBe('conflicted-branch')
    })

    it('returns idle when session is pending', () => {
      const status = createWorkingTreeStatus()
      const state = createStateWithJobs(['job-1'], { status: 'pending' })

      const result = RebaseStateMachine.decorateWorkingTreeStatus(status, state)

      expect(result.operation).toBe('idle')
    })

    it('returns idle when session is completed', () => {
      const status = createWorkingTreeStatus()
      const state = createStateWithJobs([], { status: 'completed' })

      const result = RebaseStateMachine.decorateWorkingTreeStatus(status, state)

      expect(result.operation).toBe('idle')
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

let jobIdCounter = 0

function createJobIdGenerator(): () => RebaseJobId {
  return () => `job-${++jobIdCounter}`
}

function createRepo(
  overrides: Partial<{
    commits: Commit[]
    branches: Branch[]
    workingTreeStatus: WorkingTreeStatus
  }> = {}
): Repo {
  return {
    path: '/test/repo',
    activeWorktreePath: null,
    commits: overrides.commits ?? [],
    branches: overrides.branches ?? [],
    workingTreeStatus: overrides.workingTreeStatus ?? createWorkingTreeStatus(),
    worktrees: []
  }
}

function createCommit(sha: string, parentSha: string): Commit {
  return {
    sha,
    parentSha,
    childrenSha: [],
    message: `Commit ${sha}`,
    timeMs: Date.now()
  }
}

function createBranch(
  ref: string,
  headSha: string,
  options: { isTrunk?: boolean; isRemote?: boolean } = {}
): Branch {
  return {
    ref,
    headSha,
    isTrunk: options.isTrunk ?? false,
    isRemote: options.isRemote ?? false
  }
}

function createWorkingTreeStatus(overrides: Partial<WorkingTreeStatus> = {}): WorkingTreeStatus {
  return {
    currentBranch: 'main',
    currentCommitSha: '',
    tracking: null,
    detached: false,
    isRebasing: false,
    staged: [],
    modified: [],
    created: [],
    deleted: [],
    renamed: [],
    not_added: [],
    conflicted: [],
    allChangedFiles: [],
    ...overrides
  }
}

function createIntent(targets: RebaseTarget[]) {
  return {
    id: `intent-${Date.now()}`,
    createdAtMs: Date.now(),
    targets
  }
}

function createTarget(
  branch: string,
  headSha: string,
  baseSha: string,
  targetBaseSha: string
): RebaseTarget {
  return {
    node: createStackNode(branch, headSha, baseSha, []),
    targetBaseSha
  }
}

function createStackNode(
  branch: string,
  headSha: string,
  baseSha: string,
  children: StackNodeState[]
): StackNodeState {
  return {
    branch,
    headSha,
    baseSha,
    ownedShas: [headSha],
    children
  }
}

function createJob(id: string, branch: string, overrides: Partial<RebaseJob> = {}): RebaseJob {
  return {
    id,
    branch,
    originalBaseSha: 'orig-base',
    originalHeadSha: 'orig-head',
    targetBaseSha: 'target-base',
    status: 'queued',
    createdAtMs: Date.now(),
    ...overrides
  }
}

function createStateWithJobs(
  jobIds: string[],
  options: {
    status?: 'pending' | 'running' | 'awaiting-user' | 'completed' | 'aborted'
    activeJobId?: string
  } = {}
): RebaseState {
  const jobsById: Record<string, RebaseJob> = {}
  const pendingJobIds: string[] = []

  for (const id of jobIds) {
    const isActive = id === options.activeJobId
    jobsById[id] = createJob(id, `branch-${id}`, {
      status: isActive ? 'applying' : 'queued'
    })
    if (!isActive) {
      pendingJobIds.push(id)
    }
  }

  return {
    session: {
      id: 'test-session',
      startedAtMs: Date.now(),
      status: options.status ?? 'pending',
      initialTrunkSha: 'trunk-sha',
      jobs: jobIds,
      commitMap: []
    },
    jobsById,
    queue: {
      activeJobId: options.activeJobId,
      pendingJobIds
    }
  }
}
