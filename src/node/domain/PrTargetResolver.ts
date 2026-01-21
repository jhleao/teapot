/**
 * PrTargetResolver - Pure domain logic for determining PR targets.
 *
 * Handles two related concerns:
 * 1. Finding the base branch for a new PR by traversing commit history
 * 2. Finding a valid (unmerged) PR target when the original target is merged
 */

import type { Commit, Repo } from '@shared/types'
import type { ForgePullRequest } from '@shared/types/git-forge'
import { findBestPr } from '@shared/types/git-forge'
import { extractLocalBranchName, isTrunk } from '@shared/types/repo'
import { buildTrunkShaSet } from './CommitOwnership'
import { TrunkResolver } from './TrunkResolver'

export class PrTargetResolver {
  private constructor() {}

  /**
   * Finds the base branch for a pull request by traversing up the commit history.
   *
   * Algorithm:
   * 1. Build set of all commits on trunk's lineage (ancestors of trunk HEAD)
   * 2. Walk up from the branch's parent commit
   * 3. At each commit:
   *    - If on trunk lineage → return trunk (any branches here are siblings)
   *    - If has local branches (not on trunk lineage):
   *      - 1 unmerged → return it (stack parent)
   *      - Multiple unmerged → throw (ambiguous)
   *      - All merged → continue walking
   * 4. Fallback: return trunk
   *
   * Key insight: Branches at commits that are ancestors of trunk are "siblings"
   * (diverged at the same point), not stack parents. Only branches at commits
   * NOT on trunk lineage are valid stack parents.
   */
  public static findBaseBranch(
    repo: Repo,
    headCommitSha: string,
    mergedBranches: Set<string> = new Set()
  ): string {
    // Build commit map for efficient lookups
    const commitMap = new Map<string, Commit>(repo.commits.map((c) => [c.sha, c]))

    const headCommit = commitMap.get(headCommitSha)
    if (!headCommit) {
      throw new Error(`Commit ${headCommitSha} not found`)
    }

    // Find trunk and build set of all commits on trunk's lineage
    const trunkBranch = TrunkResolver.selectTrunk(repo.branches)
    const trunkHeadSha = TrunkResolver.getTrunkHeadSha(repo.branches, repo.commits)
    const trunkShas = buildTrunkShaSet(trunkHeadSha, commitMap)
    const trunkRef = this.resolveTrunkRef(repo, trunkBranch)

    // Walk up from head commit
    let currentSha = headCommit.parentSha
    let depth = 0
    const MAX_DEPTH = 1000

    while (currentSha && depth < MAX_DEPTH) {
      depth++

      // KEY FIX: If this commit is on trunk's lineage, return trunk.
      // Any branches here are siblings (diverged at same point), not stack parents.
      if (trunkShas.has(currentSha)) {
        return trunkRef
      }

      // Check for branches at this commit (potential stack parents)
      // Note: We've already checked trunkShas above, so any branches here are NOT on trunk lineage
      const branchesOnCommit = repo.branches.filter((b) => b.headSha === currentSha && !b.isRemote)

      if (branchesOnCommit.length > 0) {
        // Filter out merged branches - they're not valid stack parents
        const eligibleBranches = branchesOnCommit.filter((b) => !mergedBranches.has(b.ref))

        if (eligibleBranches.length === 1) {
          return eligibleBranches[0].ref
        }
        if (eligibleBranches.length > 1) {
          const branchNames = eligibleBranches.map((b) => b.ref).join(', ')
          throw new Error(
            `Cannot determine PR base: multiple parent branches found (${branchNames}). ` +
              `Please remove stale branches or create the PR manually.`
          )
        }
        // If 0 eligible (all merged), continue walking up
      }

      const currentCommit = commitMap.get(currentSha)
      if (!currentCommit) break
      currentSha = currentCommit.parentSha
    }

    // Fallback to trunk
    return trunkRef
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
   * @param trunkFallback - Optional trunk branch name to use if the stack cannot be traced
   * @returns The valid target branch name
   * @throws Error when target is merged and no trunk fallback is provided
   */
  public static findValidPrTarget(
    _branchName: string,
    currentTarget: string,
    pullRequests: ForgePullRequest[],
    mergedBranches: Set<string>,
    trunkFallback?: string
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
    return this.walkUpStack(currentTarget, pullRequests, mergedBranches, trunkFallback)
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
   * Resolves the trunk branch ref name, with fallbacks.
   */
  private static resolveTrunkRef(
    repo: Repo,
    trunkBranch: ReturnType<typeof TrunkResolver.selectTrunk>
  ): string {
    if (trunkBranch) {
      return trunkBranch.isRemote ? extractLocalBranchName(trunkBranch.ref) : trunkBranch.ref
    }

    // Fallback: find any local trunk
    const localTrunk = repo.branches.find((b) => !b.isRemote && isTrunk(b.ref))
    if (localTrunk) {
      return localTrunk.ref
    }

    // Fallback: find any remote trunk
    const remoteTrunk = repo.branches.find(
      (b) => b.isRemote && isTrunk(extractLocalBranchName(b.ref))
    )
    if (remoteTrunk) {
      return extractLocalBranchName(remoteTrunk.ref)
    }

    throw new Error('Could not determine base branch for PR: no trunk branch found')
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
    mergedBranches: Set<string>,
    trunkFallback?: string
  ): string {
    const visited = new Set<string>()
    let current = startBranch

    while (true) {
      // Prevent infinite loops from circular references
      if (visited.has(current)) {
        return trunkFallback ?? current
      }
      visited.add(current)

      // Find the PR for this branch to get its target
      const pr = findBestPr(current, pullRequests)

      if (!pr) {
        // Can't trace further - fall back to trunk if provided, otherwise error
        if (trunkFallback) {
          return trunkFallback
        }
        throw new Error('Cannot determine PR base: target branch is merged and trunk is unknown.')
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
