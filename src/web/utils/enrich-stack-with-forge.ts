import type { UiCommit, UiPullRequest, UiStack } from '@shared/types'
import type { ForgePullRequest, GitForgeState } from '@shared/types/git-forge'
import { countOpenPrs, findBestPr } from '@shared/types/git-forge'

/**
 * Enriches a UI stack with forge state (PR data) at render time.
 * This allows the UI to display local data immediately while forge state loads asynchronously.
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

  return enrichStackRecursive(stack, pullRequests, mergedBranchNames)
}

function enrichStackRecursive(
  stack: UiStack,
  pullRequests: ForgePullRequest[],
  mergedBranchNames: Set<string>
): UiStack {
  return {
    ...stack,
    commits: stack.commits.map((commit) => enrichCommit(commit, pullRequests, mergedBranchNames))
  }
}

function enrichCommit(
  commit: UiCommit,
  pullRequests: ForgePullRequest[],
  mergedBranchNames: Set<string>
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
    const pullRequest: UiPullRequest = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      isInSync: pr.headSha === commit.sha,
      isMergeable: pr.isMergeable,
      mergeReadiness: pr.mergeReadiness,
      hasMultipleOpenPrs: hasMultipleOpenPrs || undefined
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

    return {
      ...branch,
      pullRequest,
      isMerged,
      hasStaleTarget
    }
  })

  // Enrich spinoffs recursively
  const enrichedSpinoffs = commit.spinoffs.map((spinoff) =>
    enrichStackRecursive(spinoff, pullRequests, mergedBranchNames)
  )

  return {
    ...commit,
    branches: enrichedBranches,
    spinoffs: enrichedSpinoffs
  }
}
