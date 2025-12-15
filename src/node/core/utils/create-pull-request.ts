import { log } from '@shared/logger'
import { isTrunk } from '@shared/types/repo'
import { configStore } from '../../store'
import { gitForgeService } from '../forge/service'
import { getGitAdapter } from '../git-adapter'
import { buildRepoModel } from './build-repo'
import { detectMergedBranches } from './detect-merged-branches'
import { findBaseBranch } from './find-base-branch'
import { findValidPrTarget } from './find-valid-pr-target'

export async function createPullRequest(repoPath: string, headBranch: string): Promise<void> {
  const git = getGitAdapter()

  // We need the repo model to find the base branch and commit message
  // Load remotes to check if base branch already exists on origin
  const repo = await buildRepoModel({ repoPath }, { loadRemotes: true })

  const headBranchObj = repo.branches.find((b) => b.ref === headBranch)
  if (!headBranchObj) {
    log.error(
      `Branch ${headBranch} not found. Available branches:`,
      repo.branches.map((b) => b.ref)
    )
    throw new Error(`Branch ${headBranch} not found`)
  }

  const headCommit = repo.commits.find((c) => c.sha === headBranchObj.headSha)
  if (!headCommit) {
    log.error(`Commit ${headBranchObj.headSha} not found`)
    throw new Error(`Commit ${headBranchObj.headSha} not found`)
  }

  const title = headCommit.message.split('\n')[0] || 'No title'

  // Find base branch by traversing up the parents
  const candidateBaseBranch = findBaseBranch(repo, headCommit.sha)

  // Get merged branches to skip them as targets
  const trunkBranch = repo.branches.find((b) => b.isTrunk && !b.isRemote)
  const trunkRef = trunkBranch?.ref ?? 'main'
  const mergedBranchNames = await detectMergedBranches(repoPath, repo.branches, trunkRef, git)

  // Get forge state to check existing PRs
  const forgeState = await gitForgeService.getState(repoPath)

  // Find a valid target (skipping merged branches)
  const baseBranch = findValidPrTarget(
    headBranch,
    candidateBaseBranch,
    forgeState.pullRequests,
    new Set(mergedBranchNames)
  )

  // Get configured remote URL
  const remotes = await git.listRemotes(repoPath)
  const origin = remotes.find((r) => r.name === 'origin')

  if (!origin) {
    log.warn('No origin remote found')
    throw new Error('No origin remote configured')
  }

  // Retrieve PAT for authentication
  const pat = configStore.getGithubPat()
  const credentials = pat ? { username: pat, password: '' } : undefined

  // Push branches to origin before creating PR
  // For mid-stack PRs, the base branch must also exist on remote
  const baseBranchExistsOnRemote =
    isTrunk(baseBranch) || repo.branches.some((b) => b.isRemote && b.ref === `origin/${baseBranch}`)

  const branchesToPush = baseBranchExistsOnRemote ? [headBranch] : [baseBranch, headBranch]

  for (const branch of branchesToPush) {
    try {
      await git.push(repoPath, {
        remote: 'origin',
        ref: branch,
        setUpstream: true,
        credentials
      })
    } catch (error) {
      log.error(`Failed to push branch ${branch} before creating PR:`, error)
      throw new Error(
        `Failed to push branch ${branch}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  await gitForgeService.createPullRequest(repoPath, title, headBranch, baseBranch, false)
}
