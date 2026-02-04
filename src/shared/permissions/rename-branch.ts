/**
 * Permission logic for renaming branches.
 *
 * This module is used by:
 * - Frontend: to determine if the rename option is enabled and show appropriate tooltip
 * - Backend (BranchOperation): to validate before executing the operation
 * - MCP Server (future): to validate and return meaningful errors to AI agents
 */

export type RenameBranchDeniedReason = 'is-trunk' | 'is-remote'

const DENIED_REASON_MESSAGES: Record<RenameBranchDeniedReason, string> = {
  'is-trunk': 'Cannot rename trunk branches',
  'is-remote': 'Cannot rename remote branches'
}

/**
 * Result of a rename branch permission check.
 */
export type RenameBranchPermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: RenameBranchDeniedReason; deniedReason: string }

/**
 * Input state for checking rename branch permission.
 */
export interface RenameBranchPermissionInput {
  /** Whether this is a trunk branch (main, master, etc.) */
  isTrunk: boolean
  /** Whether this is a remote-tracking branch (e.g., origin/feature) */
  isRemote: boolean
}

/**
 * Determines whether a branch can be renamed.
 *
 * Rules:
 * - Trunk branches cannot be renamed (they are protected)
 * - Remote branches cannot be renamed (must be done on the remote)
 *
 * @returns Permission result with `allowed` boolean and `deniedReason` message (if denied).
 */
export function getRenameBranchPermission({
  isTrunk,
  isRemote
}: RenameBranchPermissionInput): RenameBranchPermission {
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
  return { allowed: true, deniedReason: undefined }
}
