import fs from 'fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { configStore } from '../../store'
import { gitForgeService } from '../forge/service'
import { buildRepoModel } from './build-repo'
import { findBaseBranch } from './find-base-branch'

export async function createPullRequest(repoPath: string, headBranch: string): Promise<void> {
  console.log(
    `[createPullRequest] Starting PR creation for branch: ${headBranch} in repo: ${repoPath}`
  )

  // We need the repo model to find the base branch and commit message
  console.log(`[createPullRequest] Building repo model...`)
  const repo = await buildRepoModel({ repoPath })
  console.log(
    `[createPullRequest] Repo model built: ${repo.branches.length} branches, ${repo.commits.length} commits`
  )

  const headBranchObj = repo.branches.find((b) => b.ref === headBranch)
  if (!headBranchObj) {
    console.error(
      `[createPullRequest] Branch ${headBranch} not found. Available branches:`,
      repo.branches.map((b) => b.ref)
    )
    throw new Error(`Branch ${headBranch} not found`)
  }
  console.log(
    `[createPullRequest] Found head branch: ${headBranch} (SHA: ${headBranchObj.headSha})`
  )

  const headCommit = repo.commits.find((c) => c.sha === headBranchObj.headSha)
  if (!headCommit) {
    console.error(`[createPullRequest] Commit ${headBranchObj.headSha} not found`)
    throw new Error(`Commit ${headBranchObj.headSha} not found`)
  }
  console.log(
    `[createPullRequest] Found head commit: ${headCommit.sha.substring(0, 7)} (parent: ${headCommit.parentSha.substring(0, 7)})`
  )

  const title = headCommit.message.split('\n')[0] || 'No title'
  console.log(`[createPullRequest] PR title: ${title}`)

  // Find base branch by traversing up the parents
  console.log(`[createPullRequest] Finding base branch...`)
  const baseBranch = findBaseBranch(repo, headCommit.sha)
  console.log(`[createPullRequest] Base branch determined: ${baseBranch}`)

  // Get configured remote URL to check if we need to transform SSH to HTTPS
  console.log(`[createPullRequest] Listing remotes...`)
  const remotes = await git.listRemotes({ fs, dir: repoPath })
  console.log(
    `[createPullRequest] Found ${remotes.length} remotes:`,
    remotes.map((r) => `${r.remote}=${r.url}`)
  )
  const origin = remotes.find((r) => r.remote === 'origin')

  let remoteUrl = origin?.url
  if (remoteUrl && remoteUrl.startsWith('git@')) {
    // Convert SSH URL to HTTPS for isomorphic-git compatibility with PAT
    // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
    console.log(`[createPullRequest] Converting SSH URL to HTTPS: ${remoteUrl}`)
    remoteUrl = remoteUrl.replace(/^git@([^:]+):/, 'https://$1/')
    console.log(`[createPullRequest] Converted URL: ${remoteUrl}`)
  } else if (remoteUrl) {
    console.log(`[createPullRequest] Using remote URL: ${remoteUrl}`)
  } else {
    console.warn(`[createPullRequest] No origin remote found`)
  }

  // Retrieve PAT for authentication
  const pat = configStore.getGithubPat()
  console.log(`[createPullRequest] PAT configured: ${pat ? 'yes' : 'no'}`)

  // Ensure the head branch is pushed to origin before creating PR
  console.log(`[createPullRequest] Pushing branch ${headBranch} to origin...`)
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
    console.log(`[createPullRequest] Successfully pushed branch ${headBranch}`)
  } catch (error) {
    console.error(
      `[createPullRequest] Failed to push branch ${headBranch} before creating PR:`,
      error
    )
    throw new Error(
      `Failed to push branch ${headBranch}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  console.log(
    `[createPullRequest] Creating pull request: "${title}" (${headBranch} -> ${baseBranch})`
  )
  await gitForgeService.createPullRequest(repoPath, title, headBranch, baseBranch, false)
  console.log(`[createPullRequest] Successfully created pull request`)
}
