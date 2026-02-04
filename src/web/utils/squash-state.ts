/**
 * @deprecated Use getSquashPermission from '@shared/permissions' instead.
 * This file is kept for backwards compatibility.
 */

import { getSquashPermission, type SquashDeniedReason } from '@shared/permissions'

// Re-export types with old naming for compatibility
export type SquashDisabledReason = SquashDeniedReason

/**
 * Represents whether a commit can be squashed and why not if disabled.
 * @deprecated Use SquashPermission from '@shared/permissions' instead.
 */
export type SquashState =
  | { canSquash: true; disabledReason: undefined }
  | { canSquash: false; reason: SquashDisabledReason; disabledReason: string }

/**
 * Options for determining squash state.
 * @deprecated Use SquashPermissionInput from '@shared/permissions' instead.
 */
export interface SquashStateOptions {
  isTrunk: boolean
  hasBranch: boolean
  parentIsTrunk: boolean
}

/**
 * Determines whether a commit can be squashed into its parent.
 * @deprecated Use getSquashPermission from '@shared/permissions' instead.
 */
export function getSquashState({
  isTrunk,
  hasBranch,
  parentIsTrunk
}: SquashStateOptions): SquashState {
  const permission = getSquashPermission({ isTrunk, hasBranch, parentIsTrunk })
  if (permission.allowed) {
    return { canSquash: true, disabledReason: undefined }
  }
  return {
    canSquash: false,
    reason: permission.reason,
    disabledReason: permission.deniedReason
  }
}
