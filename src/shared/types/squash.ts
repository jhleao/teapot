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
}

export type SquashResult = {
  success: boolean
  error?: SquashBlocker
  errorDetail?: string
  conflicts?: string[]
  modifiedBranches?: string[]
  deletedBranch?: string
  localSuccess?: boolean
}

export type SquashBlocker =
  | 'no_parent'
  | 'not_linear'
  | 'multi_commit'
  | 'ancestry_mismatch'
  | 'dirty_tree'
  | 'descendant_has_pr'
  | 'is_trunk'
  | 'conflict'
  | 'descendant_conflict'
  | 'push_failed'
