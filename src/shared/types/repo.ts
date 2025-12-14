export type Repo = {
  path: string
  commits: Commit[]
  branches: Branch[]
  workingTreeStatus: WorkingTreeStatus
}

export type Branch = {
  ref: string
  isTrunk: boolean
  isRemote: boolean
  headSha: string
}

export type Commit = {
  sha: string
  message: string
  timeMs: number
  parentSha: string
  childrenSha: string[]
}

export type WorkingTreeStatus = {
  /** Logical name of the branch that HEAD points at, e.g. main, feature/foo. */
  currentBranch: string
  /** HEAD SHA; anchor for diffs and ahead/behind calculations. */
  currentCommitSha: string
  /** Configured upstream for currentBranch (e.g. origin/main) or null when unset. */
  tracking: string | null
  /** True when HEAD is detached (points directly to a commit rather than refs/heads/*). */
  detached: boolean
  /** True when a rebase is in progress (.git/rebase-merge or .git/rebase-apply exists). */
  isRebasing: boolean
  /** Paths with index changes (added/modified/removed in the index vs HEAD). */
  staged: string[]
  /** Paths changed in working tree but not staged (diff between index and workdir). */
  modified: string[]
  /** New, tracked files. */
  created: string[]
  /** Paths removed from workdir or staged as deletions. */
  deleted: string[]
  /** Paths detected as renames/moves (R entries in status). */
  renamed: string[]
  /** Untracked files (present in workdir, absent from index and HEAD). */
  not_added: string[]
  /** Paths with merge/rebase conflicts (e.g. U* status codes). */
  conflicted: string[]
  /** Convenience union of all paths that differ from a clean state */
  allChangedFiles: string[]
}

export type Configuration = {
  repoPath: string
}

// ============================================================================
// Trunk Branch Utilities
// ============================================================================

/**
 * Common trunk branch names recognized by the application.
 */
export const TRUNK_BRANCHES = ['main', 'master'] as const

/**
 * Type representing a trunk branch name.
 */
export type TrunkBranchName = (typeof TRUNK_BRANCHES)[number]

/**
 * Checks if a branch name is a trunk branch (main or master).
 * Note: This checks the local branch name only, not remote refs like origin/main.
 */
export function isTrunk(branchName: string): branchName is TrunkBranchName {
  return TRUNK_BRANCHES.includes(branchName as TrunkBranchName)
}

// ============================================================================
// Git Operation Result Types
// ============================================================================

/**
 * Result of a merge operation.
 */
export type MergeResult = {
  /** Whether the merge succeeded */
  success: boolean
  /** True if merge was a fast-forward */
  fastForward: boolean
  /** Error message if failed */
  error?: string
  /** True if already up to date (no changes needed) */
  alreadyUpToDate?: boolean
}

/**
 * Options for merge operations.
 */
export type MergeOptions = {
  /** Only allow fast-forward merges. Use this to safely sync without surprise merge commits. */
  ffOnly?: boolean
}

/**
 * Result of attempting to checkout a branch.
 */
export type CheckoutResult = {
  /** Whether the checkout succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Result of a remote branch checkout with fetch and fast-forward.
 */
export type RemoteBranchCheckoutResult = CheckoutResult & {
  /** The local branch that was checked out */
  localBranch?: string
}

/**
 * Parsed representation of a remote branch reference.
 */
export type RemoteBranchRef = {
  /** The remote name (e.g., 'origin') */
  remote: string
  /** The local branch name (e.g., 'main' or 'feature/foo') */
  localBranch: string
}
