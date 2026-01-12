export type SquashDisabledReason = 'parent-is-trunk' | 'on-trunk' | 'no-branch'

const DISABLED_REASON_MESSAGES: Record<SquashDisabledReason, string> = {
  'parent-is-trunk': 'Cannot squash: parent commit is on trunk',
  'on-trunk': 'Cannot squash trunk commits',
  'no-branch': 'Cannot squash: no branch on this commit'
}

/**
 * Represents whether a commit can be squashed and why not if disabled.
 * Includes the human-readable message directly to avoid needing a second function call.
 */
export type SquashState =
  | { canSquash: true; disabledReason: undefined }
  | { canSquash: false; reason: SquashDisabledReason; disabledReason: string }

/**
 * Options for determining squash state.
 */
export interface SquashStateOptions {
  /** Whether this commit is on the trunk stack */
  isTrunk: boolean
  /** Whether this commit has a local branch */
  hasBranch: boolean
  /** Whether the parent commit is on trunk (squashing would squash into trunk) */
  parentIsTrunk: boolean
}

/**
 * Determines whether a commit can be squashed into its parent.
 *
 * Rules:
 * - Commits on trunk cannot be squashed
 * - Commits without a branch cannot be squashed
 * - Commits whose parent is on trunk cannot be squashed (would squash into trunk)
 *
 * Returns state with `canSquash` boolean and `disabledReason` message (if disabled).
 */
export function getSquashState({
  isTrunk,
  hasBranch,
  parentIsTrunk
}: SquashStateOptions): SquashState {
  if (isTrunk) {
    return {
      canSquash: false,
      reason: 'on-trunk',
      disabledReason: DISABLED_REASON_MESSAGES['on-trunk']
    }
  }
  if (!hasBranch) {
    return {
      canSquash: false,
      reason: 'no-branch',
      disabledReason: DISABLED_REASON_MESSAGES['no-branch']
    }
  }
  if (parentIsTrunk) {
    return {
      canSquash: false,
      reason: 'parent-is-trunk',
      disabledReason: DISABLED_REASON_MESSAGES['parent-is-trunk']
    }
  }
  return { canSquash: true, disabledReason: undefined }
}
