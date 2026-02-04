/**
 * Permission logic for creating worktrees.
 *
 * This module is used by:
 * - Frontend: to determine if the create worktree option is enabled and show appropriate tooltip
 * - Backend (WorktreeOperation): to validate before executing the operation
 * - MCP Server (future): to validate and return meaningful errors to AI agents
 */

export type CreateWorktreeDeniedReason = 'is-trunk' | 'is-remote' | 'has-worktree'

const DENIED_REASON_MESSAGES: Record<CreateWorktreeDeniedReason, string> = {
  'is-trunk': 'Cannot create worktree for trunk branches',
  'is-remote': 'Cannot create worktree for remote branches',
  'has-worktree': 'Branch already has a worktree'
}

/**
 * Result of a create worktree permission check.
 */
export type CreateWorktreePermission =
  | { allowed: true; deniedReason: undefined }
  | { allowed: false; reason: CreateWorktreeDeniedReason; deniedReason: string }

/**
 * Input state for checking create worktree permission.
 */
export interface CreateWorktreePermissionInput {
  /** Whether this is a trunk branch (main, master, etc.) */
  isTrunk: boolean
  /** Whether this is a remote-tracking branch (e.g., origin/feature) */
  isRemote: boolean
  /** Whether this branch already has a worktree */
  hasWorktree?: boolean
}

/**
 * Determines whether a worktree can be created for a branch.
 *
 * Rules:
 * - Trunk branches cannot have worktrees created (use main worktree)
 * - Remote branches cannot have worktrees created (must be local)
 * - Branches that already have a worktree cannot have another one created
 *
 * @returns Permission result with `allowed` boolean and `deniedReason` message (if denied).
 */
export function getCreateWorktreePermission({
  isTrunk,
  isRemote,
  hasWorktree
}: CreateWorktreePermissionInput): CreateWorktreePermission {
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
  if (hasWorktree) {
    return {
      allowed: false,
      reason: 'has-worktree',
      deniedReason: DENIED_REASON_MESSAGES['has-worktree']
    }
  }
  return { allowed: true, deniedReason: undefined }
}
