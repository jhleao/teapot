import { log } from '@shared/logger'
import { configStore } from '../../store'
import { getGitAdapter } from '../git-adapter'
import { gitForgeService } from '../forge/service'
import { buildRepoModel } from './build-repo'
import { findBaseBranch } from './find-base-branch'

export async function createPullRequest(repoPath: string, headBranch: string): Promise<void> {
  const git = getGitAdapter()

  // We need the repo model to find the base branch and commit message
  const repo = await buildRepoModel({ repoPath })

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
  const baseBranch = findBaseBranch(repo, headCommit.sha)

  // Get configured remote URL
  const remotes = await git.listRemotes(repoPath)
  const origin = remotes.find((r) => r.name === 'origin')

  if (!origin) {
    log.warn('No origin remote found')
    throw new Error('No origin remote configured')
  }

  // Retrieve PAT for authentication
  const pat = configStore.getGithubPat()

  // Ensure the head branch is pushed to origin before creating PR
  try {
    // simple-git uses system Git credentials automatically
    // If PAT is needed, user should configure it in Git credential helper
    await git.push(repoPath, {
      remote: 'origin',
      ref: headBranch,
      setUpstream: true,
      credentials: pat
        ? {
            username: pat,
            password: '' // PAT as username for HTTPS auth
          }
        : undefined
    })
  } catch (error) {
    log.error(`Failed to push branch ${headBranch} before creating PR:`, error)
    throw new Error(
      `Failed to push branch ${headBranch}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  await gitForgeService.createPullRequest(repoPath, title, headBranch, baseBranch, false)
}
