import type { UiCommit, UiPullRequest, UiStack } from '@shared/types'
import type { ForgePullRequest, GitForgeState } from '@shared/types/git-forge'
import { countOpenPrs, findBestPr } from '@shared/types/git-forge'
import { isTrunk } from '@shared/types/repo'

/**
 * Enriches a UI stack with GitHub forge state (PR data) at render time.
 *
 * This layer computes all GitHub-derived state, complementing the backend which computes
 * git-derived state. This separation allows:
 * - Backend: Fast, synchronous computation of local git state (commits, branches, `isDirectlyOffTrunk`)
 * - Enrichment: Asynchronous addition of GitHub API data (PRs, merge status, `canShip`)
 *
 * The UI renders immediately with git data, then re-renders when GitHub data arrives.
 *
 * Computed properties:
 * - `pullRequest`: PR details (number, state, mergeable, etc.)
 * - `isInSync`: Whether local branch matches PR head
 * - `isMerged`: Whether branch/PR has been merged
 * - `hasStaleTarget`: Whether PR targets a merged branch
 * - `canShip`: Whether branch can be shipped (directly off trunk + PR targets trunk)
 *
 * The function creates a new stack with PR data merged in - it does not mutate the original.
 */
export function enrichStackWithForge(
  stack: UiStack | null,
  forgeState: GitForgeState | null
): UiStack | null {
  if (!stack) return null
  if (!forgeState || forgeState.pullRequests.length === 0) return stack

  // Pass the full pullRequests array for findBestPr lookup (handles multiple PRs per branch)
  const pullRequests = forgeState.pullRequests
  const mergedBranchNames = new Set(forgeState.mergedBranchNames ?? [])

  return enrichStackRecursive(stack, pullRequests, mergedBranchNames, stack.isDirectlyOffTrunk)
}

function enrichStackRecursive(
  stack: UiStack,
  pullRequests: ForgePullRequest[],
  mergedBranchNames: Set<string>,
  isDirectlyOffTrunk: boolean
): UiStack {
  return {
    ...stack,
    commits: stack.commits.map((commit) =>
      enrichCommit(commit, pullRequests, mergedBranchNames, isDirectlyOffTrunk)
    )
  }
}

function enrichCommit(
  commit: UiCommit,
  pullRequests: ForgePullRequest[],
  mergedBranchNames: Set<string>,
  isDirectlyOffTrunk: boolean
): UiCommit {
  // Enrich branches with PR data
  const enrichedBranches = commit.branches.map((branch) => {
    // Skip if branch already has PR data
    if (branch.pullRequest) return branch

    // Normalize branch name for remote branches (origin/foo -> foo)
    const normalizedName = branch.isRemote ? branch.name.replace(/^[^/]+\//, '') : branch.name

    // Use findBestPr to select the best PR when multiple exist (prefers open > draft > merged > closed)
    const pr = findBestPr(normalizedName, pullRequests)
    if (!pr) {
      // No PR, but check if branch is merged locally
      const isMerged = mergedBranchNames.has(branch.name) || branch.isMerged
      if (isMerged !== branch.isMerged) {
        return { ...branch, isMerged }
      }
      return branch
    }

    // Check if multiple open PRs exist (warning condition)
    const hasMultipleOpenPrs = countOpenPrs(normalizedName, pullRequests) > 1

    // Build UI pull request data
    // Use commit SHA to determine if in sync (branch head is the commit this branch is on)
    // Compute base drift: PR target differs from expected local base
    const hasBaseDrift =
      branch.expectedPrBase &&
      (pr.state === 'open' || pr.state === 'draft') &&
      pr.baseRefName !== branch.expectedPrBase

    const pullRequest: UiPullRequest = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      isInSync: pr.headSha === commit.sha,
      isMergeable: pr.isMergeable,
      mergeReadiness: pr.mergeReadiness,
      hasMultipleOpenPrs: hasMultipleOpenPrs || undefined,
      hasBaseDrift: hasBaseDrift || undefined
    }

    // Determine merged status
    let isMerged: boolean | undefined
    if (pr.state === 'merged') {
      isMerged = true
    } else if (pr.state === 'closed') {
      isMerged = mergedBranchNames.has(branch.name)
    } else {
      isMerged = false
    }

    // Check if PR targets a merged branch (stale target)
    const hasStaleTarget = mergedBranchNames.has(pr.baseRefName) || undefined

    // Compute canShip: requires directly off trunk AND PR targets trunk
    // Only computed for active PRs (open or draft)
    let canShip: boolean | undefined
    if (pr.state === 'open' || pr.state === 'draft') {
      const prTargetsTrunk = isTrunk(pr.baseRefName)
      canShip = isDirectlyOffTrunk && prTargetsTrunk
    }

    return {
      ...branch,
      pullRequest,
      isMerged,
      hasStaleTarget,
      canShip
    }
  })

  // Enrich spinoffs recursively - each spinoff has its own isDirectlyOffTrunk
  const enrichedSpinoffs = commit.spinoffs.map((spinoff) =>
    enrichStackRecursive(spinoff, pullRequests, mergedBranchNames, spinoff.isDirectlyOffTrunk)
  )

  return {
    ...commit,
    branches: enrichedBranches,
    spinoffs: enrichedSpinoffs
  }
}
