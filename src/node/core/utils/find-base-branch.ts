import type { Repo } from '@shared/types'

/**
 * Finds the base branch for a pull request by traversing up the commit history
 * from the head commit.
 *
 * The function searches for branches that point to commits in the parent chain
 * of the head commit. It prioritizes branches in the following order:
 * 1. Local trunk branches (branches marked as trunk)
 * 2. Other local branches pointing to commits in the parent chain
 * 3. Remote trunk branches (origin/main or origin/master)
 * 4. Fallback to local trunk if no branch found in parent chain
 * 5. Fallback to remote trunk if no local trunk exists
 */
export function findBaseBranch(repo: Repo, headCommitSha: string): string {
  const headCommit = repo.commits.find((c) => c.sha === headCommitSha)
  if (!headCommit) {
    throw new Error(`Commit ${headCommitSha} not found`)
  }

  // Find base branch by traversing up the parents
  let baseBranch = ''
  let currentSha = headCommit.parentSha

  // Safety limit for traversal to prevent infinite loops
  let depth = 0
  const MAX_DEPTH = 1000

  while (currentSha && depth < MAX_DEPTH) {
    depth++

    // Check if any local branch points to this SHA
    const branchesOnCommit = repo.branches.filter((b) => b.headSha === currentSha && !b.isRemote)

    if (branchesOnCommit.length > 0) {
      // Prioritize trunk if present
      const trunk = branchesOnCommit.find((b) => b.isTrunk)
      if (trunk) {
        baseBranch = trunk.ref
        break
      }
      // Otherwise pick the first one
      baseBranch = branchesOnCommit[0].ref
      break
    }

    // Also check if any remote branches point to this SHA (upstream detection)
    // This is crucial because the base branch for a PR is usually on the remote
    const remoteBranchesOnCommit = repo.branches.filter(
      (b) => b.headSha === currentSha && b.isRemote
    )
    if (remoteBranchesOnCommit.length > 0) {
      const originMain = remoteBranchesOnCommit.find(
        (b) => b.ref === 'origin/main' || b.ref === 'origin/master'
      )
      if (originMain) {
        baseBranch = originMain.ref.replace('origin/', '')
        break
      }
    }

    const currentCommit = repo.commits.find((c) => c.sha === currentSha)
    if (!currentCommit) break
    currentSha = currentCommit.parentSha
  }

  if (!baseBranch) {
    // Fallback to trunk if we can't find anything
    const trunk = repo.branches.find((b) => b.isTrunk && !b.isRemote)
    if (trunk) {
      baseBranch = trunk.ref
    } else {
      // If no local trunk, try remote trunk?
      // Usually git-forge expects a branch name that exists on the remote.
      // If we have 'main' local, we use 'main'.
      // If we don't, maybe we should error.
      // Let's try to find ANY remote branch that looks like a trunk
      const remoteTrunk = repo.branches.find(
        (b) => b.isRemote && (b.ref.endsWith('/main') || b.ref.endsWith('/master'))
      )
      if (remoteTrunk) {
        baseBranch = remoteTrunk.ref.split('/').pop() || 'main'
      } else {
        throw new Error('Could not determine base branch for PR')
      }
    }
  }

  return baseBranch
}
