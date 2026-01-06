/**
 * Rebase Validator
 *
 * Pure validation logic for rebase operations.
 * Contains only synchronous validation functions that operate on data.
 *
 * For async validation that needs to fetch Git state, see the validation
 * helpers in the operations layer.
 */

import type { RebaseIntent, RebaseTarget, StackNodeState, WorktreeConflict } from '@shared/types'
import type { WorkingTreeStatus, Worktree } from '@shared/types/repo'

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Result of a validation check
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; code: ValidationErrorCode; message: string }

/**
 * Validation error codes for programmatic handling
 */
export type ValidationErrorCode =
  | 'DIRTY_WORKING_TREE'
  | 'REBASE_IN_PROGRESS'
  | 'SESSION_EXISTS'
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_MOVED'
  | 'TARGET_NOT_FOUND'
  | 'SAME_BASE'
  | 'INVALID_INTENT'
  | 'DETACHED_HEAD'
  | 'CONFLICTS_UNRESOLVED'
  | 'WORKTREE_CONFLICT'

/**
 * Extended validation result that includes worktree conflicts
 */
export type WorktreeValidationResult =
  | { valid: true }
  | { valid: false; code: 'WORKTREE_CONFLICT'; message: string; conflicts: WorktreeConflict[] }

// ============================================================================
// RebaseValidator Class
// ============================================================================

/**
 * Pure validator for rebase operations.
 * All methods are static and synchronous - they only examine data.
 */
export class RebaseValidator {
  private constructor() {
    // Static-only class
  }

  /**
   * Validates that an intent has valid structure.
   */
  static validateIntentStructure(intent: RebaseIntent): ValidationResult {
    if (!intent.targets.length) {
      return {
        valid: false,
        code: 'INVALID_INTENT',
        message: 'Rebase intent has no targets'
      }
    }
    return { valid: true }
  }

  /**
   * Validates that the working tree is clean (no uncommitted changes).
   */
  static validateCleanWorkingTree(status: WorkingTreeStatus): ValidationResult {
    const hasChanges =
      status.staged.length > 0 ||
      status.modified.length > 0 ||
      status.deleted.length > 0 ||
      status.conflicted.length > 0

    if (hasChanges) {
      const changedFiles = [
        ...status.staged,
        ...status.modified,
        ...status.deleted,
        ...status.conflicted
      ]
      return {
        valid: false,
        code: 'DIRTY_WORKING_TREE',
        message: `Working tree has uncommitted changes. Please commit or stash changes before rebasing. Changed files: ${changedFiles.slice(0, 3).join(', ')}${changedFiles.length > 3 ? ` and ${changedFiles.length - 3} more` : ''}`
      }
    }

    return { valid: true }
  }

  /**
   * Validates that no rebase is already in progress.
   */
  static validateNoRebaseInProgress(status: WorkingTreeStatus): ValidationResult {
    if (status.isRebasing) {
      return {
        valid: false,
        code: 'REBASE_IN_PROGRESS',
        message:
          'A rebase is already in progress. Please complete or abort it before starting a new one.'
      }
    }

    return { valid: true }
  }

  /**
   * Validates that HEAD is not detached.
   */
  static validateNotDetached(status: WorkingTreeStatus): ValidationResult {
    if (status.detached) {
      return {
        valid: false,
        code: 'DETACHED_HEAD',
        message: 'Cannot start rebase with detached HEAD. Please checkout a branch first.'
      }
    }

    return { valid: true }
  }

  /**
   * Validates that a branch has not moved since intent creation.
   */
  static validateBranchNotMoved(target: RebaseTarget, currentBranchSha: string): ValidationResult {
    if (currentBranchSha !== target.node.headSha) {
      return {
        valid: false,
        code: 'BRANCH_MOVED',
        message: `Branch '${target.node.branch}' has moved since the rebase was planned. Expected ${target.node.headSha.slice(0, 8)}, found ${currentBranchSha.slice(0, 8)}. Please refresh and try again.`
      }
    }
    return { valid: true }
  }

  /**
   * Validates that a rebase isn't targeting the same base.
   */
  static validateNotSameBase(target: RebaseTarget): ValidationResult {
    if (target.node.baseSha === target.targetBaseSha) {
      return {
        valid: false,
        code: 'SAME_BASE',
        message: `Branch '${target.node.branch}' is already based on the target commit`
      }
    }
    return { valid: true }
  }

  /**
   * Validates that conflicts have been resolved before continuing.
   */
  static validateConflictsResolved(status: WorkingTreeStatus): ValidationResult {
    if (status.conflicted.length > 0) {
      return {
        valid: false,
        code: 'CONFLICTS_UNRESOLVED',
        message: `Conflicts must be resolved before continuing. Unresolved files: ${status.conflicted.join(', ')}`
      }
    }
    return { valid: true }
  }

  /**
   * Validates that a rebase is in progress (for continue/abort operations).
   */
  static validateRebaseInProgress(status: WorkingTreeStatus): ValidationResult {
    if (!status.isRebasing) {
      return {
        valid: false,
        code: 'REBASE_IN_PROGRESS',
        message: 'No rebase in progress.'
      }
    }
    return { valid: true }
  }

  /**
   * Validates that a rebase continue operation is safe.
   */
  static validateCanContinueRebase(status: WorkingTreeStatus): ValidationResult {
    const rebaseCheck = RebaseValidator.validateRebaseInProgress(status)
    if (!rebaseCheck.valid) {
      return {
        valid: false,
        code: 'REBASE_IN_PROGRESS',
        message: 'No rebase in progress to continue.'
      }
    }

    const conflictCheck = RebaseValidator.validateConflictsResolved(status)
    if (!conflictCheck.valid) {
      return conflictCheck
    }

    return { valid: true }
  }

  /**
   * Validates that a rebase abort operation is safe.
   */
  static validateCanAbortRebase(status: WorkingTreeStatus): ValidationResult {
    if (!status.isRebasing) {
      return {
        valid: false,
        code: 'REBASE_IN_PROGRESS',
        message: 'No rebase in progress to abort.'
      }
    }
    return { valid: true }
  }

  /**
   * Combines multiple validation results.
   * Returns the first failure or success if all pass.
   */
  static combineValidations(...results: ValidationResult[]): ValidationResult {
    for (const result of results) {
      if (!result.valid) {
        return result
      }
    }
    return { valid: true }
  }

  /**
   * Validates that no branches in the rebase intent are checked out in other worktrees.
   *
   * When a branch is checked out in a worktree, git cannot update the branch ref
   * during rebase (git error: "cannot rebase onto <branch>: checked out in worktree").
   *
   * @param intent - The rebase intent to validate
   * @param worktrees - All worktrees in the repository
   * @param activeWorktreePath - The currently active worktree path (or main repo path)
   * @returns Validation result with conflicts if any branches are checked out elsewhere
   */
  static validateNoWorktreeConflicts(
    intent: RebaseIntent,
    worktrees: Worktree[],
    activeWorktreePath: string
  ): WorktreeValidationResult {
    const conflicts: WorktreeConflict[] = []

    // Build a map of branch -> worktree for quick lookup
    // Only include worktrees that are NOT the active worktree
    const branchToWorktree = new Map<string, Worktree>()
    for (const worktree of worktrees) {
      if (worktree.path === activeWorktreePath) continue
      if (!worktree.branch) continue
      branchToWorktree.set(worktree.branch, worktree)
    }

    // If no other worktrees have branches, no conflicts possible
    if (branchToWorktree.size === 0) {
      return { valid: true }
    }

    // Collect all branches that will be affected by the rebase
    const affectedBranches = RebaseValidator.collectAffectedBranches(intent)

    // Check each affected branch for worktree conflicts
    for (const branch of affectedBranches) {
      const worktree = branchToWorktree.get(branch)
      if (worktree) {
        conflicts.push({
          branch,
          worktreePath: worktree.path,
          isDirty: worktree.isDirty
        })
      }
    }

    if (conflicts.length > 0) {
      const message = RebaseValidator.formatWorktreeConflictMessage(conflicts)
      return { valid: false, code: 'WORKTREE_CONFLICT', message, conflicts }
    }

    return { valid: true }
  }

  /**
   * Partitions worktree conflicts into clean vs dirty worktrees.
   */
  static partitionWorktreeConflicts(conflicts: WorktreeConflict[]): {
    clean: WorktreeConflict[]
    dirty: WorktreeConflict[]
  } {
    const clean: WorktreeConflict[] = []
    const dirty: WorktreeConflict[] = []

    for (const conflict of conflicts) {
      if (conflict.isDirty) {
        dirty.push(conflict)
      } else {
        clean.push(conflict)
      }
    }

    return { clean, dirty }
  }

  /**
   * Builds a user-facing message summarizing worktree conflicts.
   */
  static formatWorktreeConflictMessage(conflicts: WorktreeConflict[]): string {
    if (!conflicts.length) return ''

    // Dedupe conflicts by worktree path (same worktree may block multiple branches)
    const uniqueWorktrees = new Set(conflicts.map((c) => c.worktreePath))
    const conflictCount = conflicts.length
    const worktreeCount = uniqueWorktrees.size

    return conflictCount === 1
      ? `Cannot rebase: branch "${conflicts[0].branch}" is checked out in another worktree`
      : worktreeCount === 1
        ? `Cannot rebase: ${conflictCount} branches are checked out in another worktree`
        : `Cannot rebase: ${conflictCount} branches are checked out in ${worktreeCount} other worktrees`
  }

  /**
   * Recursively collects all branch names that will be affected by a rebase intent.
   * This includes the target branches and all their child branches.
   */
  private static collectAffectedBranches(intent: RebaseIntent): Set<string> {
    const branches = new Set<string>()

    const collectFromNode = (node: StackNodeState): void => {
      branches.add(node.branch)
      for (const child of node.children) {
        collectFromNode(child)
      }
    }

    for (const target of intent.targets) {
      collectFromNode(target.node)
    }

    return branches
  }
}
