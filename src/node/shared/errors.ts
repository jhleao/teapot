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
    public readonly operation: 'checkout' | 'create' | 'delete' | 'rename',
    cause?: unknown
  ) {
    super(message, cause)
    this.name = 'BranchError'
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
