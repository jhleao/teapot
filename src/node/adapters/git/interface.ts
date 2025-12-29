/**
 * Git Adapter Interface
 *
 * Defines a unified interface for Git operations that can be implemented
 * by different Git backends (isomorphic-git, simple-git, etc.)
 *
 * This abstraction allows us to:
 * - Swap Git implementations without changing business logic
 * - Test multiple implementations in parallel
 * - Gradually migrate between backends with feature flags
 * - Add new Git operations without coupling to a specific library
 */

import type {
  BranchOptions,
  CheckoutOptions,
  CherryPickResult,
  Commit,
  CommitDetail,
  CommitOptions,
  LogOptions,
  PushOptions,
  RebaseOptions,
  RebaseResult,
  Remote,
  ResetOptions,
  WorkingTreeStatus,
  WorktreeInfo
} from './types'

/**
 * Main Git adapter interface
 *
 * All methods are async and should throw GitError on failure
 */
export interface GitAdapter {
  /**
   * Get the adapter name for logging/debugging
   */
  readonly name: string

  // ============================================================================
  // Repository Inspection
  // ============================================================================

  /**
   * List all branches in the repository
   *
   * @param dir - Repository directory path
   * @param options - Optional filters (e.g., remote branches only)
   * @returns Array of branch names
   */
  listBranches(dir: string, options?: { remote?: string }): Promise<string[]>

  /**
   * List all remotes configured in the repository
   *
   * @param dir - Repository directory path
   * @returns Array of remote configurations
   */
  listRemotes(dir: string): Promise<Remote[]>

  /**
   * Get commit history from a ref
   *
   * @param dir - Repository directory path
   * @param ref - Git ref (branch name, SHA, tag, etc.)
   * @param options - Optional log options (depth, maxCommits)
   * @returns Array of commits in reverse chronological order
   */
  log(dir: string, ref: string, options?: LogOptions): Promise<Commit[]>

  /**
   * Resolve a ref to a commit SHA
   *
   * @param dir - Repository directory path
   * @param ref - Git ref to resolve (HEAD, branch name, tag, etc.)
   * @returns Commit SHA (40-character hex string)
   */
  resolveRef(dir: string, ref: string): Promise<string>

  /**
   * Get the current branch name
   *
   * @param dir - Repository directory path
   * @returns Branch name or null if detached HEAD
   */
  currentBranch(dir: string): Promise<string | null>

  /**
   * Read a git config value
   *
   * @param dir - Repository directory path
   * @param path - Config key (e.g., "user.name", "branch.main.remote")
   * @returns Config value or undefined if not set
   */
  getConfig(dir: string, path: string): Promise<string | undefined>

  /**
   * Read full commit details including author/committer metadata
   *
   * @param dir - Repository directory path
   * @param sha - Commit SHA
   * @returns Detailed commit information
   */
  readCommit(dir: string, sha: string): Promise<CommitDetail>

  /**
   * Get the current working tree status
   *
   * Returns information about staged, modified, untracked files, etc.
   *
   * @param dir - Repository directory path
   * @returns Complete working tree status
   */
  getWorkingTreeStatus(dir: string): Promise<WorkingTreeStatus>

  /**
   * List all worktrees in the repository
   *
   * @param dir - Repository directory path (any worktree path works)
   * @returns Array of worktree information
   */
  listWorktrees(dir: string): Promise<WorktreeInfo[]>

  // ============================================================================
  // Repository Mutation
  // ============================================================================

  /**
   * Stage a file or files for commit
   *
   * @param dir - Repository directory path
   * @param filepath - Relative path to file(s) (or "." for all)
   */
  add(dir: string, filepath: string | string[]): Promise<void>

  /**
   * Unstage a file or files (remove from index, keep working tree changes)
   *
   * @param dir - Repository directory path
   * @param filepath - Relative path to file(s)
   */
  resetIndex(dir: string, filepath: string | string[]): Promise<void>

  /**
   * Remove a file or files from the index and working tree
   *
   * @param dir - Repository directory path
   * @param filepath - Relative path to file(s)
   */
  remove(dir: string, filepath: string | string[]): Promise<void>

  /**
   * Create a commit with staged changes
   *
   * @param dir - Repository directory path
   * @param options - Commit options (message, author, etc.)
   * @returns SHA of the created commit
   */
  commit(dir: string, options: CommitOptions): Promise<string>

  /**
   * Create a new branch
   *
   * @param dir - Repository directory path
   * @param ref - Branch name
   * @param options - Branch options (checkout, startPoint)
   */
  branch(dir: string, ref: string, options?: BranchOptions): Promise<void>

  /**
   * Delete a branch
   *
   * @param dir - Repository directory path
   * @param ref - Branch name to delete
   */
  deleteBranch(dir: string, ref: string): Promise<void>

  /**
   * Rename a branch
   *
   * @param dir - Repository directory path
   * @param oldRef - Current branch name
   * @param newRef - New branch name
   */
  renameBranch(dir: string, oldRef: string, newRef: string): Promise<void>

  /**
   * Checkout a branch or commit
   *
   * @param dir - Repository directory path
   * @param ref - Branch name or commit SHA
   * @param options - Checkout options (force, create)
   */
  checkout(dir: string, ref: string, options?: CheckoutOptions): Promise<void>

  /**
   * Reset HEAD to a specific commit
   *
   * Soft reset: moves HEAD, keeps index and working tree
   * Mixed reset: moves HEAD, resets index, keeps working tree
   * Hard reset: moves HEAD, resets index and working tree
   *
   * @param dir - Repository directory path
   * @param options - Reset options (mode, ref)
   */
  reset(dir: string, options: ResetOptions): Promise<void>

  // ============================================================================
  // Network Operations
  // ============================================================================

  /**
   * Push commits to a remote repository
   *
   * @param dir - Repository directory path
   * @param options - Push options (remote, ref, force, credentials)
   */
  push(dir: string, options: PushOptions): Promise<void>

  /**
   * Fetch updates from a remote repository
   *
   * @param dir - Repository directory path
   * @param remote - Remote name (defaults to 'origin')
   */
  fetch(dir: string, remote?: string): Promise<void>

  // ============================================================================
  // Advanced Operations (Future)
  // ============================================================================

  /**
   * Find the merge base between two commits
   *
   * @param dir - Repository directory path
   * @param ref1 - First ref
   * @param ref2 - Second ref
   * @returns SHA of the merge base commit
   */
  mergeBase?(dir: string, ref1: string, ref2: string): Promise<string>

  /**
   * Merge a branch into the current branch.
   *
   * @param dir - Repository directory path
   * @param branch - Branch to merge into current HEAD
   * @param options - Merge options (ffOnly, etc.)
   * @returns Result of the merge operation
   */
  merge?(
    dir: string,
    branch: string,
    options?: import('@shared/types/repo').MergeOptions
  ): Promise<import('@shared/types/repo').MergeResult>

  /**
   * Check if a commit is an ancestor of another commit.
   *
   * Uses `git merge-base --is-ancestor` under the hood.
   * Returns true if `possibleAncestor` is reachable from `descendant` by following parent links.
   * Note: A commit is considered an ancestor of itself (returns true when both refs point to same commit).
   *
   * Primary use case: detecting if a branch has been merged into trunk.
   * If branch head is an ancestor of trunk head, the branch is merged.
   *
   * @param dir - Repository directory path
   * @param possibleAncestor - The commit/ref that might be an ancestor
   * @param descendant - The commit/ref to check ancestry against
   * @returns true if possibleAncestor is an ancestor of (or equal to) descendant, false otherwise
   */
  isAncestor(dir: string, possibleAncestor: string, descendant: string): Promise<boolean>

  /**
   * Rebase a range of commits onto a new base
   *
   * @param dir - Repository directory path
   * @param options - Rebase options (onto, from, to, interactive)
   * @returns Result of the rebase operation
   */
  rebase?(dir: string, options: RebaseOptions): Promise<RebaseResult>

  /**
   * Cherry-pick commits
   *
   * @param dir - Repository directory path
   * @param commits - Array of commit SHAs to cherry-pick
   * @returns Result of the cherry-pick operation
   */
  cherryPick?(dir: string, commits: string[]): Promise<CherryPickResult>

  /**
   * Continue a paused rebase after conflicts have been resolved
   *
   * @param dir - Repository directory path
   * @returns Result of the rebase continue operation
   */
  rebaseContinue?(dir: string): Promise<RebaseResult>

  /**
   * Abort the current rebase and restore the repository to its pre-rebase state
   *
   * @param dir - Repository directory path
   */
  rebaseAbort?(dir: string): Promise<void>

  /**
   * Skip the current commit during a rebase
   *
   * @param dir - Repository directory path
   * @returns Result of the rebase skip operation
   */
  rebaseSkip?(dir: string): Promise<RebaseResult>

  /**
   * Get information about the current rebase state
   *
   * @param dir - Repository directory path
   * @returns Rebase state information or null if no rebase is in progress
   */
  getRebaseState?(dir: string): Promise<{
    branch: string
    onto: string
    originalHead: string
    currentStep: number
    totalSteps: number
  } | null>
}

/**
 * Type guard to check if an adapter supports merge-base
 */
export function supportsMergeBase(adapter: GitAdapter): adapter is GitAdapter & {
  mergeBase: (dir: string, ref1: string, ref2: string) => Promise<string>
} {
  return typeof adapter.mergeBase === 'function'
}

/**
 * Type guard to check if an adapter supports rebase
 */
export function supportsRebase(adapter: GitAdapter): adapter is GitAdapter & {
  rebase: (dir: string, options: RebaseOptions) => Promise<RebaseResult>
} {
  return typeof adapter.rebase === 'function'
}

/**
 * Type guard to check if an adapter supports cherry-pick
 */
export function supportsCherryPick(adapter: GitAdapter): adapter is GitAdapter & {
  cherryPick: (dir: string, commits: string[]) => Promise<CherryPickResult>
} {
  return typeof adapter.cherryPick === 'function'
}

/**
 * Type guard to check if an adapter supports rebase continue
 */
export function supportsRebaseContinue(adapter: GitAdapter): adapter is GitAdapter & {
  rebaseContinue: (dir: string) => Promise<RebaseResult>
} {
  return typeof adapter.rebaseContinue === 'function'
}

/**
 * Type guard to check if an adapter supports rebase abort
 */
export function supportsRebaseAbort(adapter: GitAdapter): adapter is GitAdapter & {
  rebaseAbort: (dir: string) => Promise<void>
} {
  return typeof adapter.rebaseAbort === 'function'
}

/**
 * Type guard to check if an adapter supports rebase skip
 */
export function supportsRebaseSkip(adapter: GitAdapter): adapter is GitAdapter & {
  rebaseSkip: (dir: string) => Promise<RebaseResult>
} {
  return typeof adapter.rebaseSkip === 'function'
}

/**
 * Type guard to check if an adapter supports getting rebase state
 */
export function supportsGetRebaseState(adapter: GitAdapter): adapter is GitAdapter & {
  getRebaseState: (dir: string) => Promise<{
    branch: string
    onto: string
    originalHead: string
    currentStep: number
    totalSteps: number
  } | null>
} {
  return typeof adapter.getRebaseState === 'function'
}

/**
 * Type guard to check if an adapter supports merge
 */
export function supportsMerge(adapter: GitAdapter): adapter is GitAdapter & {
  merge: (
    dir: string,
    branch: string,
    options?: import('@shared/types/repo').MergeOptions
  ) => Promise<import('@shared/types/repo').MergeResult>
} {
  return typeof adapter.merge === 'function'
}
