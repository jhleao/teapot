import type { Branch } from '@shared/types'

/**
 * Gets the SHA of the current trunk head commit.
 * Prefers local trunk over remote trunk.
 * Returns empty string if no trunk branch exists or has no headSha.
 */
export function getTrunkHeadSha(branches: Branch[]): string {
  const trunkBranch =
    branches.find((b) => b.isTrunk && !b.isRemote) ?? branches.find((b) => b.isTrunk)

  return trunkBranch?.headSha ?? ''
}
