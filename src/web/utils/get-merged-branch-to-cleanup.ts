import type { UiBranch } from '@shared/types'

/**
 * Finds the first merged branch that can be cleaned up (deleted).
 * A branch can be cleaned up if it's merged and not currently checked out.
 *
 * @param branches - Array of branches to search
 * @returns The first cleanable merged branch, or null if none found
 */
export function getMergedBranchToCleanup(branches: UiBranch[]): UiBranch | null {
  return branches.find((branch) => branch.isMerged && !branch.isCurrent) ?? null
}
