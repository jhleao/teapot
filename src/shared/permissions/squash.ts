/**
 * Permission logic for squashing commits.
 *
 * This module is used by:
 * - Frontend: to determine if the squash option is enabled and show appropriate tooltip
 * - Backend (SquashOperation): to validate before executing the operation
 * - MCP Server (future): to validate and return meaningful errors to AI agents
 */

export type SquashDeniedReason = 'is-trunk' | 'is-remote' | 'parent-is-trunk' | 'no-branch'

const DENIED_REASON_MESSAGES: Record<SquashDeniedReason, string> = {
  'is-trunk': 'Cannot squash trunk commits',
  'is-remote': 'Cannot squash remote branches',
  'parent-is-trunk': 'Cannot squash: parent commit is on trunk',
  'no-branch': 'Cannot squash: no branch on this commit'
}

/**
 * Result of a squash permission check.
 */
export type SquashPermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: SquashDeniedReason; deniedReason: string }

/**
 * Input state for checking squash permission.
 */
export interface SquashPermissionInput {
  /** Whether this commit/branch is on trunk */
  isTrunk: boolean
  /** Whether this is a remote-tracking branch */
  isRemote?: boolean
  /** Whether this commit has a local branch */
  hasBranch?: boolean
  /** Whether the parent commit is on trunk (squashing would merge into trunk) */
  parentIsTrunk: boolean
}

/**
 * Determines whether a commit/branch can be squashed into its parent.
 *
 * Rules:
 * - Commits on trunk cannot be squashed (protected history)
 * - Remote branches cannot be squashed (must be done locally)
 * - Commits without a branch cannot be squashed
 * - Commits whose parent is on trunk cannot be squashed (would squash into trunk)
 *
 * @returns Permission result with `allowed` boolean and `deniedReason` message (if denied).
 */
export function getSquashPermission({
  isTrunk,
  isRemote,
  hasBranch,
  parentIsTrunk
}: SquashPermissionInput): SquashPermission {
  if (isTrunk) {
    return {
      allowed: false,
      reason: 'is-trunk',
      deniedReason: DENIED_REASON_MESSAGES['is-trunk']
    }
  }
  if (isRemote) {
    return {
      allowed: false,
      reason: 'is-remote',
      deniedReason: DENIED_REASON_MESSAGES['is-remote']
    }
  }
  // hasBranch defaults to true if not specified (for branch-level checks)
  if (hasBranch === false) {
    return {
      allowed: false,
      reason: 'no-branch',
      deniedReason: DENIED_REASON_MESSAGES['no-branch']
    }
  }
  if (parentIsTrunk) {
    return {
      allowed: false,
      reason: 'parent-is-trunk',
      deniedReason: DENIED_REASON_MESSAGES['parent-is-trunk']
    }
  }
  return { allowed: true, deniedReason: undefined }
}
