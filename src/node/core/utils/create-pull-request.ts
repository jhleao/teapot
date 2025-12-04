import { log } from '@shared/logger'
import { configStore } from '../../store'
import { getGitAdapter } from '../git-adapter'
import { gitForgeService } from '../forge/service'
import { buildRepoModel } from './build-repo'
import { findBaseBranch } from './find-base-branch'

export async function createPullRequest(repoPath: string, headBranch: string): Promise<void> {
  log.debug(
    `[createPullRequest] Starting PR creation for branch: ${headBranch} in repo: ${repoPath}`
  )

  const git = getGitAdapter()

  // We need the repo model to find the base branch and commit message
  log.debug(`[createPullRequest] Building repo model...`)
  const repo = await buildRepoModel({ repoPath })
  log.debug(
    `[createPullRequest] Repo model built: ${repo.branches.length} branches, ${repo.commits.length} commits`
  )

  const headBranchObj = repo.branches.find((b) => b.ref === headBranch)
  if (!headBranchObj) {
    log.error(
      `[createPullRequest] Branch ${headBranch} not found. Available branches:`,
      repo.branches.map((b) => b.ref)
    )
    throw new Error(`Branch ${headBranch} not found`)
  }
  log.debug(`[createPullRequest] Found head branch: ${headBranch} (SHA: ${headBranchObj.headSha})`)

  const headCommit = repo.commits.find((c) => c.sha === headBranchObj.headSha)
  if (!headCommit) {
    log.error(`[createPullRequest] Commit ${headBranchObj.headSha} not found`)
    throw new Error(`Commit ${headBranchObj.headSha} not found`)
  }
  log.debug(
    `[createPullRequest] Found head commit: ${headCommit.sha.substring(0, 7)} (parent: ${headCommit.parentSha.substring(0, 7)})`
  )

  const title = headCommit.message.split('\n')[0] || 'No title'
  log.debug(`[createPullRequest] PR title: ${title}`)

  // Find base branch by traversing up the parents
  log.debug(`[createPullRequest] Finding base branch...`)
  const baseBranch = findBaseBranch(repo, headCommit.sha)
  log.debug(`[createPullRequest] Base branch determined: ${baseBranch}`)

  // Get configured remote URL
  log.debug(`[createPullRequest] Listing remotes...`)
  const remotes = await git.listRemotes(repoPath)
  log.debug(
    `[createPullRequest] Found ${remotes.length} remotes:`,
    remotes.map((r) => `${r.name}=${r.url}`)
  )
  const origin = remotes.find((r) => r.name === 'origin')

  if (!origin) {
    log.warn(`[createPullRequest] No origin remote found`)
    throw new Error('No origin remote configured')
  }

  // Retrieve PAT for authentication
  const pat = configStore.getGithubPat()
  log.debug(`[createPullRequest] PAT configured: ${pat ? 'yes' : 'no'}`)

  // Ensure the head branch is pushed to origin before creating PR
  log.debug(`[createPullRequest] Pushing branch ${headBranch} to origin...`)
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
    log.debug(`[createPullRequest] Successfully pushed branch ${headBranch}`)
  } catch (error) {
    log.error(`[createPullRequest] Failed to push branch ${headBranch} before creating PR:`, error)
    throw new Error(
      `Failed to push branch ${headBranch}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  log.debug(
    `[createPullRequest] Creating pull request: "${title}" (${headBranch} -> ${baseBranch})`
  )
  await gitForgeService.createPullRequest(repoPath, title, headBranch, baseBranch, false)
  log.debug(`[createPullRequest] Successfully created pull request`)
}
