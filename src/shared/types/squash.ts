export type SquashPreview = {
  canSquash: boolean
  error?: SquashBlocker
  errorDetail?: string
  /** The commit SHA being squashed */
  targetCommitSha?: string
  /** The parent commit SHA that target will be squashed into */
  parentCommitSha?: string
  /** Branch name on the target commit, if any */
  targetBranch?: string | null
  /** Branch name on the parent commit, if any */
  parentBranch?: string | null
  /** Branches that will need to be rebased after squash */
  descendantBranches?: string[]
  /** True if target commit has no diff vs parent (empty squash) */
  isEmpty?: boolean
  /** True if target branch has an open PR */
  targetHasPr?: boolean
  /** PR number for target branch */
  targetPrNumber?: number
  /** True if parent branch has an open PR */
  parentHasPr?: boolean
  /** PR number for parent branch */
  parentPrNumber?: number
  /** Commit message of the parent commit */
  parentCommitMessage?: string
  /** Commit message of the target commit */
  commitMessage?: string
  /** Author of the target commit */
  commitAuthor?: string
  /** True if both target and parent have branches (collision case) */
  hasBranchCollision?: boolean
}

/**
 * When squashing causes two branches to point to the same commit,
 * the user must choose how to resolve the collision.
 */
export type BranchCollisionResolution =
  | { type: 'keep_parent' }
  | { type: 'keep_child' }
  | { type: 'keep_both' }
  | { type: 'new_name'; name: string }

export type SquashResult = {
  success: boolean
  error?: SquashBlocker
  errorDetail?: string
  conflicts?: string[]
  modifiedBranches?: string[]
  /** Branch that was deleted (if branch collision resolved by deleting one) */
  deletedBranch?: string
  localSuccess?: boolean
}

export type SquashBlocker =
  | 'no_parent'
  | 'not_linear'
  | 'ancestry_mismatch'
  | 'dirty_tree'
  | 'rebase_in_progress'
  | 'is_trunk'
  | 'parent_is_trunk'
  | 'conflict'
  | 'descendant_conflict'
  | 'push_failed'
