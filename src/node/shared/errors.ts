/**
 * Custom error classes for the backend.
 * Provides typed errors for different failure scenarios.
 */

/**
 * Base error class for all application errors.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Error thrown when a git operation fails.
 */
export class GitError extends AppError {
  constructor(
    message: string,
    public readonly operation: string,
    cause?: unknown
  ) {
    super(message, cause)
    this.name = 'GitError'
  }
}

/**
 * Error thrown when a rebase operation fails.
 */
export class RebaseError extends AppError {
  constructor(
    message: string,
    public readonly phase: 'preparation' | 'execution' | 'conflict' | 'abort',
    cause?: unknown
  ) {
    super(message, cause)
    this.name = 'RebaseError'
  }
}

/**
 * Error thrown when a rebase conflict is detected.
 */
export class RebaseConflictError extends RebaseError {
  constructor(
    message: string,
    public readonly conflictedFiles: string[]
  ) {
    super(message, 'conflict')
    this.name = 'RebaseConflictError'
  }
}

/**
 * Error thrown when a branch operation fails.
 */
export class BranchError extends AppError {
  constructor(
    message: string,
    public readonly branchRef: string,
    public readonly operation: 'checkout' | 'create' | 'delete' | 'rename' | 'cleanup',
    cause?: unknown
  ) {
    super(message, cause)
    this.name = 'BranchError'
  }
}

/**
 * Error thrown when a branch deletion fails because the branch is checked out in a worktree.
 *
 * This structured error is thrown by the git adapter when it parses git's error message
 * indicating a worktree conflict. It provides typed access to the conflicting worktree path,
 * enabling callers to handle the conflict appropriately (e.g., remove the worktree and retry).
 *
 * Git reports this error in several scenarios:
 * - Branch is directly checked out in the worktree
 * - Branch is being rebased (worktree is in detached HEAD but branch is still locked)
 * - Branch is being cherry-picked or bisected
 * - Any other operation that locks the branch to a worktree
 *
 * @example
 * try {
 *   await git.deleteBranch(repoPath, branchName)
 * } catch (error) {
 *   if (error instanceof WorktreeConflictError) {
 *     // Handle the conflict by removing the worktree
 *     await removeWorktree(error.worktreePath)
 *     await git.deleteBranch(repoPath, branchName)
 *   }
 * }
 */
export class WorktreeConflictError extends BranchError {
  constructor(
    public readonly branchName: string,
    public readonly worktreePath: string,
    cause?: unknown
  ) {
    super(
      `Cannot delete branch '${branchName}': used by worktree at '${worktreePath}'`,
      branchName,
      'delete',
      cause
    )
    this.name = 'WorktreeConflictError'
  }
}

/**
 * Supported trunk protection operations.
 */
export type TrunkProtectedOperation = 'delete' | 'rename' | 'cleanup'

/**
 * Error thrown when an operation is attempted on a protected trunk branch.
 *
 * This error is thrown by `assertNotTrunk()` and `assertNotTrunkName()` guards
 * in BranchOperation when a user attempts to delete, rename, or cleanup a
 * protected trunk branch (main, master, develop, trunk).
 *
 * The error includes:
 * - The branch ref that triggered the protection (may include case variations)
 * - The operation that was attempted
 * - A user-friendly message explaining why the operation was blocked
 */
export class TrunkProtectionError extends BranchError {
  /**
   * Creates a new TrunkProtectionError.
   *
   * @param branchRef - The branch reference that was protected. This is the
   *   original ref passed to the operation, which may be a case variant like
   *   "MAIN" or a remote ref like "origin/main".
   * @param operation - The operation that was attempted on the trunk branch.
   */
  constructor(
    branchRef: string,
    readonly protectedOperation: TrunkProtectedOperation
  ) {
    super(
      `Cannot ${protectedOperation} trunk branch '${branchRef}'. Trunk branches (main, master, develop, trunk) are protected.`,
      branchRef,
      protectedOperation
    )
    this.name = 'TrunkProtectionError'
  }
}

/**
 * Error thrown when a commit operation fails.
 */
export class CommitError extends AppError {
  constructor(
    message: string,
    public readonly operation: 'commit' | 'amend' | 'uncommit' | 'cherry-pick',
    cause?: unknown
  ) {
    super(message, cause)
    this.name = 'CommitError'
  }
}

/**
 * Error thrown when a forge (GitHub) operation fails.
 */
export class ForgeError extends AppError {
  constructor(
    message: string,
    public readonly operation: 'create-pr' | 'update-pr' | 'fetch-prs' | 'merge-pr',
    public readonly statusCode?: number,
    cause?: unknown
  ) {
    super(message, cause)
    this.name = 'ForgeError'
  }
}

/**
 * Error thrown when a validation check fails.
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Error thrown when a required resource is not found.
 */
export class NotFoundError extends AppError {
  constructor(
    message: string,
    public readonly resourceType: 'branch' | 'commit' | 'file' | 'repo'
  ) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends AppError {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Error thrown when a session is in an invalid state for an operation.
 */
export class SessionError extends AppError {
  constructor(
    message: string,
    public readonly sessionId: string,
    public readonly expectedState?: string,
    public readonly actualState?: string
  ) {
    super(message)
    this.name = 'SessionError'
  }
}
