/**
 * RebaseIntentBuilder - Pure domain logic for building rebase intents.
 *
 * Builds a RebaseIntent from a head SHA and target base SHA.
 * The intent represents the user's desire to rebase a branch (and its descendants)
 * onto a new base commit.
 */

import { log } from '@shared/logger'
import type { Branch, Commit, RebaseIntent, Repo, StackNodeState } from '@shared/types'
import { buildTrunkShaSet, calculateCommitOwnership } from './CommitOwnership'
import { StackAnalyzer } from './StackAnalyzer'

export class RebaseIntentBuilder {
  // Prevent instantiation - use static methods
  private constructor() {}

  /**
   * Builds a RebaseIntent for rebasing a branch onto a new base.
   *
   * @param repo - The repository state
   * @param headSha - The head SHA of the branch to rebase
   * @param baseSha - The target base SHA to rebase onto
   * @returns RebaseIntent or null if the operation is invalid
   */
  public static build(repo: Repo, headSha: string, baseSha: string): RebaseIntent | null {
    log.debug('[RebaseIntentBuilder.build] Building intent', {
      headSha: headSha.slice(0, 8),
      targetBaseSha: baseSha.slice(0, 8)
    })

    // Early validation: no-op rebase (head === base) is not useful
    if (headSha === baseSha) {
      log.debug('[RebaseIntentBuilder.build] No-op rebase: headSha equals baseSha', {
        sha: headSha.slice(0, 8)
      })
      return null
    }

    const commitMap = new Map<string, Commit>(repo.commits.map((commit) => [commit.sha, commit]))
    if (!commitMap.has(headSha) || !commitMap.has(baseSha)) {
      log.warn('[RebaseIntentBuilder.build] Commit not found in map', {
        hasHead: commitMap.has(headSha),
        hasBase: commitMap.has(baseSha)
      })
      return null
    }

    // Only include local branches in the index - remote branches don't affect local ownership
    // This matches the behavior in UiStateBuilder for consistent ownership calculation
    const localBranches = repo.branches.filter((b) => !b.isRemote)
    const branchHeadIndex = StackAnalyzer.buildBranchHeadIndex(localBranches)

    // Build trunk SHA set once - reused for all ownership calculations
    const trunkBranch = repo.branches.find((b) => b.isTrunk && !b.isRemote)
    const trunkShas = buildTrunkShaSet(trunkBranch?.headSha, commitMap)

    const node = RebaseIntentBuilder.buildStackNodeState(
      repo,
      commitMap,
      branchHeadIndex,
      trunkShas,
      headSha,
      new Set()
    )
    if (!node) {
      return null
    }

    log.debug('[RebaseIntentBuilder.build] Built node', {
      branch: node.branch,
      nodeHeadSha: node.headSha.slice(0, 8),
      nodeBaseSha: node.baseSha.slice(0, 8),
      targetBaseSha: baseSha.slice(0, 8),
      isNoOp: node.baseSha === baseSha
    })

    return {
      id: `preview-${headSha}-${Date.now()}`,
      createdAtMs: Date.now(),
      targets: [
        {
          node,
          targetBaseSha: baseSha
        }
      ]
    }
  }

  /**
   * Builds a StackNodeState tree rooted at the given head SHA.
   * Recursively includes all child branches that depend on this branch.
   *
   * IMPORTANT: The baseSha is computed by walking backwards through commits
   * until we find a commit that has another branch pointing to it (fork point).
   * This correctly handles multi-commit branches.
   */
  private static buildStackNodeState(
    repo: Repo,
    commitMap: Map<string, Commit>,
    branchHeadIndex: Map<string, string[]>,
    trunkShas: Set<string>,
    headSha: string,
    visited: Set<string>,
    specificBranchName?: string
  ): StackNodeState | null {
    const commit = commitMap.get(headSha)
    if (!commit) {
      return null
    }

    // Use specific branch name if provided, otherwise select one
    const branchName =
      specificBranchName ?? RebaseIntentBuilder.selectBranchName(repo.branches, headSha)
    if (!branchName) {
      return null
    }

    // Use branch name as the visited key to allow multiple branches at same commit
    const visitedKey = `${headSha}:${branchName}`
    if (visited.has(visitedKey)) {
      return null
    }

    visited.add(visitedKey)

    // Calculate ownership - this gives us both baseSha and all owned commit SHAs
    const { baseSha, ownedShas } = calculateCommitOwnership({
      headSha,
      branchRef: branchName,
      commitMap,
      branchHeadIndex,
      trunkShas
    })

    // Find child branches - branches that depend on this branch's lineage
    const childBranches = RebaseIntentBuilder.findChildBranchesWithForkPoint(
      repo,
      commitMap,
      branchHeadIndex,
      trunkShas,
      headSha,
      branchName
    )
    const children: StackNodeState[] = []

    for (const childBranch of childBranches) {
      const childNode = RebaseIntentBuilder.buildStackNodeState(
        repo,
        commitMap,
        branchHeadIndex,
        trunkShas,
        childBranch.headSha,
        visited,
        childBranch.ref
      )
      if (childNode) {
        children.push(childNode)
      }
    }

    visited.delete(visitedKey)

    return {
      branch: branchName,
      headSha,
      baseSha,
      ownedShas,
      children
    }
  }

  /**
   * Finds child branches whose lineage intersects with the parent's lineage.
   *
   * A branch is considered a "child" if:
   * 1. Its fork point equals parentHeadSha (direct child - forks from parent's head), OR
   * 2. It points to the same commit as parent (sibling at same commit), OR
   * 3. Its lineage intersects with parent's lineage (shares commits that will be rebased)
   *
   * Note: Uses calculateBranchBase for child detection to correctly
   * identify stacked branch relationships even when there are branchless commits.
   */
  private static findChildBranchesWithForkPoint(
    repo: Repo,
    commitMap: Map<string, Commit>,
    branchHeadIndex: Map<string, string[]>,
    trunkShas: Set<string>,
    parentHeadSha: string,
    parentBranchName: string
  ): Branch[] {
    const childBranches: Branch[] = []

    // Use fork point for parent lineage calculation (for Case 3 intersection check)
    const parentForkPoint = RebaseIntentBuilder.calculateBranchBase(
      parentHeadSha,
      parentBranchName,
      commitMap,
      branchHeadIndex,
      trunkShas
    )
    const parentLineage = RebaseIntentBuilder.collectLineage(
      parentHeadSha,
      parentForkPoint,
      commitMap
    )

    for (const branch of repo.branches) {
      // Skip remote branches
      if (branch.isRemote) continue
      // Skip trunk branches
      if (branch.isTrunk) continue
      // Skip the parent branch itself
      if (branch.ref === parentBranchName) continue
      // Skip if no headSha
      if (!branch.headSha) continue

      // Case 1: Sibling at same commit (different branch pointing to same headSha)
      if (branch.headSha === parentHeadSha) {
        childBranches.push(branch)
        continue
      }

      // Calculate this branch's fork point (for child detection)
      const branchForkPoint = RebaseIntentBuilder.calculateBranchBase(
        branch.headSha,
        branch.ref,
        commitMap,
        branchHeadIndex,
        trunkShas
      )

      // Case 2: Direct child (fork point === parentHeadSha)
      if (branchForkPoint === parentHeadSha) {
        childBranches.push(branch)
        continue
      }

      // Case 3: Branch's lineage intersects with parent's lineage
      const branchLineage = RebaseIntentBuilder.collectLineage(
        branch.headSha,
        branchForkPoint,
        commitMap
      )
      const hasIntersection = [...branchLineage].some((sha) => parentLineage.has(sha))
      if (hasIntersection) {
        childBranches.push(branch)
        continue
      }
    }

    return childBranches
  }

  /**
   * Calculates the base SHA for a branch - the parent of the oldest "owned" commit.
   * This is used both for determining rebase bases and for detecting stacked branch
   * relationships (fork points). Delegates to the shared CommitOwnership utility
   * for consistent behavior with UiStateBuilder.
   *
   * Example:
   *   trunk (A) → B (no branch) → C (feature)
   *   calculateBranchBase(C, "feature") returns A (trunk)
   *   When rebasing feature, both B and C move together.
   */
  private static calculateBranchBase(
    headSha: string,
    branchRef: string,
    commitMap: Map<string, Commit>,
    branchHeadIndex: Map<string, string[]>,
    trunkShas: Set<string>
  ): string {
    const result = calculateCommitOwnership({
      headSha,
      branchRef,
      commitMap,
      branchHeadIndex,
      trunkShas
    })

    return result.baseSha
  }

  /**
   * Collects all commit SHAs from headSha down to (but not including) baseSha.
   * Returns the set of commits that will be affected by a rebase.
   * Includes cycle detection to prevent infinite loops on corrupted repositories.
   */
  private static collectLineage(
    headSha: string,
    baseSha: string,
    commitMap: Map<string, Commit>
  ): Set<string> {
    const lineage = new Set<string>()
    let current: string | undefined = headSha

    while (current && current !== baseSha) {
      // Cycle detection: if we've already seen this commit, we have a cycle
      if (lineage.has(current)) {
        log.warn('[RebaseIntentBuilder] Cycle detected in commit graph', {
          sha: current.slice(0, 8),
          headSha: headSha.slice(0, 8),
          baseSha: baseSha.slice(0, 8)
        })
        break
      }
      lineage.add(current)
      const commit = commitMap.get(current)
      if (!commit?.parentSha) break
      current = commit.parentSha
    }

    return lineage
  }

  /**
   * Selects the best branch name for a given head SHA.
   * Prefers local non-trunk branches, then local trunk, then any branch.
   */
  private static selectBranchName(branches: Branch[], headSha: string): string | null {
    // Prefer local non-trunk branch
    const localBranch = branches.find(
      (branch) => branch.headSha === headSha && !branch.isRemote && !branch.isTrunk
    )
    if (localBranch) {
      return localBranch.ref
    }

    // Fallback to any local branch
    const fallbackLocal = branches.find((branch) => branch.headSha === headSha && !branch.isRemote)
    if (fallbackLocal) {
      return fallbackLocal.ref
    }

    // Last resort: any branch
    const anyBranch = branches.find((branch) => branch.headSha === headSha)
    return anyBranch?.ref ?? null
  }
}
