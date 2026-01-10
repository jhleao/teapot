export type SquashPreview = {
  canSquash: boolean
  error?: SquashBlocker
  errorDetail?: string
  targetBranch?: string
  parentBranch?: string
  descendantBranches?: string[]
  isEmpty?: boolean
  hasPr?: boolean
  prNumber?: number
  parentCommitMessage?: string
  commitMessage?: string
  commitAuthor?: string
  /** Info about branch name collision when squashing */
  branchCollision?: {
    /** The branch that already exists on parent commit */
    existingBranch: string
    /** The branch being squashed (child) */
    childBranch: string
  }
}

export type SquashResult = {
  success: boolean
  error?: SquashBlocker
  errorDetail?: string
  conflicts?: string[]
  modifiedBranches?: string[]
  deletedBranch?: string
  localSuccess?: boolean
  /** The branch that was preserved (moved to result commit) */
  preservedBranch?: string
}

export type SquashBlocker =
  | 'no_parent'
  | 'not_linear'
  | 'ancestry_mismatch'
  | 'dirty_tree'
  | 'rebase_in_progress'
  | 'parent_is_trunk'
  | 'is_trunk'
  | 'conflict'
  | 'descendant_conflict'
  | 'push_failed'

/** User's choice for handling branch name collision during squash */
export type BranchChoice = 'parent' | 'child' | 'both' | string
