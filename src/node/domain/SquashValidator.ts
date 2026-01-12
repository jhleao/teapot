import type { Commit, Repo, Worktree } from '@shared/types'
import type { GitForgeState } from '@shared/types/git-forge'
import type { WorktreeConflict } from '@shared/types/rebase'
import type { SquashBlocker } from '@shared/types/squash'
import { StackAnalyzer } from './StackAnalyzer'

export type SquashValidationResult = {
  canSquash: boolean
  parentBranch?: string
  descendantBranches: string[]
  parentHeadSha?: string
  targetHeadSha?: string
  commitDistance?: number
  error?: SquashBlocker
  errorDetail?: string
  /** Whether the branch being squashed is the current branch */
  isCurrentBranch?: boolean
  /** Branch that already exists on the parent commit (for collision detection) */
  branchOnParent?: string
  /** Whether the parent branch is trunk */
  parentIsTrunk?: boolean
}

export class SquashValidator {
  static validate(
    repo: Repo,
    branchToSquash: string,
    _forgeState: GitForgeState
  ): SquashValidationResult {
    const branchMap = new Map(repo.branches.map((branch) => [branch.ref, branch]))
    const targetBranch = branchMap.get(branchToSquash)

    if (!targetBranch || targetBranch.isRemote) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'no_parent',
        errorDetail: 'Branch does not exist or is remote'
      }
    }

    if (targetBranch.isTrunk) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'is_trunk'
      }
    }

    // Check if rebase is in progress - always blocks
    if (repo.workingTreeStatus.isRebasing) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'rebase_in_progress',
        errorDetail: 'Cannot squash: a rebase is already in progress.'
      }
    }

    // Check if this is the current branch
    const isCurrentBranch = repo.workingTreeStatus.currentBranch === branchToSquash

    // Only block dirty worktree if squashing the CURRENT branch
    if (isCurrentBranch && repo.workingTreeStatus.allChangedFiles.length > 0) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'dirty_tree',
        errorDetail:
          'Cannot squash: you have uncommitted changes on this branch. Commit or stash your changes first.',
        isCurrentBranch: true
      }
    }

    const commitMap = new Map(repo.commits.map((commit) => [commit.sha, commit]))
    const targetHeadSha = targetBranch.headSha
    if (!targetHeadSha || !commitMap.has(targetHeadSha)) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'ancestry_mismatch',
        errorDetail: 'Missing head commit for branch'
      }
    }

    const parentIndex = StackAnalyzer.buildParentIndex(
      repo.branches.filter((branch) => !branch.isRemote),
      commitMap
    )
    const parentInfo = parentIndex.get(branchToSquash)
    if (!parentInfo) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'no_parent'
      }
    }

    const parentBranch = branchMap.get(parentInfo.parent)
    const parentHeadSha = parentBranch?.headSha
    if (!parentBranch || !parentHeadSha || !commitMap.has(parentHeadSha)) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'ancestry_mismatch',
        errorDetail: 'Parent branch is missing or invalid'
      }
    }

    // Check if parent is trunk - this blocks squash
    if (parentBranch.isTrunk) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'parent_is_trunk',
        parentIsTrunk: true
      }
    }

    if (!SquashValidator.isAncestor(commitMap, targetHeadSha, parentHeadSha)) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        error: 'ancestry_mismatch'
      }
    }

    // NOTE: multi_commit check removed - we now allow multi-commit branches

    const childrenIndex = StackAnalyzer.buildChildrenIndex(parentIndex)
    const siblings =
      childrenIndex.get(parentBranch.ref)?.filter((child) => child !== branchToSquash) ?? []
    if (siblings.length > 0) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'not_linear',
        errorDetail:
          'Cannot squash: this commit has multiple child branches. Rebase or delete sibling branches first.'
      }
    }

    const descendants = StackAnalyzer.collectLinearDescendants(branchToSquash, childrenIndex)
    if (!descendants) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'not_linear',
        errorDetail:
          'Cannot squash: this commit has multiple child branches. Rebase or delete sibling branches first.'
      }
    }

    // NOTE: descendant_has_pr check removed - we no longer auto-push after squash

    return {
      canSquash: true,
      descendantBranches: descendants,
      parentBranch: parentBranch.ref,
      parentHeadSha,
      targetHeadSha,
      commitDistance: parentInfo.distance,
      isCurrentBranch,
      branchOnParent: parentBranch.ref,
      parentIsTrunk: false
    }
  }

  /**
   * Check if any branches involved in the squash are checked out in other worktrees.
   * This prevents git errors when trying to modify branches that are in use elsewhere.
   *
   * @param branchToSquash - The branch being squashed
   * @param parentBranch - The parent branch that will receive the squashed commits
   * @param descendantBranches - Branches that will be rebased after squash
   * @param worktrees - All worktrees in the repository
   * @param activeWorktreePath - The currently active worktree path
   * @returns Validation result with conflicts if any branches are checked out elsewhere
   */
  static validateNoWorktreeConflicts(
    branchToSquash: string,
    parentBranch: string,
    descendantBranches: string[],
    worktrees: Worktree[],
    activeWorktreePath: string
  ): SquashWorktreeValidationResult {
    const conflicts: WorktreeConflict[] = []

    // Build a map of branch -> worktree for quick lookup
    // Only include worktrees that are NOT the active worktree
    const branchToWorktree = new Map<string, Worktree>()
    for (const worktree of worktrees) {
      if (worktree.path === activeWorktreePath) continue
      if (!worktree.branch) continue
      branchToWorktree.set(worktree.branch, worktree)
    }

    // If no other worktrees have branches, no conflicts possible
    if (branchToWorktree.size === 0) {
      return { valid: true }
    }

    // Collect all branches that will be affected by the squash:
    // - The branch being squashed (will be deleted or moved)
    // - The parent branch (will have commits applied to it)
    // - All descendant branches (will be rebased)
    const affectedBranches = [branchToSquash, parentBranch, ...descendantBranches]

    // Check each affected branch for worktree conflicts
    for (const branch of affectedBranches) {
      const worktree = branchToWorktree.get(branch)
      if (worktree) {
        conflicts.push({
          branch,
          worktreePath: worktree.path,
          isDirty: worktree.isDirty
        })
      }
    }

    if (conflicts.length > 0) {
      return { valid: false, conflicts }
    }

    return { valid: true }
  }

  /**
   * Partitions worktree conflicts into clean vs dirty worktrees.
   * Clean worktrees can be auto-detached, dirty worktrees require user action.
   */
  static partitionWorktreeConflicts(conflicts: WorktreeConflict[]): {
    clean: WorktreeConflict[]
    dirty: WorktreeConflict[]
  } {
    const clean: WorktreeConflict[] = []
    const dirty: WorktreeConflict[] = []

    for (const conflict of conflicts) {
      if (conflict.isDirty) {
        dirty.push(conflict)
      } else {
        clean.push(conflict)
      }
    }

    return { clean, dirty }
  }

  /**
   * Builds a user-facing message summarizing worktree conflicts.
   */
  static formatWorktreeConflictMessage(conflicts: WorktreeConflict[]): string {
    if (!conflicts.length) return ''

    const dirtyConflicts = conflicts.filter((c) => c.isDirty)
    if (dirtyConflicts.length > 0) {
      const branches = dirtyConflicts.map((c) => c.branch).join(', ')
      return `Cannot squash: branch(es) ${branches} are checked out in other worktrees with uncommitted changes.`
    }

    const branches = conflicts.map((c) => c.branch).join(', ')
    return `Branch(es) ${branches} are checked out in other worktrees and will be detached.`
  }

  private static isAncestor(
    commitMap: Map<string, Commit>,
    childSha: string,
    ancestorSha: string,
    maxDepth: number = 2000
  ): boolean {
    let depth = 0
    let current: string | undefined = childSha

    while (current && depth <= maxDepth) {
      if (current === ancestorSha) return true
      const commit = commitMap.get(current)
      if (!commit?.parentSha) break
      current = commit.parentSha
      depth++
    }

    return false
  }
}

/**
 * Result of worktree conflict validation for squash operations.
 */
export type SquashWorktreeValidationResult =
  | { valid: true }
  | { valid: false; conflicts: WorktreeConflict[] }
