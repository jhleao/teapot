import type { WorktreeConflict } from './rebase'

export type SquashPreview = {
  canSquash: boolean
  error?: SquashBlocker
  errorDetail?: string
  targetBranch?: string
  parentBranch?: string
  descendantBranches?: string[]
  isEmpty?: boolean
  hasPr?: boolean
  prNumber?: number
  parentCommitMessage?: string
  commitMessage?: string
  commitAuthor?: string
  /** Info about branch name collision when squashing */
  branchCollision?: {
    /** The branch that already exists on parent commit */
    existingBranch: string
    /** The branch being squashed (child) */
    childBranch: string
  }
  /** Worktrees that block the squash operation */
  worktreeConflicts?: WorktreeConflict[]
}

export type SquashResult = {
  success: boolean
  error?: SquashBlocker
  errorDetail?: string
  conflicts?: string[]
  modifiedBranches?: string[]
  deletedBranch?: string
  localSuccess?: boolean
  /** The branch that was preserved (moved to result commit) */
  preservedBranch?: string
  /** Worktrees that blocked the squash operation */
  worktreeConflicts?: WorktreeConflict[]
}

export type SquashBlocker =
  | 'no_parent'
  | 'not_linear'
  | 'ancestry_mismatch'
  | 'dirty_tree'
  | 'rebase_in_progress'
  | 'parent_is_trunk'
  | 'is_trunk'
  | 'conflict'
  | 'descendant_conflict'
  | 'push_failed'
  | 'worktree_conflict'

/** User's choice for handling branch name collision during squash */
export type BranchChoice = 'parent' | 'child' | 'both' | string

/**
 * Detailed error information for squash operations.
 * Provides richer context than the simple SquashBlocker string.
 */
export type SquashError =
  // Pre-validation errors (user can fix)
  | { code: 'dirty_worktree'; worktreePath: string; changedFiles?: string[] }
  | { code: 'branch_in_use'; branch: string; worktreePath: string }
  | { code: 'rebase_in_progress' }
  | { code: 'parent_is_trunk'; parentBranch: string }
  | { code: 'is_trunk'; branch: string }
  | { code: 'not_linear'; siblingBranches: string[] }
  | { code: 'no_parent'; branch: string }
  // Execution errors (may be recoverable)
  | { code: 'patch_conflict'; conflicts: string[]; targetBranch: string }
  | { code: 'descendant_conflict'; branch: string; conflicts: string[] }
  | { code: 'worktree_conflict'; conflicts: WorktreeConflict[] }
  // System errors (need investigation)
  | { code: 'git_error'; command: string; stderr: string }
  | { code: 'worktree_creation_failed'; attempts: number; lastError: string }
  // Invariant violations (bugs)
  | { code: 'branch_moved_unexpectedly'; branch: string; expected: string; actual: string }
  | { code: 'ancestry_mismatch'; message: string }

/**
 * Get a human-readable message for a squash error.
 */
export function getSquashErrorMessage(error: SquashError): string {
  switch (error.code) {
    case 'dirty_worktree':
      return `Worktree at ${error.worktreePath} has uncommitted changes`
    case 'branch_in_use':
      return `Branch ${error.branch} is checked out in worktree at ${error.worktreePath}`
    case 'rebase_in_progress':
      return 'Another rebase operation is already in progress'
    case 'parent_is_trunk':
      return `Cannot squash into trunk branch ${error.parentBranch}`
    case 'is_trunk':
      return `Cannot squash trunk branch ${error.branch}`
    case 'not_linear':
      return `Branch has multiple children: ${error.siblingBranches.join(', ')}`
    case 'no_parent':
      return `Branch ${error.branch} has no parent branch`
    case 'patch_conflict':
      return `Conflict when applying changes to ${error.targetBranch}: ${error.conflicts.join(', ')}`
    case 'descendant_conflict':
      return `Conflict when rebasing ${error.branch}: ${error.conflicts.join(', ')}`
    case 'worktree_conflict':
      return `Branches are checked out in other worktrees`
    case 'git_error':
      return `Git command failed: ${error.command}`
    case 'worktree_creation_failed':
      return `Failed to create worktree after ${error.attempts} attempts: ${error.lastError}`
    case 'branch_moved_unexpectedly':
      return `Branch ${error.branch} was modified externally. Expected ${error.expected}, got ${error.actual}`
    case 'ancestry_mismatch':
      return error.message
  }
}
