import type { Commit, Repo } from '@shared/types'
import type { SquashBlocker } from '@shared/types/squash'
import type { GitForgeState } from '../../shared/types/git-forge'
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
}

export class SquashValidator {
  static validate(
    repo: Repo,
    branchToFold: string,
    forgeState: GitForgeState
  ): SquashValidationResult {
    const branchMap = new Map(repo.branches.map((branch) => [branch.ref, branch]))
    const targetBranch = branchMap.get(branchToFold)
    const forgePullRequests = forgeState.pullRequests ?? []

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

    if (repo.workingTreeStatus.isRebasing) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'dirty_tree',
        errorDetail: 'Rebase in progress'
      }
    }

    if (repo.workingTreeStatus.allChangedFiles.length > 0) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'dirty_tree'
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

    if (!SquashValidator.isAncestor(commitMap, targetHeadSha, parentHeadSha)) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        error: 'ancestry_mismatch'
      }
    }

    if (parentInfo.distance > 1) {
      return {
        canSquash: false,
        descendantBranches: [],
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'multi_commit'
      }
    }

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

    const blockingPr = SquashValidator.findDescendantWithOpenPr(descendants, forgePullRequests)
    if (blockingPr) {
      return {
        canSquash: false,
        descendantBranches: descendants,
        parentBranch: parentBranch.ref,
        parentHeadSha,
        targetHeadSha,
        error: 'descendant_has_pr',
        errorDetail: blockingPr
      }
    }

    return {
      canSquash: true,
      descendantBranches: descendants,
      parentBranch: parentBranch.ref,
      parentHeadSha,
      targetHeadSha,
      commitDistance: parentInfo.distance
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

  private static findDescendantWithOpenPr(
    descendants: string[],
    pullRequests: GitForgeState['pullRequests']
  ): string | null {
    for (const branch of descendants) {
      const pr = pullRequests.find((p) => p.headRefName === branch && p.state === 'open')
      if (pr) {
        return branch
      }
    }
    return null
  }
}
