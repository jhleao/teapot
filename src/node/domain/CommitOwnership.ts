/**
 * CommitOwnership - Shared utility for calculating commit ownership.
 *
 * A branch "owns" all commits from its head back to (but not including)
 * the nearest parent branch head or trunk commit. This module provides
 * a single source of truth for this calculation, used by both:
 * - UiStateBuilder (for UI display)
 * - RebaseIntentBuilder (for rebase operations)
 *
 * Note: This implementation assumes linear commit history (single parent per commit).
 * Merge commits with multiple parents are not fully supported - only the first parent
 * is followed. This aligns with Teapot's stacked diffs workflow where linear history
 * is preferred.
 */

import { log } from '@shared/logger'
import type { Commit } from '@shared/types'

export interface CommitOwnershipResult {
  /**
   * The base SHA - parent of the oldest owned commit.
   * This is where the branch "starts" from another branch or trunk.
   */
  baseSha: string
  /**
   * All commit SHAs owned by this branch.
   * Order: head commit first, oldest owned commit last.
   */
  ownedShas: string[]
}

export interface CommitOwnershipParams {
  /** The head SHA of the branch */
  headSha: string
  /** The branch ref name (to exclude from "other branches" check) */
  branchRef: string
  /** Map of SHA -> Commit for lookups */
  commitMap: Map<string, Commit>
  /** Map of SHA -> branch names at that SHA */
  branchHeadIndex: Map<string, string[]>
  /** Set of trunk commit SHAs */
  trunkShas: Set<string>
}

/**
 * Calculates commit ownership for a branch.
 *
 * Walks backwards from the branch head until hitting:
 * 1. A trunk commit (parent is in trunkShas)
 * 2. Another branch head (parent has branches other than current)
 * 3. A fork point (parent has multiple non-trunk children - multiple spinoffs)
 * 4. Root commit (no parent)
 *
 * Fork point handling: When a branchless commit has multiple spinoffs (branches
 * forking from it), no single branch owns that commit. It becomes "independent"
 * and acts as a stable waypoint. This prevents surprising cascading moves when
 * rebasing one of several sibling branches.
 *
 * @returns The base SHA and array of owned commit SHAs
 */
export function calculateCommitOwnership(params: CommitOwnershipParams): CommitOwnershipResult {
  const { headSha, branchRef, commitMap, branchHeadIndex, trunkShas } = params

  const ownedShas: string[] = []
  let currentSha: string | undefined = headSha
  let baseSha: string = headSha
  let lastKnownParentSha: string | undefined // Track the last parent we know about
  const visited = new Set<string>()

  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha)

    const commit = commitMap.get(currentSha)
    if (!commit) {
      // Commit not in map - this is an edge case (incomplete data)
      // Don't add it to ownedShas since we can't verify ownership
      // Use the last known parent as base if available
      log.warn('[CommitOwnership] Commit not found in map during ownership walk', {
        sha: currentSha.slice(0, 8),
        branchRef,
        ownedSoFar: ownedShas.length
      })
      if (lastKnownParentSha) {
        baseSha = lastKnownParentSha
      }
      break
    }

    // Add to owned commits after we verify it exists
    ownedShas.push(currentSha)

    const parentSha = commit.parentSha
    if (!parentSha) {
      // Root commit - no parent, base is the commit itself
      baseSha = currentSha
      break
    }

    // Track this parent in case we hit a missing commit next
    lastKnownParentSha = parentSha

    // Check if parent is a trunk commit
    if (trunkShas.has(parentSha)) {
      baseSha = parentSha
      break
    }

    // Check if parent is another branch head
    const branchesAtParent = branchHeadIndex.get(parentSha) ?? []
    const otherBranches = branchesAtParent.filter((b) => b !== branchRef)
    if (otherBranches.length > 0) {
      baseSha = parentSha
      break
    }

    // Check if parent is a fork point (has multiple non-trunk children)
    // Fork points are independent commits that no single branch owns.
    // This prevents surprising cascading moves when rebasing sibling branches.
    const parentCommit = commitMap.get(parentSha)
    if (parentCommit && isForkPoint(parentCommit, trunkShas)) {
      log.debug('[CommitOwnership] Stopped at fork point', {
        forkPointSha: parentSha.slice(0, 8),
        branchRef,
        ownedCount: ownedShas.length
      })
      baseSha = parentSha
      break
    }

    currentSha = parentSha
  }

  // Fallback if loop walked through commits but never found a boundary
  // This can happen with unusual repository states (orphan branches, shallow clones)
  if (baseSha === headSha && ownedShas.length > 1 && lastKnownParentSha) {
    baseSha = lastKnownParentSha
    log.debug('[CommitOwnership] Used fallback baseSha from last known parent', {
      branchRef,
      headSha: headSha.slice(0, 8),
      baseSha: baseSha.slice(0, 8),
      ownedCount: ownedShas.length
    })
  }

  return { baseSha, ownedShas }
}

/**
 * Determines if a commit is a fork point (has multiple non-trunk children).
 * Fork points are independent commits that no single branch owns.
 *
 * This is a shared utility used by both:
 * - calculateCommitOwnership (to stop ownership walk)
 * - UiStateBuilder (to mark commits as isIndependent for UI styling)
 */
export function isForkPoint(commit: Commit, trunkShas: Set<string>): boolean {
  const nonTrunkChildren = commit.childrenSha.filter((sha) => !trunkShas.has(sha))
  return nonTrunkChildren.length > 1
}

/**
 * Builds a set of trunk commit SHAs by walking from trunk head.
 * Useful when trunk SHAs aren't already available in state.
 * Only includes commits that exist in the commitMap (handles shallow clones gracefully).
 */
export function buildTrunkShaSet(
  trunkHeadSha: string | undefined,
  commitMap: Map<string, Commit>
): Set<string> {
  const trunkShas = new Set<string>()

  if (!trunkHeadSha) return trunkShas

  let currentSha: string | undefined = trunkHeadSha
  const visited = new Set<string>()

  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha)

    // Only add commits that exist in the map (handles shallow clones)
    const commit = commitMap.get(currentSha)
    if (!commit) {
      // Missing commit - likely shallow clone, stop walking
      break
    }

    trunkShas.add(currentSha)
    currentSha = commit.parentSha || undefined
  }

  return trunkShas
}
