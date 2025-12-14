/**
 * Find Valid PR Target Utility
 *
 * When creating or updating a PR, the target branch may have been merged.
 * This utility walks up the stack to find the next valid (unmerged) target.
 *
 * Example:
 * Stack: main ← feature-1 ← feature-2 ← feature-3
 *
 * If feature-1 is merged, feature-2's PR should target main instead.
 * If both feature-1 and feature-2 are merged, feature-3 targets main.
 */

import type { ForgePullRequest } from '@shared/types/git-forge'
import { isTrunk } from '@shared/types/repo'

/**
 * Finds the first valid (unmerged) target branch by walking up the stack.
 *
 * @param branchName - The branch we're finding a target for
 * @param currentTarget - The current/original target branch
 * @param pullRequests - All known PRs (for tracing the stack)
 * @param mergedBranches - Set of branch names that are merged
 * @returns The valid target branch name
 */
export function findValidPrTarget(
  _branchName: string,
  currentTarget: string,
  pullRequests: ForgePullRequest[],
  mergedBranches: Set<string>
): string {
  // If targeting trunk, it's always valid
  if (isTrunk(currentTarget)) {
    return currentTarget
  }

  // If current target is not merged, it's valid
  if (!mergedBranches.has(currentTarget)) {
    return currentTarget
  }

  // Target is merged - walk up the stack to find valid target
  return walkUpStack(currentTarget, pullRequests, mergedBranches)
}

/**
 * Walks up the PR stack to find the first unmerged branch or trunk.
 *
 * @param startBranch - The merged branch to start walking from
 * @param pullRequests - All PRs for tracing parentage
 * @param mergedBranches - Set of merged branch names
 * @returns First valid target or the original if no chain found
 */
function walkUpStack(
  startBranch: string,
  pullRequests: ForgePullRequest[],
  mergedBranches: Set<string>
): string {
  const visited = new Set<string>()
  let current = startBranch

  while (true) {
    // Prevent infinite loops from circular references
    if (visited.has(current)) {
      return current
    }
    visited.add(current)

    // Find the PR for this branch to get its target
    const pr = pullRequests.find(
      (p) => p.headRefName === current
    )

    if (!pr) {
      // Can't trace further - return current (fallback)
      return current
    }

    const nextTarget = pr.baseRefName

    // If next target is trunk, we're done
    if (isTrunk(nextTarget)) {
      return nextTarget
    }

    // If next target is not merged, it's our valid target
    if (!mergedBranches.has(nextTarget)) {
      return nextTarget
    }

    // Next target is also merged - continue walking
    current = nextTarget
  }
}

/**
 * Checks if a branch is a valid PR target (not merged).
 *
 * @param branchName - Branch to check
 * @param mergedBranches - Set of merged branch names
 * @returns True if branch is a valid target
 */
export function isValidPrTarget(
  branchName: string,
  mergedBranches: Set<string>
): boolean {
  // Trunk is always valid
  if (isTrunk(branchName)) {
    return true
  }

  // Branch is valid if not merged
  return !mergedBranches.has(branchName)
}
