/**
 * PrTargetResolver - Pure domain logic for determining PR targets.
 *
 * Handles two related concerns:
 * 1. Finding the base branch for a new PR by traversing commit history
 * 2. Finding a valid (unmerged) PR target when the original target is merged
 */

import type { Repo } from '@shared/types'
import type { ForgePullRequest } from '@shared/types/git-forge'
import { isTrunk } from '@shared/types/repo'

export class PrTargetResolver {
  private constructor() {}

  /**
   * Finds the base branch for a pull request by traversing up the commit history
   * from the head commit.
   *
   * The function searches for branches that point to commits in the parent chain
   * of the head commit. It prioritizes branches in the following order:
   * 1. Local trunk branches (branches marked as trunk)
   * 2. Other local branches pointing to commits in the parent chain
   * 3. Remote trunk branches (origin/main or origin/master)
   * 4. Fallback to local trunk if no branch found in parent chain
   * 5. Fallback to remote trunk if no local trunk exists
   */
  public static findBaseBranch(repo: Repo, headCommitSha: string): string {
    const headCommit = repo.commits.find((c) => c.sha === headCommitSha)
    if (!headCommit) {
      throw new Error(`Commit ${headCommitSha} not found`)
    }

    // Find base branch by traversing up the parents
    let baseBranch = ''
    let currentSha = headCommit.parentSha

    // Safety limit for traversal to prevent infinite loops
    let depth = 0
    const MAX_DEPTH = 1000

    while (currentSha && depth < MAX_DEPTH) {
      depth++

      // Check if any local branch points to this SHA
      const branchesOnCommit = repo.branches.filter((b) => b.headSha === currentSha && !b.isRemote)

      if (branchesOnCommit.length > 0) {
        // Prioritize trunk if present
        const trunk = branchesOnCommit.find((b) => b.isTrunk)
        if (trunk) {
          baseBranch = trunk.ref
          break
        }
        // Otherwise pick the first one
        baseBranch = branchesOnCommit[0].ref
        break
      }

      // Also check if any remote branches point to this SHA (upstream detection)
      // This is crucial because the base branch for a PR is usually on the remote
      const remoteBranchesOnCommit = repo.branches.filter(
        (b) => b.headSha === currentSha && b.isRemote
      )
      if (remoteBranchesOnCommit.length > 0) {
        const originMain = remoteBranchesOnCommit.find(
          (b) => b.ref === 'origin/main' || b.ref === 'origin/master'
        )
        if (originMain) {
          baseBranch = originMain.ref.replace('origin/', '')
          break
        }
      }

      const currentCommit = repo.commits.find((c) => c.sha === currentSha)
      if (!currentCommit) break
      currentSha = currentCommit.parentSha
    }

    if (!baseBranch) {
      // Fallback to trunk if we can't find anything
      const trunk = repo.branches.find((b) => b.isTrunk && !b.isRemote)
      if (trunk) {
        baseBranch = trunk.ref
      } else {
        // If no local trunk, try remote trunk?
        // Usually git-forge expects a branch name that exists on the remote.
        // If we have 'main' local, we use 'main'.
        // If we don't, maybe we should error.
        // Let's try to find ANY remote branch that looks like a trunk
        const remoteTrunk = repo.branches.find(
          (b) => b.isRemote && (b.ref.endsWith('/main') || b.ref.endsWith('/master'))
        )
        if (remoteTrunk) {
          baseBranch = remoteTrunk.ref.split('/').pop() || 'main'
        } else {
          throw new Error('Could not determine base branch for PR')
        }
      }
    }

    return baseBranch
  }

  /**
   * Finds the first valid (unmerged) target branch by walking up the stack.
   *
   * When creating or updating a PR, the target branch may have been merged.
   * This utility walks up the stack to find the next valid (unmerged) target.
   *
   * Example:
   * Stack: main <- feature-1 <- feature-2 <- feature-3
   *
   * If feature-1 is merged, feature-2's PR should target main instead.
   * If both feature-1 and feature-2 are merged, feature-3 targets main.
   *
   * @param branchName - The branch we're finding a target for (unused but kept for API clarity)
   * @param currentTarget - The current/original target branch
   * @param pullRequests - All known PRs (for tracing the stack)
   * @param mergedBranches - Set of branch names that are merged
   * @returns The valid target branch name
   */
  public static findValidPrTarget(
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
    return this.walkUpStack(currentTarget, pullRequests, mergedBranches)
  }

  /**
   * Checks if a branch is a valid PR target (not merged).
   *
   * @param branchName - Branch to check
   * @param mergedBranches - Set of merged branch names
   * @returns True if branch is a valid target
   */
  public static isValidPrTarget(branchName: string, mergedBranches: Set<string>): boolean {
    // Trunk is always valid
    if (isTrunk(branchName)) {
      return true
    }

    // Branch is valid if not merged
    return !mergedBranches.has(branchName)
  }

  /**
   * Walks up the PR stack to find the first unmerged branch or trunk.
   *
   * @param startBranch - The merged branch to start walking from
   * @param pullRequests - All PRs for tracing parentage
   * @param mergedBranches - Set of merged branch names
   * @returns First valid target or the original if no chain found
   */
  private static walkUpStack(
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
      const pr = pullRequests.find((p) => p.headRefName === current)

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
}
