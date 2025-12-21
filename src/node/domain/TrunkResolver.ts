/**
 * TrunkResolver - Pure domain logic for trunk branch detection.
 *
 * This class consolidates all trunk-related logic into a single source of truth.
 * All functions are pure and synchronous - async operations should use the
 * GitService wrapper instead.
 */

import type { Branch, Commit } from '@shared/types'
import { TRUNK_BRANCHES, type TrunkBranchName } from '../shared/constants'

export class TrunkResolver {
  // Prevent instantiation - use static methods
  private constructor() {}

  /**
   * Checks if a branch name is a recognized trunk name.
   */
  public static isTrunkName(name: string): name is TrunkBranchName {
    return TRUNK_BRANCHES.includes(name as TrunkBranchName)
  }

  /**
   * Normalizes a branch reference by stripping remote prefix.
   * e.g., 'origin/main' -> 'main'
   */
  public static normalizeBranchRef(ref: string, isRemote: boolean): string {
    if (!isRemote) return ref
    const slashIndex = ref.indexOf('/')
    return slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref
  }

  /**
   * Selects the best trunk branch from a list of branches.
   * Priority:
   * 1. Branch marked as trunk (not remote)
   * 2. Branch marked as trunk (any)
   * 3. Canonical trunk name (not remote)
   * 4. Canonical trunk name (any)
   * 5. First branch in list
   */
  public static selectTrunk(branches: Branch[]): Branch | null {
    return (
      branches.find((b) => b.isTrunk && !b.isRemote) ??
      branches.find((b) => b.isTrunk) ??
      branches.find(
        (b) =>
          TrunkResolver.isTrunkName(TrunkResolver.normalizeBranchRef(b.ref, b.isRemote)) &&
          !b.isRemote
      ) ??
      branches.find((b) =>
        TrunkResolver.isTrunkName(TrunkResolver.normalizeBranchRef(b.ref, b.isRemote))
      ) ??
      branches[0] ??
      null
    )
  }

  /**
   * Selects the best trunk name from a list of branch names.
   * Returns the first matching trunk candidate in priority order.
   */
  public static selectTrunkFromNames(branchNames: string[]): string | null {
    return TRUNK_BRANCHES.find((name) => branchNames.includes(name)) ?? null
  }

  /**
   * Checks if a branch is a canonical trunk branch (main, master, develop, trunk).
   */
  public static isCanonicalTrunk(branch: Branch): boolean {
    const normalized = TrunkResolver.normalizeBranchRef(branch.ref, branch.isRemote)
    return TrunkResolver.isTrunkName(normalized)
  }

  /**
   * Filters branches to get only local branches or trunk branches.
   * Remote trunk branches are excluded from stack building but kept for annotations.
   */
  public static selectBranchesForStacks(branches: Branch[]): Branch[] {
    const canonicalRefs = new Set(
      branches
        .filter((branch) => TrunkResolver.isCanonicalTrunk(branch))
        .map((branch) => branch.ref)
    )

    const localOrTrunk = branches.filter((branch) => {
      // Exclude remote trunk branches - they should only be used for annotations
      if (branch.isRemote && branch.isTrunk) {
        return false
      }
      // Include local branches, local trunk, and canonical trunk branches
      return !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
    })

    return localOrTrunk.length > 0 ? localOrTrunk : branches
  }

  /**
   * Finds the best parent branch for checkout when a branch is being deleted.
   * Prioritizes trunk branches.
   */
  public static selectBestParentBranch(branchesAtParent: string[]): string | undefined {
    return branchesAtParent.find((b) => TrunkResolver.isTrunkName(b)) ?? branchesAtParent[0]
  }

  /**
   * Gets the SHA of the most recent trunk head commit (local or remote).
   *
   * Compares local trunk (main) and remote trunk (origin/main) by commit timestamp
   * and returns whichever is more recent. This handles both scenarios:
   *
   * - Online after Ship it: origin/main moved forward → use origin/main
   * - Offline local work: local main has newer commits → use local main
   *
   * Falls back to remote trunk if timestamps are unavailable (placeholder commits),
   * since remote is typically the source of truth for stacked diffs.
   *
   * Returns empty string if no trunk branch exists or has no headSha.
   */
  public static getTrunkHeadSha(branches: Branch[], commits?: Commit[]): string {
    const localTrunk = branches.find((b) => b.isTrunk && !b.isRemote)
    const remoteTrunk = branches.find((b) => b.isTrunk && b.isRemote)

    // If only one exists, use it
    if (!localTrunk && !remoteTrunk) return ''
    if (!localTrunk) return remoteTrunk?.headSha ?? ''
    if (!remoteTrunk) return localTrunk.headSha ?? ''

    // Both exist - compare by commit timestamp if commits are provided
    if (commits && commits.length > 0) {
      const localCommit = commits.find((c) => c.sha === localTrunk.headSha)
      const remoteCommit = commits.find((c) => c.sha === remoteTrunk.headSha)

      // If we can find both commits with valid timestamps, use the more recent one
      if (localCommit?.timeMs && remoteCommit?.timeMs) {
        return localCommit.timeMs >= remoteCommit.timeMs ? localTrunk.headSha : remoteTrunk.headSha
      }
    }

    // Fallback: prefer remote (source of truth for stacked diffs after Ship it)
    return remoteTrunk.headSha ?? localTrunk.headSha ?? ''
  }
}
