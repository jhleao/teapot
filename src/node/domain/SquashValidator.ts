import type { Commit, Repo } from '@shared/types'
import type { GitForgeState } from '@shared/types/git-forge'
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
    branchToFold: string,
    _forgeState: GitForgeState
  ): SquashValidationResult {
    const branchMap = new Map(repo.branches.map((branch) => [branch.ref, branch]))
    const targetBranch = branchMap.get(branchToFold)

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
        errorDetail: 'Rebase in progress'
      }
    }

    // Check if this is the current branch
    const isCurrentBranch = repo.workingTreeStatus.currentBranch === branchToFold

    // Only block dirty worktree if squashing the CURRENT branch
    if (isCurrentBranch && repo.workingTreeStatus.allChangedFiles.length > 0) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'dirty_tree',
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
    const parentInfo = parentIndex.get(branchToFold)
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
      childrenIndex.get(parentBranch.ref)?.filter((child) => child !== branchToFold) ?? []
    if (siblings.length > 0) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'not_linear',
        errorDetail: 'Branch has siblings in the stack'
      }
    }

    const descendants = StackAnalyzer.collectLinearDescendants(branchToFold, childrenIndex)
    if (!descendants) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'not_linear'
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
