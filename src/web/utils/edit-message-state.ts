/**
 * @deprecated Use getEditMessagePermission from '@shared/permissions' instead.
 * This file is kept for backwards compatibility.
 */

import {
  getEditMessagePermission,
  type EditMessageDeniedReason,
  type EditMessagePermissionInput
} from '@shared/permissions'

// Old reason names for backward compatibility
export type EditMessageDisabledReason = 'on-trunk' | 'not-head'
export type EditMessageOptions = EditMessagePermissionInput

// Map new reason names to old reason names for backward compatibility
const REASON_MAP: Record<EditMessageDeniedReason, EditMessageDisabledReason> = {
  'is-trunk': 'on-trunk',
  'not-head': 'not-head'
}

/**
 * Represents whether a commit message can be edited and why not if disabled.
 * @deprecated Use EditMessagePermission from '@shared/permissions' instead.
 */
export type EditMessageState =
  | { canEdit: true; disabledReason: undefined }
  | { canEdit: false; reason: EditMessageDisabledReason; disabledReason: string }

/**
 * Determines whether a commit's message can be edited.
 * @deprecated Use getEditMessagePermission from '@shared/permissions' instead.
 */
export function getEditMessageState({ isHead, isTrunk }: EditMessageOptions): EditMessageState {
  const permission = getEditMessagePermission({ isHead, isTrunk })
  if (permission.allowed) {
    return { canEdit: true, disabledReason: undefined }
  }
  return {
    canEdit: false,
    reason: REASON_MAP[permission.reason],
    disabledReason: permission.deniedReason
  }
}

/**
 * @deprecated Use `state.disabledReason` directly instead.
 */
export function getEditMessageDisabledReason(state: EditMessageState): string | undefined {
  return state.disabledReason
}
