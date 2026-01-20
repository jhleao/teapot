/**
 * Rebase Types
 *
 * Pure type definitions for the rebase state machine.
 * These types describe the state of a rebase session, jobs, and intents.
 */

import type { Repo, WorkingTreeStatus } from './repo'

// ============================================================================
// Status Types
// ============================================================================

export type RebaseSessionStatus = 'pending' | 'running' | 'awaiting-user' | 'aborted' | 'completed'

export type RebaseJobStatus = 'queued' | 'applying' | 'awaiting-user' | 'completed' | 'failed'

export type RebaseJobId = string

// ============================================================================
// Session and Job Types
// ============================================================================

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

// ============================================================================
// Conflict Types
// ============================================================================

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

// ============================================================================
// Queue Types
// ============================================================================

export type RebaseQueueState = {
  activeJobId?: RebaseJobId
  pendingJobIds: RebaseJobId[]
}

// ============================================================================
// Intent and Target Types
// ============================================================================

export type RebaseIntent = {
  id: string
  createdAtMs: number
  targets: RebaseTarget[]
}

export type RebaseTarget = {
  node: StackNodeState
  targetBaseSha: string
}

export type StackNodeState = {
  branch: string
  headSha: string
  baseSha: string
  /** All commit SHAs owned by this branch (head first, oldest last). */
  ownedShas: string[]
  children: StackNodeState[]
}

// ============================================================================
// State Types
// ============================================================================

export type RebaseState = {
  session: RebaseSession
  jobsById: Record<RebaseJobId, RebaseJob>
  queue: RebaseQueueState
}

export type DetachedWorktree = {
  worktreePath: string
  branch: string
}

export type RebasePlan = {
  intent: RebaseIntent
  state: RebaseState
}

// ============================================================================
// Mutation Types
// ============================================================================

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

// ============================================================================
// Branch Status Type
// ============================================================================

export type BranchStatus = WorkingTreeStatus & {
  rebaseSessionId?: string
  operation: 'idle' | 'rebasing'
  conflictedBranch?: string
}

// ============================================================================
// Parameter Types for State Machine Functions
// ============================================================================

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

export type CreateRebasePlanParams = {
  repo: Repo
  intent: RebaseIntent
  generateJobId: () => RebaseJobId
}

// ============================================================================
// Result Types
// ============================================================================

export type NextJobResult = {
  job: RebaseJob
  state: RebaseState
} | null

export type CompleteJobResult = {
  job: RebaseJob
  stackMutations: StackMutation[]
  commitRewrites: CommitRewrite[]
}

// ============================================================================
// Projection Type
// ============================================================================

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

// ============================================================================
// Worktree Conflict Types (for rebase operations)
// ============================================================================

/**
 * Represents a worktree that blocks a rebase operation.
 * A rebase cannot update a branch that's checked out in another worktree.
 */
export type WorktreeConflict = {
  /** The branch that would be rebased but is checked out elsewhere */
  branch: string
  /** Path to the worktree where the branch is checked out */
  worktreePath: string
  /** Whether the worktree has uncommitted changes */
  isDirty: boolean
}
