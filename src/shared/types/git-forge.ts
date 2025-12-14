export type GitForgeState = {
  pullRequests: ForgePullRequest[]
  /**
   * Branch names that have been detected as merged into trunk via local Git detection.
   * This is a fallback when GitHub API is unavailable or doesn't have PR data.
   * Used to set `isMerged` on branches even without PR information.
   */
  mergedBranchNames?: string[]
}

/**
 * Status of the forge state fetch operation.
 * Used to provide UI feedback about network operations.
 */
export type ForgeStatus = 'idle' | 'fetching' | 'error' | 'success'

/**
 * Result of a forge state fetch, including status metadata.
 * Allows the UI to show loading/error states while still displaying stale data.
 */
export type ForgeStateResult = {
  /** The forge state (may be stale if status is 'error') */
  state: GitForgeState
  /** Current status of the fetch operation */
  status: ForgeStatus
  /** Error message if status is 'error' */
  error?: string
  /** Timestamp of last successful fetch (ms since epoch) */
  lastSuccessfulFetch?: number
}

export type ForgePullRequest = {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged' | 'draft'

  /**
   * The name of the branch where the changes are implemented.
   * Used to link the PR to a local branch.
   */
  headRefName: string

  /**
   * The SHA of the commit at the tip of the PR branch.
   * Used to determine if the local branch is in sync with the PR.
   */
  headSha: string

  /**
   * The name of the branch into which the changes are to be merged.
   */
  baseRefName: string

  createdAt: string

  /**
   * Whether the PR can be merged (no conflicts, checks passed, not blocked by branch policies).
   * Only true when GitHub returns mergeable=true AND mergeable_state='clean'.
   * False for draft PRs, closed PRs, or when branch protection blocks the merge.
   */
  isMergeable: boolean
}

export interface GitForgeAdapter {
  /**
   * Fetches the current state of the forge (e.g. open PRs).
   * This is expected to be called periodically or on demand.
   */
  fetchState(): Promise<GitForgeState>

  /**
   * Creates a new pull request.
   */
  createPullRequest(
    title: string,
    headBranch: string,
    baseBranch: string,
    draft?: boolean
  ): Promise<ForgePullRequest>

  closePullRequest(number: number): Promise<void>

  /**
   * Deletes a branch from the remote repository.
   * Should treat "branch doesn't exist" as success (idempotent).
   */
  deleteRemoteBranch(branchName: string): Promise<void>

  /**
   * Merges a pull request using the specified merge method.
   * @param number - PR number
   * @param mergeMethod - 'squash' | 'merge' | 'rebase'
   * @throws Error if merge fails (conflicts, branch protection, etc.)
   */
  mergePullRequest(number: number, mergeMethod: 'squash' | 'merge' | 'rebase'): Promise<void>

  /**
   * Fetches detailed information about a specific pull request.
   * Used to get mergeable state which is not included in the list endpoint.
   */
  fetchPrDetails(number: number): Promise<{ mergeable: boolean | null; mergeable_state: string }>
}
