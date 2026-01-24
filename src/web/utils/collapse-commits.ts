import type { UiBranch, UiCommit } from '@shared/types'

export interface CollapsibleBranchInfo {
  branch: UiBranch
  /** Number of owned commits that can be hidden (excludes head and fork points) */
  hideableCount: number
}

/**
 * Checks if a commit can be hidden during collapse.
 * A commit can be hidden if:
 * 1. It exists in the commit map (fail-safe: if not found, don't hide)
 * 2. It has no spinoffs (commits with spinoffs are fork points for other stacks)
 */
export function canHideCommit(sha: string, commitBySha: Map<string, UiCommit>): boolean {
  const commit = commitBySha.get(sha)
  // Fail-safe: if commit not found, don't hide it (we can't verify it has no spinoffs)
  if (!commit) return false
  // Don't hide commits with spinoffs - they're fork points for other stacks
  return commit.spinoffs.length === 0
}

/**
 * Computes which branches have collapsible owned commits.
 * Only counts commits that can actually be hidden (no spinoffs, not the head).
 *
 * @returns Map from branch name to collapsible info
 */
export function computeCollapsibleBranches(
  commits: UiCommit[],
  commitBySha: Map<string, UiCommit>
): Map<string, CollapsibleBranchInfo> {
  const collapsible = new Map<string, CollapsibleBranchInfo>()

  for (const commit of commits) {
    for (const branch of commit.branches) {
      const ownedShas = branch.ownedCommitShas
      if (ownedShas && ownedShas.length > 1) {
        // Count only commits that can actually be hidden (excluding head and commits with spinoffs)
        let hideableCount = 0
        for (let i = 1; i < ownedShas.length; i++) {
          if (canHideCommit(ownedShas[i], commitBySha)) {
            hideableCount++
          }
        }
        if (hideableCount > 0) {
          collapsible.set(branch.name, { branch, hideableCount })
        }
      }
    }
  }

  return collapsible
}

