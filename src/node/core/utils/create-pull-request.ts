import { log } from '@shared/logger'
import fs from 'fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { configStore } from '../../store'
import { gitForgeService } from '../forge/service'
import { buildRepoModel } from './build-repo'
import { findBaseBranch } from './find-base-branch'

export async function createPullRequest(repoPath: string, headBranch: string): Promise<void> {
  log.debug(
    `[createPullRequest] Starting PR creation for branch: ${headBranch} in repo: ${repoPath}`
  )

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

  // Get configured remote URL to check if we need to transform SSH to HTTPS
  log.debug(`[createPullRequest] Listing remotes...`)
  const remotes = await git.listRemotes({ fs, dir: repoPath })
  log.debug(
    `[createPullRequest] Found ${remotes.length} remotes:`,
    remotes.map((r) => `${r.remote}=${r.url}`)
  )
  const origin = remotes.find((r) => r.remote === 'origin')

  let remoteUrl = origin?.url
  if (remoteUrl && remoteUrl.startsWith('git@')) {
    // Convert SSH URL to HTTPS for isomorphic-git compatibility with PAT
    // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
    log.debug(`[createPullRequest] Converting SSH URL to HTTPS: ${remoteUrl}`)
    remoteUrl = remoteUrl.replace(/^git@([^:]+):/, 'https://$1/')
    log.debug(`[createPullRequest] Converted URL: ${remoteUrl}`)
  } else if (remoteUrl) {
    log.debug(`[createPullRequest] Using remote URL: ${remoteUrl}`)
  } else {
    log.warn(`[createPullRequest] No origin remote found`)
  }

  // Retrieve PAT for authentication
  const pat = configStore.getGithubPat()
  log.debug(`[createPullRequest] PAT configured: ${pat ? 'yes' : 'no'}`)

  // Ensure the head branch is pushed to origin before creating PR
  log.debug(`[createPullRequest] Pushing branch ${headBranch} to origin...`)
  try {
    await git.push({
      fs,
      http,
      dir: repoPath,
      remote: 'origin',
      ref: headBranch,
      url: remoteUrl, // Use explicit URL which might be force-converted to HTTPS
      onAuth: () => ({ username: pat || '' })
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
