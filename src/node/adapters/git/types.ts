/**
 * Git Adapter Types
 *
 * Unified type definitions for Git operations that are independent of the underlying
 * Git implementation (isomorphic-git, simple-git, etc.)
 */

/**
 * Represents a Git commit with essential metadata
 */
export type Commit = {
  sha: string
  message: string
  timeMs: number
  parentSha: string
  childrenSha: string[]
}

/**
 * Detailed commit information including author/committer metadata
 */
export type CommitDetail = {
  sha: string
  message: string
  timeMs: number
  parentSha: string
  author: {
    name: string
    email: string
    timestamp: number
  }
  committer: {
    name: string
    email: string
    timestamp: number
  }
}

/**
 * Git branch information
 */
export type Branch = {
  ref: string
  isTrunk: boolean
  isRemote: boolean
  headSha: string
}

/**
 * Git remote information
 */
export type Remote = {
  name: string
  url: string
}

/**
 * Complete working tree status including all file changes
 */
export type WorkingTreeStatus = {
  currentBranch: string
  currentCommitSha: string
  tracking: string | null
  detached: boolean
  isRebasing: boolean
  staged: string[]
  modified: string[]
  created: string[]
  deleted: string[]
  renamed: string[]
  not_added: string[]
  conflicted: string[]
  allChangedFiles: string[]
}

/**
 * Options for git log operations
 */
export type LogOptions = {
  /**
   * Maximum number of commits to return (depth limit)
   * Undefined means no limit
   */
  depth?: number
  /**
   * Maximum commits to load as a safety limit
   * Prevents pathological cases from hanging
   */
  maxCommits?: number
}

/**
 * Options for git commit operations
 */
export type CommitOptions = {
  message: string
  author?: {
    name: string
    email: string
  }
  committer?: {
    name: string
    email: string
  }
  /**
   * Whether to amend the previous commit
   */
  amend?: boolean
  /**
   * Allow empty commits (no changes)
   */
  allowEmpty?: boolean
}

/**
 * Options for git branch operations
 */
export type BranchOptions = {
  /**
   * Checkout the branch after creating it
   */
  checkout?: boolean
  /**
   * Start point for the new branch (SHA or ref)
   */
  startPoint?: string
}

/**
 * Options for git checkout operations
 */
export type CheckoutOptions = {
  /**
   * Force checkout (discard local changes)
   */
  force?: boolean
  /**
   * Create branch if it doesn't exist
   */
  create?: boolean
  /**
   * Detach HEAD (checkout commit directly, not on any branch)
   */
  detach?: boolean
}

/**
 * Options for git push operations
 */
export type PushOptions = {
  remote: string
  ref: string
  /**
   * Force push (overwrite remote history)
   */
  force?: boolean
  /**
   * Force push with lease. When object, specify expected remote ref tip.
   * Takes precedence over `force` when provided.
   */
  forceWithLease?: boolean | { ref: string; expect: string }
  /**
   * Set upstream tracking
   */
  setUpstream?: boolean
  /**
   * Credentials for authentication (if needed)
   */
  credentials?: {
    username: string
    password: string
  }
}

/**
 * Options for git reset operations
 */
export type ResetOptions = {
  /**
   * Reset mode: soft, mixed, or hard
   */
  mode: 'soft' | 'mixed' | 'hard'
  /**
   * Target commit SHA or ref
   */
  ref: string
}

/**
 * Result of applying a patch to the working tree.
 */
export type ApplyPatchResult = {
  success: boolean
  conflicts?: string[]
}

/**
 * Result of a rebase operation
 */
export type RebaseResult = {
  success: boolean
  conflicts: string[]
  currentCommit?: string
  error?: string
}

/**
 * Options for git rebase operations
 */
export type RebaseOptions = {
  /**
   * Branch to rebase onto
   */
  onto: string
  /**
   * Start of the range to rebase (exclusive)
   */
  from?: string
  /**
   * End of the range to rebase (inclusive)
   */
  to: string
  /**
   * Interactive rebase
   */
  interactive?: boolean
}

/**
 * Result of a cherry-pick operation
 */
export type CherryPickResult = {
  success: boolean
  conflicts: string[]
  pickedCommits: string[]
}

/**
 * Error thrown by git operations
 */
export class GitError extends Error {
  constructor(
    message: string,
    public operation: string,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * Information about a git worktree
 */
export type WorktreeInfo = {
  /** Absolute path to the worktree directory */
  path: string
  /** SHA of the commit HEAD points to */
  headSha: string
  /** Branch name (without refs/heads/) or null if detached HEAD */
  branch: string | null
  /** True if this is the main worktree (original clone location) */
  isMain: boolean
  /** True if the worktree path no longer exists (prunable) */
  isStale: boolean
  /** True if the worktree has uncommitted changes */
  isDirty: boolean
}
