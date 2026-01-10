export type Repo = {
  /** Main repository path (never changes, used as identifier) */
  path: string
  /** Currently active worktree path. Null means using main worktree. */
  activeWorktreePath: string | null
  commits: Commit[]
  branches: Branch[]
  /** Working tree status for the active worktree */
  workingTreeStatus: WorkingTreeStatus
  /** All worktrees associated with this repository */
  worktrees: Worktree[]
}

/**
 * Information about a git worktree
 */
export type Worktree = {
  /** Absolute path to the worktree directory */
  path: string
  /** SHA of the commit HEAD points to */
  headSha: string
  /** Branch name or null if detached HEAD */
  branch: string | null
  /** True if this is the main worktree (original clone location) */
  isMain: boolean
  /** True if the worktree path no longer exists (prunable) */
  isStale: boolean
  /** True if the worktree has uncommitted changes */
  isDirty: boolean
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
 * Ordered by preference - main is preferred over master, etc.
 * All names are lowercase for case-insensitive comparison.
 */
export const TRUNK_BRANCHES = ['main', 'master', 'develop', 'trunk'] as const

/**
 * Type representing a trunk branch name.
 */
export type TrunkBranchName = (typeof TRUNK_BRANCHES)[number]

/**
 * Checks if a branch name is a protected trunk branch.
 *
 * Protected trunk branches: main, master, develop, trunk
 *
 * This function is case-insensitive to handle Windows (case-insensitive filesystem)
 * and other edge cases where branch names might have unexpected casing.
 *
 * Note: This checks the local branch name only, not remote refs like origin/main.
 * For remote refs, use `isTrunkRef()` which handles the remote prefix.
 *
 * @param branchName - The branch name to check (e.g., "main", "MAIN", "Main")
 * @returns True if the branch is a protected trunk branch
 */
export function isTrunk(branchName: string): branchName is TrunkBranchName {
  return TRUNK_BRANCHES.includes(branchName.toLowerCase() as TrunkBranchName)
}

/**
 * Extracts the local branch name from a remote ref.
 * e.g., 'origin/main' -> 'main', 'upstream/develop' -> 'develop'
 *
 * @param ref - The branch reference (local or remote)
 * @returns The local branch name portion
 */
export function extractLocalBranchName(ref: string): string {
  const slashIndex = ref.indexOf('/')
  return slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref
}

/**
 * Checks if a branch reference (local or remote) refers to a trunk branch.
 *
 * Handles both local refs ("main") and remote refs ("origin/main").
 * Case-insensitive for Windows compatibility.
 *
 * @param ref - The branch reference to check
 * @param isRemote - Whether this is a remote ref (will strip remote prefix)
 * @returns True if the ref refers to a protected trunk branch
 */
export function isTrunkRef(ref: string, isRemote: boolean = false): boolean {
  const localName = isRemote ? extractLocalBranchName(ref) : ref
  return isTrunk(localName)
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
 * Parsed representation of a remote branch reference.
 */
export type RemoteBranchRef = {
  /** The remote name (e.g., 'origin') */
  remote: string
  /** The local branch name (e.g., 'main' or 'feature/foo') */
  localBranch: string
}
