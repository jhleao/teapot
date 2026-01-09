export type EditMessageDisabledReason = 'on-trunk' | 'not-head'

const DISABLED_REASON_MESSAGES: Record<EditMessageDisabledReason, string> = {
  'on-trunk': 'Cannot amend trunk commits',
  'not-head': 'Only the checked out commit can be amended'
}

/**
 * Represents whether a commit message can be edited and why not if disabled.
 * Includes the human-readable message directly to avoid needing a second function call.
 */
export type EditMessageState =
  | { canEdit: true; disabledReason: undefined }
  | { canEdit: false; reason: EditMessageDisabledReason; disabledReason: string }

/**
 * Options for determining edit message state.
 */
export interface EditMessageOptions {
  /** Whether this commit is the current HEAD */
  isHead: boolean
  /** Whether this commit is on the trunk stack */
  isTrunk: boolean
}

/**
 * Determines whether a commit's message can be edited.
 *
 * Rules:
 * - Only the current HEAD commit can have its message edited (via amend)
 * - Commits on trunk cannot be edited (they are shared/pushed history)
 *
 * Returns state with `canEdit` boolean and `disabledReason` message (if disabled).
 */
export function getEditMessageState({ isHead, isTrunk }: EditMessageOptions): EditMessageState {
  if (isTrunk) {
    return {
      canEdit: false,
      reason: 'on-trunk',
      disabledReason: DISABLED_REASON_MESSAGES['on-trunk']
    }
  }
  if (!isHead) {
    return {
      canEdit: false,
      reason: 'not-head',
      disabledReason: DISABLED_REASON_MESSAGES['not-head']
    }
  }
  return { canEdit: true, disabledReason: undefined }
}

/**
 * Gets the human-readable message explaining why editing is disabled.
 * Returns undefined if editing is allowed.
 *
 * @deprecated Use `state.disabledReason` directly instead. This function is kept
 * for backwards compatibility but the message is now included in the state object.
 */
export function getEditMessageDisabledReason(state: EditMessageState): string | undefined {
  return state.disabledReason
}
