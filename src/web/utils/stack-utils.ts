import type { UiCommit, UiStack } from '../../shared/types/ui'

/**
 * Traverses the stack tree to find a UiCommit with the given SHA.
 * Searches recursively through all commits and their spinoffs.
 */
export function getUiCommitBySha(stack: UiStack, sha: string): UiCommit | undefined {
  for (const commit of stack.commits) {
    if (commit.sha === sha) {
      return commit
    }

    for (const spinoff of commit.spinoffs) {
      const found = getUiCommitBySha(spinoff, sha)
      if (found) {
        return found
      }
    }
  }

  return undefined
}

/**
 * Finds the branch name being rebased (if mid-rebase with conflicts)
 */
export function findRebasingBranchName(stack: UiStack): string | null {
  for (const commit of stack.commits) {
    if (commit.rebaseStatus === 'conflicted' || commit.rebaseStatus === 'resolved') {
      return commit.branches[0]?.name ?? null
    }
    for (const spinoff of commit.spinoffs) {
      const found = findRebasingBranchName(spinoff)
      if (found) return found
    }
  }
  return null
}
