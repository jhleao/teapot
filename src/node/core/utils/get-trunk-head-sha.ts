import type { Branch, Commit } from '@shared/types'

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
export function getTrunkHeadSha(branches: Branch[], commits?: Commit[]): string {
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
      return localCommit.timeMs >= remoteCommit.timeMs
        ? localTrunk.headSha
        : remoteTrunk.headSha
    }
  }

  // Fallback: prefer remote (source of truth for stacked diffs after Ship it)
  return remoteTrunk.headSha ?? localTrunk.headSha ?? ''
}
