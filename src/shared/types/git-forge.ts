/**
 * Merge strategy for pull requests.
 * Maps directly to GitHub API merge_method values.
 */
export type MergeStrategy = 'squash' | 'merge' | 'rebase'

/**
 * Rate limit information from GitHub API.
 * All fields are from X-RateLimit-* headers.
 */
export type RateLimitInfo = {
  /** Maximum requests allowed per hour */
  limit: number
  /** Remaining requests in current window */
  remaining: number
  /** Unix timestamp (seconds) when the rate limit resets */
  reset: number
  /** Number of requests used in current window */
  used: number
}

/**
 * Status of an individual CI check.
 */
export type CheckStatus = 'pending' | 'success' | 'failure' | 'neutral' | 'skipped'

/**
 * Represents a single CI status check (e.g., GitHub Actions workflow).
 */
export type StatusCheck = {
  name: string
  status: CheckStatus
  description?: string
  detailsUrl?: string
}

/**
 * Reasons why a PR cannot be merged.
 */
export type MergeBlocker =
  | 'checks_pending'
  | 'checks_failed'
  | 'conflicts'
  | 'reviews_required'
  | 'branch_protection'
  | 'computing'
  | 'unknown'

/**
 * Complete merge readiness information for a PR.
 * Combines GitHub's mergeable state with CI check status.
 */
export type MergeReadiness = {
  canMerge: boolean
  blockers: MergeBlocker[]
  checksStatus: 'pending' | 'success' | 'failure' | 'none'
  checks: StatusCheck[]
}

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
  /** Rate limit information from the API (if available) */
  rateLimit?: RateLimitInfo
}

/** Possible states for a pull request */
export type PrState = 'open' | 'closed' | 'merged' | 'draft'

/** PR states that represent active PRs (not closed or merged) */
export const ACTIVE_PR_STATES: readonly PrState[] = ['open', 'draft'] as const

/** Type guard to check if a state is an active PR state */
export function isActivePrState(state: string): state is 'open' | 'draft' {
  return ACTIVE_PR_STATES.includes(state as PrState)
}

export type ForgePullRequest = {
  number: number
  title: string
  url: string
  state: PrState

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

  /**
   * Detailed merge readiness information including CI check status.
   * Only populated for open PRs where we fetch detailed information.
   */
  mergeReadiness?: MergeReadiness
}

/**
 * Determines if a branch has child PRs in a stack.
 * A branch has children if any active (open or draft) PR targets it as their base.
 *
 * @param branchName - The branch to check
 * @param pullRequests - All known PRs
 * @returns True if the branch has child PRs
 */
export function hasChildPrs(
  branchName: string,
  pullRequests: Array<{ baseRefName: string; state: string }>
): boolean {
  return pullRequests.some((pr) => pr.baseRefName === branchName && isActivePrState(pr.state))
}

/**
 * Finds the open (shippable) PR for a branch.
 * Only returns PRs with state 'open' - drafts are not shippable.
 *
 * @param branchName - The branch to find a PR for
 * @param pullRequests - All known PRs
 * @returns The open PR for this branch, or undefined if none exists
 */
export function findOpenPr<T extends { headRefName: string; state: string }>(
  branchName: string,
  pullRequests: T[]
): T | undefined {
  return pullRequests.find((p) => p.headRefName === branchName && p.state === 'open')
}

/**
 * Finds an active (open or draft) PR for a branch.
 * Use this when you need to find a PR that exists but may not be ready to ship.
 *
 * @param branchName - The branch to find a PR for
 * @param pullRequests - All known PRs
 * @returns The active PR for this branch, or undefined if none exists
 */
export function findActivePr<T extends { headRefName: string; state: string }>(
  branchName: string,
  pullRequests: T[]
): T | undefined {
  return pullRequests.find((p) => p.headRefName === branchName && isActivePrState(p.state))
}

/**
 * Checks if a branch has a merged PR (stale target detection).
 * Used to detect when a PR's target branch has already been merged.
 *
 * @param branchName - The branch to check
 * @param pullRequests - All known PRs
 * @returns True if the branch has a merged PR
 */
export function hasMergedPr(
  branchName: string,
  pullRequests: Array<{ headRefName: string; state: string }>
): boolean {
  return pullRequests.some((p) => p.headRefName === branchName && p.state === 'merged')
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
   * Updates a pull request's base branch.
   * Used when a branch has been rebased onto a different base.
   */
  updatePullRequestBase(number: number, baseBranch: string): Promise<void>

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
  mergePullRequest(number: number, mergeMethod: MergeStrategy): Promise<void>

  /**
   * Fetches detailed information about a specific pull request.
   * Used to get mergeable state which is not included in the list endpoint.
   */
  fetchPrDetails(number: number): Promise<{ mergeable: boolean | null; mergeable_state: string }>
}
