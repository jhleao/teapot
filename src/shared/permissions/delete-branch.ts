/**
 * Permission logic for deleting branches.
 *
 * This module is used by:
 * - Frontend: to determine if the delete option is enabled and show appropriate tooltip
 * - Backend (BranchOperation): to validate before executing the operation
 * - MCP Server (future): to validate and return meaningful errors to AI agents
 */

export type DeleteBranchDeniedReason = 'is-trunk' | 'is-checked-out'

const DENIED_REASON_MESSAGES: Record<DeleteBranchDeniedReason, string> = {
  'is-trunk': 'Cannot delete trunk',
  'is-checked-out': 'Cannot delete the checked out branch'
}

/**
 * Result of a delete branch permission check.
 */
export type DeleteBranchPermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: DeleteBranchDeniedReason; deniedReason: string }

/**
 * Input state for checking delete branch permission.
 */
export interface DeleteBranchPermissionInput {
  /** Whether this is a trunk branch (main, master, etc.) */
  isTrunk: boolean
  /** Whether this branch is currently checked out */
  isCurrent: boolean
}

/**
 * Determines whether a branch can be deleted.
 *
 * Rules:
 * - Trunk branches cannot be deleted (they are protected)
 * - The currently checked out branch cannot be deleted (Git limitation)
 *
 * @returns Permission result with `allowed` boolean and `deniedReason` message (if denied).
 */
export function getDeleteBranchPermission({
  isTrunk,
  isCurrent
}: DeleteBranchPermissionInput): DeleteBranchPermission {
  if (isTrunk) {
    return {
      allowed: false,
      reason: 'is-trunk',
      deniedReason: DENIED_REASON_MESSAGES['is-trunk']
    }
  }
  if (isCurrent) {
    return {
      allowed: false,
      reason: 'is-checked-out',
      deniedReason: DENIED_REASON_MESSAGES['is-checked-out']
    }
  }
  return { allowed: true, deniedReason: undefined }
}
