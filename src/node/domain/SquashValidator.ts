import type { Branch, Commit, Repo } from '@shared/types'
import type { GitForgeState } from '@shared/types/git-forge'
import type { SquashBlocker } from '@shared/types/squash'

export type SquashValidationResult = {
  canSquash: boolean
  /** The commit SHA being squashed */
  targetCommitSha?: string
  /** The parent commit SHA */
  parentCommitSha?: string
  /** Branch at the target commit, if any */
  targetBranch?: string | null
  /** Branch at the parent commit, if any */
  parentBranch?: string | null
  /** Branches that will need to be rebased (children of target commit) */
  descendantBranches: string[]
  error?: SquashBlocker
  errorDetail?: string
}

export class SquashValidator {
  /**
   * Validates whether a commit can be squashed into its parent.
   * Works at the commit level, not the branch level.
   */
  static validate(
    repo: Repo,
    targetCommitSha: string,
    _forgeState: GitForgeState,
    options: { isCurrentBranch: boolean } = { isCurrentBranch: false }
  ): SquashValidationResult {
    const commitMap = new Map(repo.commits.map((commit) => [commit.sha, commit]))
    const targetCommit = commitMap.get(targetCommitSha)

    if (!targetCommit) {
      return {
        canSquash: false,
        descendantBranches: [],
        error: 'no_parent',
        errorDetail: 'Commit not found'
      }
    }

    const parentCommitSha = targetCommit.parentSha
    if (!parentCommitSha) {
      return {
        canSquash: false,
        targetCommitSha,
        descendantBranches: [],
        error: 'no_parent',
        errorDetail: 'Commit has no parent'
      }
    }

    const parentCommit = commitMap.get(parentCommitSha)
    if (!parentCommit) {
      return {
        canSquash: false,
        targetCommitSha,
        parentCommitSha,
        descendantBranches: [],
        error: 'no_parent',
        errorDetail: 'Parent commit not found'
      }
    }

    // Check if target commit is on trunk
    const targetBranch = SquashValidator.findBranchAtCommit(repo.branches, targetCommitSha)
    const parentBranch = SquashValidator.findBranchAtCommit(repo.branches, parentCommitSha)

    // Check if target is trunk
    if (targetBranch?.isTrunk) {
      return {
        canSquash: false,
        targetCommitSha,
        parentCommitSha,
        targetBranch: targetBranch?.ref ?? null,
        parentBranch: parentBranch?.ref ?? null,
        descendantBranches: [],
        error: 'is_trunk'
      }
    }

    // Check if parent is trunk (cannot squash into trunk)
    if (parentBranch?.isTrunk) {
      return {
        canSquash: false,
        targetCommitSha,
        parentCommitSha,
        targetBranch: targetBranch?.ref ?? null,
        parentBranch: parentBranch?.ref ?? null,
        descendantBranches: [],
        error: 'parent_is_trunk'
      }
    }

    // Check for rebase in progress (always blocks)
    if (repo.workingTreeStatus.isRebasing) {
      return {
        canSquash: false,
        targetCommitSha,
        parentCommitSha,
        targetBranch: targetBranch?.ref ?? null,
        parentBranch: parentBranch?.ref ?? null,
        descendantBranches: [],
        error: 'rebase_in_progress',
        errorDetail: 'Cannot squash: a rebase is already in progress.'
      }
    }

    // Check for dirty working tree (only blocks if operating on current branch)
    if (options.isCurrentBranch && repo.workingTreeStatus.allChangedFiles.length > 0) {
      return {
        canSquash: false,
        targetCommitSha,
        parentCommitSha,
        targetBranch: targetBranch?.ref ?? null,
        parentBranch: parentBranch?.ref ?? null,
        descendantBranches: [],
        error: 'dirty_tree',
        errorDetail:
          'Cannot squash: you have uncommitted changes on this branch. Commit or stash your changes first.'
      }
    }

    // Check for non-linear descendants (multiple children from target commit)
    const childCommits = targetCommit.childrenSha
    if (childCommits.length > 1) {
      return {
        canSquash: false,
        targetCommitSha,
        parentCommitSha,
        targetBranch: targetBranch?.ref ?? null,
        parentBranch: parentBranch?.ref ?? null,
        descendantBranches: [],
        error: 'not_linear',
        errorDetail:
          'Cannot squash: this commit has multiple child branches. Rebase or delete sibling branches first.'
      }
    }

    // Collect descendant branches that will need to be rebased
    const descendantBranches = SquashValidator.collectDescendantBranches(
      targetCommitSha,
      commitMap,
      repo.branches
    )

    return {
      canSquash: true,
      targetCommitSha,
      parentCommitSha,
      targetBranch: targetBranch?.ref ?? null,
      parentBranch: parentBranch?.ref ?? null,
      descendantBranches
    }
  }

  /**
   * Finds a local (non-remote) branch at the given commit SHA.
   * Returns the first local branch found, or null if none.
   */
  private static findBranchAtCommit(branches: Branch[], commitSha: string): Branch | null {
    // Prefer local branches over remote ones
    const localBranch = branches.find((b) => b.headSha === commitSha && !b.isRemote)
    if (localBranch) return localBranch

    // Fall back to remote branch for trunk detection
    return branches.find((b) => b.headSha === commitSha && b.isTrunk) ?? null
  }

  /**
   * Collects all branches that are descendants of the given commit.
   * These branches will need to be rebased after the squash.
   */
  private static collectDescendantBranches(
    commitSha: string,
    commitMap: Map<string, Commit>,
    branches: Branch[]
  ): string[] {
    const descendantShas = new Set<string>()
    const queue = [commitSha]
    const visited = new Set<string>()

    while (queue.length > 0) {
      const currentSha = queue.shift()!
      if (visited.has(currentSha)) continue
      visited.add(currentSha)

      const commit = commitMap.get(currentSha)
      if (!commit) continue

      // Add all children to the queue
      for (const childSha of commit.childrenSha) {
        if (!visited.has(childSha)) {
          descendantShas.add(childSha)
          queue.push(childSha)
        }
      }
    }

    // Find branches at descendant commits (excluding the target commit itself)
    const result: string[] = []
    for (const branch of branches) {
      if (!branch.isRemote && branch.headSha && descendantShas.has(branch.headSha)) {
        result.push(branch.ref)
      }
    }

    return result
  }
}
