interface CanRebaseParams {
  /** The SHA of the trunk commit that the spinoff is based on */
  baseSha: string
  /** The SHA of the current trunk head commit */
  trunkHeadSha: string
  isWorkingTreeDirty: boolean
}

/**
 * Determines if a spinoff can be rebased onto trunk head.
 * Returns true when:
 * - baseSha is not empty
 * - trunkHeadSha is not empty
 * - spinoff's base is not already the trunk head (needs rebasing)
 * - working tree is clean
 */
export function canRebase({
  baseSha,
  trunkHeadSha,
  isWorkingTreeDirty
}: CanRebaseParams): boolean {
  if (!baseSha || !trunkHeadSha) {
    return false
  }

  return baseSha !== trunkHeadSha && !isWorkingTreeDirty
}
