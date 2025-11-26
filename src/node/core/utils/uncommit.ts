import fs from 'fs'
import git from 'isomorphic-git'
import path from 'path'
import { gitForgeService } from '../forge/service'
import { deleteBranch } from './delete-branch'

export async function uncommit(repoPath: string, commitSha: string): Promise<void> {
  console.log(`[uncommit] Starting uncommit for ${commitSha}`)

  // 1. Get commit and parent
  const commit = await git.readCommit({ fs, dir: repoPath, oid: commitSha })
  const parentSha = commit.commit.parent[0]

  if (!parentSha) {
    throw new Error('Cannot uncommit a root commit')
  }

  // 2. Find branches pointing to this commit
  const branches = await git.listBranches({ fs, dir: repoPath })
  const branchesToDelete: string[] = []

  for (const branch of branches) {
    const branchSha = await git.resolveRef({ fs, dir: repoPath, ref: branch })
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
        console.log(`[uncommit] Closing associated PR #${pr.number} for branch ${branch}`)
        await gitForgeService.closePullRequest(repoPath, pr.number)
      }
    }
  } catch (e) {
    console.warn('[uncommit] Failed to handle GitHub PRs during uncommit:', e)
  }

  // 3. Identify current state
  const currentBranch = await git.currentBranch({ fs, dir: repoPath }) // string or undefined
  const isDetached = !currentBranch

  // 4. Determine target state (Parent)
  let targetRef = parentSha // Default to detached at parent

  const branchesAtParent: string[] = []
  for (const branch of branches) {
    const branchSha = await git.resolveRef({ fs, dir: repoPath, ref: branch })
    if (branchSha === parentSha) {
      branchesAtParent.push(branch)
    }
  }

  // Prioritize trunk-like branches
  const trunkCandidates = ['main', 'master', 'trunk', 'develop']
  const bestParentBranch =
    branchesAtParent.find((b) => trunkCandidates.includes(b)) || branchesAtParent[0]

  if (bestParentBranch) {
    targetRef = `ref: refs/heads/${bestParentBranch}`
  }

  // 5. Move HEAD (Soft Reset equivalent)
  const gitDir = path.join(repoPath, '.git')

  let shouldUpdateHead = false
  if (isDetached) {
    const currentHead = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    if (currentHead === commitSha) {
      shouldUpdateHead = true
    }
  } else if (currentBranch && branchesToDelete.includes(currentBranch)) {
    shouldUpdateHead = true
  }

  if (shouldUpdateHead) {
    if (targetRef.startsWith('ref: ')) {
      const refContent = targetRef + '\n'
      await fs.promises.writeFile(path.join(gitDir, 'HEAD'), refContent)
    } else {
      await fs.promises.writeFile(path.join(gitDir, 'HEAD'), targetRef + '\n')
    }
  }

  // 6. Delete the branches that were pointing to the child commit
  for (const branch of branchesToDelete) {
    if (bestParentBranch && branch === bestParentBranch) continue
    await deleteBranch(repoPath, branch)
  }
}
