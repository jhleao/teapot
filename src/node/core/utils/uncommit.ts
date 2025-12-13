import { log } from '@shared/logger'
import { gitForgeService } from '../forge/service'
import { getGitAdapter } from '../git-adapter'
import { deleteBranch } from './delete-branch'

export async function uncommit(repoPath: string, commitSha: string): Promise<void> {
  log.debug(`[uncommit] Starting uncommit for ${commitSha}`)

  const git = getGitAdapter()

  // 1. Get commit and parent
  const commit = await git.readCommit(repoPath, commitSha)
  const parentSha = commit.parentSha

  if (!parentSha) {
    throw new Error('Cannot uncommit a root commit')
  }

  // 2. Find branches pointing to this commit
  const branches = await git.listBranches(repoPath)
  const branchesToDelete: string[] = []

  for (const branch of branches) {
    const branchSha = await git.resolveRef(repoPath, branch)
    if (branchSha === commitSha) {
      branchesToDelete.push(branch)
    }
  }

  // --- GitHub Ripple Effect ---
  // Close PRs associated with branches we are about to delete
  try {
    const forgeState = await gitForgeService.getState(repoPath)
    for (const branch of branchesToDelete) {
      const pr = forgeState.pullRequests.find((p) => p.headRefName === branch && p.state === 'open')
      if (pr) {
        log.debug(`[uncommit] Closing associated PR #${pr.number} for branch ${branch}`)
        await gitForgeService.closePullRequest(repoPath, pr.number)
      }
    }
  } catch (e) {
    log.warn('[uncommit] Failed to handle GitHub PRs during uncommit:', e)
  }

  // 3. Identify current state
  const currentBranch = await git.currentBranch(repoPath)
  const isDetached = !currentBranch

  // 4. Determine target state (Parent)
  const branchesAtParent: string[] = []
  for (const branch of branches) {
    const branchSha = await git.resolveRef(repoPath, branch)
    if (branchSha === parentSha) {
      branchesAtParent.push(branch)
    }
  }

  // Prioritize trunk-like branches
  const trunkCandidates = ['main', 'master', 'trunk', 'develop']
  const bestParentBranch =
    branchesAtParent.find((b) => trunkCandidates.includes(b)) || branchesAtParent[0]

  // 5. Perform soft reset to parent
  let shouldUpdateHead = false
  if (isDetached) {
    const currentHead = await git.resolveRef(repoPath, 'HEAD')
    if (currentHead === commitSha) {
      shouldUpdateHead = true
    }
  } else if (currentBranch && branchesToDelete.includes(currentBranch)) {
    shouldUpdateHead = true
  }

  if (shouldUpdateHead) {
    // Use native git reset --soft (cleaner and safer)
    await git.reset(repoPath, { mode: 'soft', ref: parentSha })

    // If we have a target branch, checkout to it
    // Otherwise, detach HEAD so we can delete the current branch
    if (bestParentBranch) {
      await git.checkout(repoPath, bestParentBranch)
    } else {
      // Detach HEAD at parent commit to allow deleting current branch
      await git.checkout(repoPath, parentSha, { detach: true })
    }
  }

  // 6. Delete the branches that were pointing to the child commit
  for (const branch of branchesToDelete) {
    if (bestParentBranch && branch === bestParentBranch) continue
    await deleteBranch(repoPath, branch)
  }
}
