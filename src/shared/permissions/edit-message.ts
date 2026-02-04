/**
 * Permission logic for editing commit messages.
 *
 * This module is used by:
 * - Frontend: to determine if the edit message option is enabled and show appropriate tooltip
 * - Backend (CommitOperation): to validate before executing the amend operation
 * - MCP Server (future): to validate and return meaningful errors to AI agents
 */

export type EditMessageDeniedReason = 'is-trunk' | 'not-head'

const DENIED_REASON_MESSAGES: Record<EditMessageDeniedReason, string> = {
  'is-trunk': 'Cannot amend trunk commits',
  'not-head': 'Only the checked out commit can be amended'
}

/**
 * Result of an edit message permission check.
 */
export type EditMessagePermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: EditMessageDeniedReason; deniedReason: string }

/**
 * Input state for checking edit message permission.
 */
export interface EditMessagePermissionInput {
  /** Whether this commit is the current HEAD */
  isHead: boolean
  /** Whether this commit is on the trunk stack */
  isTrunk: boolean
}

/**
 * Determines whether a commit's message can be edited (via amend).
 *
 * Rules:
 * - Only the current HEAD commit can have its message edited (via amend)
 * - Commits on trunk cannot be edited (they are shared/pushed history)
 *
 * @returns Permission result with `allowed` boolean and `deniedReason` message (if denied).
 */
export function getEditMessagePermission({
  isHead,
  isTrunk
}: EditMessagePermissionInput): EditMessagePermission {
  if (isTrunk) {
    return {
      allowed: false,
      reason: 'is-trunk',
      deniedReason: DENIED_REASON_MESSAGES['is-trunk']
    }
  }
  if (!isHead) {
    return {
      allowed: false,
      reason: 'not-head',
      deniedReason: DENIED_REASON_MESSAGES['not-head']
    }
  }
  return { allowed: true, deniedReason: undefined }
}
