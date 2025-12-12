interface CanRebaseParams {
  commitSha: string
  trunkHeadSha: string
  isWorkingTreeDirty: boolean
}

/**
 * Determines if a commit can be rebased onto trunk.
 * Returns true when:
 * - commitSha is not empty
 * - trunkHeadSha is not empty
 * - commit is not already on trunk head
 * - working tree is clean
 */
export function canRebase({
  commitSha,
  trunkHeadSha,
  isWorkingTreeDirty
}: CanRebaseParams): boolean {
  if (!commitSha || !trunkHeadSha) {
    return false
  }

  return commitSha !== trunkHeadSha && !isWorkingTreeDirty
}
