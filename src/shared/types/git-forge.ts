/**
 * Merge strategy for pull requests.
 * 'squash', 'merge', 'rebase' map to GitHub API merge_method values.
 * 'fast-forward' uses local git operations (not supported by GitHub API).
 */
export type MergeStrategy = 'squash' | 'merge' | 'rebase' | 'fast-forward'

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
export type CheckStatus = 'pending' | 'success' | 'failure' | 'neutral' | 'skipped' | 'expected'

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
  /**
   * Status of CI checks:
   * - 'pending': Checks are running
   * - 'expected': Required checks haven't started yet (waiting for CI to trigger)
   * - 'success': All checks passed
   * - 'failure': One or more checks failed
   * - 'none': No checks configured
   */
  checksStatus: 'pending' | 'expected' | 'success' | 'failure' | 'none'
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

/** PR state priority for selection (lower = higher priority) */
const PR_STATE_PRIORITY: Record<PrState, number> = {
  open: 0,
  draft: 1,
  merged: 2,
  closed: 3
}

/**
 * Finds the best PR for a branch using priority-based selection.
 * Priority order: open > draft > merged > closed
 * Within the same state, prefers most recently created (by createdAt).
 *
 * Use this when you need to find the most relevant PR for display or sync operations,
 * especially when multiple PRs may exist for the same branch (e.g., after closing
 * and reopening).
 *
 * @param branchName - The branch to find a PR for
 * @param pullRequests - All known PRs
 * @returns The best matching PR, or undefined if none exists
 */
export function findBestPr<T extends { headRefName: string; state: string; createdAt?: string }>(
  branchName: string,
  pullRequests: T[]
): T | undefined {
  const matchingPrs = pullRequests.filter((p) => p.headRefName === branchName)
  if (matchingPrs.length === 0) return undefined
  if (matchingPrs.length === 1) return matchingPrs[0]

  // Sort by state priority (ascending), then by createdAt (descending - newer first)
  return [...matchingPrs].sort((a, b) => {
    const priorityA = PR_STATE_PRIORITY[a.state as PrState] ?? 999
    const priorityB = PR_STATE_PRIORITY[b.state as PrState] ?? 999
    if (priorityA !== priorityB) return priorityA - priorityB

    // Same state - prefer more recently created
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return dateB - dateA // Descending (newer first)
  })[0]
}

/**
 * Counts the number of open PRs for a branch.
 * Used to detect the warning condition where multiple open PRs exist.
 *
 * @param branchName - The branch to check
 * @param pullRequests - All known PRs
 * @returns Count of open PRs for the branch
 */
export function countOpenPrs(
  branchName: string,
  pullRequests: Array<{ headRefName: string; state: string }>
): number {
  return pullRequests.filter((p) => p.headRefName === branchName && p.state === 'open').length
}

/**
 * Checks if a branch can recreate a PR.
 * Returns true if the branch has PRs but none are active (open or draft).
 * This indicates the user may want to create a new PR after closing the previous one.
 *
 * @param branchName - The branch to check
 * @param pullRequests - All known PRs
 * @returns True if the branch has only closed/merged PRs (no active ones)
 */
export function canRecreatePr(
  branchName: string,
  pullRequests: Array<{ headRefName: string; state: string }>
): boolean {
  const matching = pullRequests.filter((p) => p.headRefName === branchName)
  if (matching.length === 0) return false // No PR exists - use "Create PR" instead
  return !matching.some((p) => isActivePrState(p.state))
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
}
