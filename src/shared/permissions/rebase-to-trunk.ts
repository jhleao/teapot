/**
 * Permission logic for rebasing a stack onto trunk.
 *
 * This module is used by:
 * - Frontend: to determine if the rebase-to-trunk button is enabled and show appropriate tooltip
 * - Backend (RebaseOperation): to validate before executing the operation
 * - MCP Server (future): to validate and return meaningful errors to AI agents
 */

export type RebaseToTrunkDeniedReason =
  | 'not-off-trunk'
  | 'already-on-trunk-head'
  | 'no-trunk'
  | 'dirty-working-tree'

const DENIED_REASON_MESSAGES: Record<RebaseToTrunkDeniedReason, string> = {
  'not-off-trunk': 'Stack is not directly off trunk',
  'already-on-trunk-head': 'Already on latest trunk',
  'no-trunk': 'No trunk branch found',
  'dirty-working-tree': 'Cannot rebase with uncommitted changes'
}

/**
 * Result of a rebase-to-trunk permission check.
 */
export type RebaseToTrunkPermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: RebaseToTrunkDeniedReason; deniedReason: string }

/**
 * Input state for checking rebase-to-trunk permission.
 */
export interface RebaseToTrunkPermissionInput {
  /** Whether the stack is directly off trunk (base commit is on trunk) */
  isDirectlyOffTrunk: boolean
  /** Whether the base commit is already the trunk head (nothing to rebase onto) */
  isBaseOnTrunkHead: boolean
  /** Whether the trunk branch exists and has commits */
  hasTrunk: boolean
  /** Whether the working tree has uncommitted changes (optional, for frontend) */
  hasUncommittedChanges?: boolean
}

/**
 * Determines whether a stack can be rebased onto the current trunk head.
 *
 * Rules:
 * - Stack must be directly off trunk (not stacked on another branch)
 * - Stack's base must be behind trunk head (there's something to rebase onto)
 * - Trunk must exist
 * - Working tree must be clean (no uncommitted changes)
 *
 * @returns Permission result with `allowed` boolean and `deniedReason` message (if denied).
 */
export function getRebaseToTrunkPermission({
  isDirectlyOffTrunk,
  isBaseOnTrunkHead,
  hasTrunk,
  hasUncommittedChanges
}: RebaseToTrunkPermissionInput): RebaseToTrunkPermission {
  if (!hasTrunk) {
    return {
      allowed: false,
      reason: 'no-trunk',
      deniedReason: DENIED_REASON_MESSAGES['no-trunk']
    }
  }
  if (!isDirectlyOffTrunk) {
    return {
      allowed: false,
      reason: 'not-off-trunk',
      deniedReason: DENIED_REASON_MESSAGES['not-off-trunk']
    }
  }
  if (isBaseOnTrunkHead) {
    return {
      allowed: false,
      reason: 'already-on-trunk-head',
      deniedReason: DENIED_REASON_MESSAGES['already-on-trunk-head']
    }
  }
  if (hasUncommittedChanges) {
    return {
      allowed: false,
      reason: 'dirty-working-tree',
      deniedReason: DENIED_REASON_MESSAGES['dirty-working-tree']
    }
  }
  return { allowed: true, deniedReason: undefined }
}
