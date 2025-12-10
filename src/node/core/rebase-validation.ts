/**
 * Rebase Validation
 *
 * Pre-flight checks to ensure a rebase operation is safe to perform.
 * These validations should be run before any rebase operation to prevent
 * data loss or repository corruption.
 */

import type { RebaseIntent } from '@shared/types'
import type { GitAdapter } from './git-adapter/interface'
import { rebaseSessionStore } from './rebase-session-store'

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

/**
 * Validates that a rebase intent can be safely executed.
 *
 * Checks performed:
 * 1. Working tree is clean (no uncommitted changes)
 * 2. No rebase is already in progress
 * 3. No existing session for this repository
 * 4. All target branches exist
 * 5. Branch heads haven't moved since intent was created
 * 6. Target base commit exists
 * 7. Not rebasing to the same base
 */
export async function validateRebaseIntent(
  repoPath: string,
  intent: RebaseIntent,
  gitAdapter: GitAdapter
): Promise<ValidationResult> {
  // Check for valid intent structure
  if (!intent.targets.length) {
    return {
      valid: false,
      code: 'INVALID_INTENT',
      message: 'Rebase intent has no targets'
    }
  }

  // Check working tree status
  const workingTreeCheck = await validateCleanWorkingTree(repoPath, gitAdapter)
  if (!workingTreeCheck.valid) {
    return workingTreeCheck
  }

  // Check for existing rebase in progress
  const rebaseCheck = await validateNoRebaseInProgress(repoPath, gitAdapter)
  if (!rebaseCheck.valid) {
    return rebaseCheck
  }

  // Check for existing session
  const sessionCheck = await validateNoExistingSession(repoPath)
  if (!sessionCheck.valid) {
    return sessionCheck
  }

  // Check for detached HEAD (we need a branch to return to)
  const detachedCheck = await validateNotDetached(repoPath, gitAdapter)
  if (!detachedCheck.valid) {
    return detachedCheck
  }

  // Validate each target
  for (const target of intent.targets) {
    // Check that the branch exists
    const branchSha = await gitAdapter.resolveRef(repoPath, target.node.branch)
    if (!branchSha) {
      return {
        valid: false,
        code: 'BRANCH_NOT_FOUND',
        message: `Branch '${target.node.branch}' not found`
      }
    }

    // Check that branch hasn't moved since intent creation
    if (branchSha !== target.node.headSha) {
      return {
        valid: false,
        code: 'BRANCH_MOVED',
        message: `Branch '${target.node.branch}' has moved since the rebase was planned. Expected ${target.node.headSha.slice(0, 8)}, found ${branchSha.slice(0, 8)}. Please refresh and try again.`
      }
    }

    // Check that target base exists
    const targetBaseSha = await gitAdapter.resolveRef(repoPath, target.targetBaseSha)
    if (!targetBaseSha) {
      return {
        valid: false,
        code: 'TARGET_NOT_FOUND',
        message: `Target base commit '${target.targetBaseSha.slice(0, 8)}' not found`
      }
    }

    // Check we're not rebasing to the same base
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

/**
 * Validates that the working tree is clean (no uncommitted changes).
 */
export async function validateCleanWorkingTree(
  repoPath: string,
  gitAdapter: GitAdapter
): Promise<ValidationResult> {
  const status = await gitAdapter.getWorkingTreeStatus(repoPath)

  // Check for any uncommitted changes
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
export async function validateNoRebaseInProgress(
  repoPath: string,
  gitAdapter: GitAdapter
): Promise<ValidationResult> {
  const status = await gitAdapter.getWorkingTreeStatus(repoPath)

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
 * Validates that no session exists for this repository.
 */
export async function validateNoExistingSession(repoPath: string): Promise<ValidationResult> {
  const hasSession = await rebaseSessionStore.hasSession(repoPath)

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

/**
 * Validates that HEAD is not detached.
 */
export async function validateNotDetached(
  repoPath: string,
  gitAdapter: GitAdapter
): Promise<ValidationResult> {
  const status = await gitAdapter.getWorkingTreeStatus(repoPath)

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
 * Validates that a rebase continue operation is safe.
 */
export async function validateCanContinueRebase(
  repoPath: string,
  gitAdapter: GitAdapter
): Promise<ValidationResult> {
  const status = await gitAdapter.getWorkingTreeStatus(repoPath)

  // Must be in a rebase
  if (!status.isRebasing) {
    return {
      valid: false,
      code: 'REBASE_IN_PROGRESS',
      message: 'No rebase in progress to continue.'
    }
  }

  // Must have resolved conflicts
  if (status.conflicted.length > 0) {
    return {
      valid: false,
      code: 'DIRTY_WORKING_TREE',
      message: `Conflicts must be resolved before continuing. Unresolved files: ${status.conflicted.join(', ')}`
    }
  }

  return { valid: true }
}

/**
 * Validates that a rebase abort operation is safe.
 */
export async function validateCanAbortRebase(
  repoPath: string,
  gitAdapter: GitAdapter
): Promise<ValidationResult> {
  const status = await gitAdapter.getWorkingTreeStatus(repoPath)

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
export function combineValidations(...results: ValidationResult[]): ValidationResult {
  for (const result of results) {
    if (!result.valid) {
      return result
    }
  }
  return { valid: true }
}
