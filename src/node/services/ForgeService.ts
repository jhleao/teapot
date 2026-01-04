/**
 * ForgeService - Git forge (GitHub) integration service
 *
 * This service manages connections to Git forges (currently GitHub) and provides
 * methods for interacting with pull requests and remote branches.
 */

import { log } from '@shared/logger'
import { ForgeStateResult, MergeStrategy } from '@shared/types/git-forge'
import { GitForgeClient, GitHubAdapter } from '../adapters/forge'
import { getGitAdapter } from '../adapters/git'
import { configStore } from '../store'

/** Default result when no forge client is available */
const NO_CLIENT_RESULT: ForgeStateResult = {
  state: { pullRequests: [] },
  status: 'idle',
  error: undefined,
  lastSuccessfulFetch: undefined
}

export class GitForgeService {
  private clients = new Map<string, GitForgeClient>()

  async getClient(repoPath: string): Promise<GitForgeClient | null> {
    const pat = configStore.getGithubPat()
    if (!pat) {
      return null
    }

    if (this.clients.has(repoPath)) {
      return this.clients.get(repoPath)!
    }

    const git = getGitAdapter()
    let remotes: { name: string; url: string }[] = []
    try {
      remotes = await git.listRemotes(repoPath)
    } catch (e) {
      log.error('Failed to list remotes:', e)
      return null
    }

    if (remotes.length === 0) {
      return null
    }

    const origin = remotes.find((r) => r.name === 'origin') || remotes[0]
    if (!origin) return null

    const { owner, repo } = this.parseRemoteUrl(origin.url)
    if (!owner || !repo) {
      return null
    }

    const adapter = new GitHubAdapter(pat, owner, repo)
    const client = new GitForgeClient(adapter)
    this.clients.set(repoPath, client)
    return client
  }

  private parseRemoteUrl(url: string): { owner: string | null; repo: string | null } {
    // Supported formats:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo

    try {
      let cleanUrl = url
      if (cleanUrl.endsWith('.git')) {
        cleanUrl = cleanUrl.slice(0, -4)
      }

      const parts = cleanUrl.split(/[:/]/)
      if (parts.length < 2) return { owner: null, repo: null }

      const repo = parts.pop()!
      const owner = parts.pop()!

      return { owner, repo }
    } catch {
      return { owner: null, repo: null }
    }
  }

  /**
   * Returns forge state with status metadata for UI feedback.
   * Use this method for new code that needs loading/error states.
   */
  async getStateWithStatus(repoPath: string): Promise<ForgeStateResult> {
    const client = await this.getClient(repoPath)
    if (!client) {
      return NO_CLIENT_RESULT
    }
    return client.getStateWithStatus()
  }

  async createPullRequest(
    repoPath: string,
    title: string,
    headBranch: string,
    baseBranch: string,
    draft?: boolean
  ): Promise<void> {
    const client = await this.getClient(repoPath)
    if (!client) {
      const pat = configStore.getGithubPat()
      if (!pat) {
        throw new Error(
          'No GitHub Personal Access Token (PAT) configured. Please configure your GitHub PAT in settings to create pull requests.'
        )
      }

      // If we have a PAT but no client, check remotes
      const git = getGitAdapter()
      try {
        const remotes = await git.listRemotes(repoPath)
        if (remotes.length === 0) {
          throw new Error('No git remotes found. Please add a remote to create pull requests.')
        }

        const origin = remotes.find((r) => r.name === 'origin') || remotes[0]
        const { owner, repo } = this.parseRemoteUrl(origin.url)
        if (!owner || !repo) {
          throw new Error(
            `Could not parse GitHub repository from remote URL: ${origin.url}. Expected format: https://github.com/owner/repo.git or git@github.com:owner/repo.git`
          )
        }
      } catch (error) {
        log.error('Failed to get git forge client:', error)
        throw error
      }

      throw new Error('No git forge client available')
    }
    await client.createPullRequest(title, headBranch, baseBranch, draft)
  }

  async closePullRequest(repoPath: string, number: number): Promise<void> {
    const client = await this.getClient(repoPath)
    if (client) {
      await client.closePullRequest(number)
    }
  }

  async refreshWithStatus(repoPath: string): Promise<ForgeStateResult> {
    const client = await this.getClient(repoPath)
    if (!client) {
      return NO_CLIENT_RESULT
    }
    return client.refreshWithStatus()
  }

  /**
   * Deletes a branch from the remote repository.
   *
   * Gracefully handles the case where no forge client is available (no PAT configured,
   * no remote, etc.) - in that case, this is a no-op and returns without error.
   */
  async deleteRemoteBranch(repoPath: string, branchName: string): Promise<void> {
    const client = await this.getClient(repoPath)
    if (client) {
      await client.deleteRemoteBranch(branchName)
    }
    // If no client (no PAT, no remote), silently skip remote deletion
  }

  /**
   * Merges a pull request using the specified merge strategy.
   *
   * @throws Error if no PAT configured or merge fails
   */
  async mergePullRequest(repoPath: string, number: number, strategy: MergeStrategy): Promise<void> {
    const client = await this.getClient(repoPath)
    if (!client) {
      throw new Error('No GitHub client available. Please configure your GitHub PAT in settings.')
    }
    await client.mergePullRequest(number, strategy)
  }

  invalidateCache(repoPath: string) {
    this.clients.delete(repoPath)
  }

  invalidateAll() {
    this.clients.clear()
  }
}

export const gitForgeService = new GitForgeService()
