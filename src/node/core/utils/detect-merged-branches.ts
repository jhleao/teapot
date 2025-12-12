/**
 * Detect Merged Branches Utility
 *
 * Detects which branches have been merged into trunk by checking if
 * each branch's head commit is an ancestor of the trunk head.
 *
 * This provides a local, offline-capable way to detect merged branches
 * without relying on GitHub API state.
 */

import type { Branch } from '@shared/types'
import type { GitAdapter } from '../git-adapter/interface'

/**
 * Detects which branches have been merged into trunk.
 *
 * A branch is considered "merged" if its head commit is an ancestor of
 * (or equal to) the trunk head commit. This handles:
 * - Fast-forward merges: branch head is now on trunk
 * - Squash merges: NOT detected (commits are different) - rely on PR state
 * - Rebase merges: NOT detected (commits are rebased) - rely on PR state
 *
 * @param repoPath - Path to the repository
 * @param branches - Array of branches to check
 * @param trunkRef - Reference to trunk (e.g., 'main', 'origin/main')
 * @param adapter - Git adapter for repository operations
 * @returns Array of branch names that are merged into trunk
 */
export async function detectMergedBranches(
  repoPath: string,
  branches: Branch[],
  trunkRef: string,
  adapter: GitAdapter
): Promise<string[]> {
  if (branches.length === 0) {
    return []
  }

  // Filter out branches that shouldn't be checked:
  // - Trunk branches (main/master shouldn't be marked as "merged into itself")
  // - Branches with empty headSha (invalid/ghost branches)
  // Note: We include remote branches so they can be cleaned up too
  const candidateBranches = branches.filter(
    (branch) => !branch.isTrunk && branch.headSha
  )

  if (candidateBranches.length === 0) {
    return []
  }

  // Check each candidate branch in parallel for better performance
  const results = await Promise.all(
    candidateBranches.map(async (branch) => {
      try {
        // A branch is merged if its head is an ancestor of trunk
        const isMerged = await adapter.isAncestor(repoPath, branch.headSha, trunkRef)
        return { name: branch.ref, isMerged }
      } catch {
        // If check fails (e.g., invalid ref), consider not merged
        return { name: branch.ref, isMerged: false }
      }
    })
  )

  // Return only the names of merged branches
  return results.filter((r) => r.isMerged).map((r) => r.name)
}
