import fs from 'fs'
import git from 'isomorphic-git'
import { GitForgeState } from '../../../shared/types/git-forge'
import { configStore } from '../../store'
import { GitHubAdapter } from './adapters/github'
import { GitForgeClient } from './git-forge'
import { log } from '@shared/logger'

export class GitForgeService {
  private clients = new Map<string, GitForgeClient>()

  async getClient(repoPath: string): Promise<GitForgeClient | null> {
    const pat = configStore.getGithubPat()
    if (!pat) {
      // If no PAT, we can't do anything. Clear any existing client if we want to be strict,
      // but for now let's just return null.
      return null
    }

    // If we have a client and the PAT hasn't changed, return it.
    // However, if the PAT *changes*, we should probably recreate the client.
    // Since we don't easily know if the PAT changed without checking store every time,
    // let's assume checking store is cheap (it's in-memory).
    // But the client holds the adapter which holds the PAT.
    // We should probably cache the PAT used to create the client.

    // For simplicity: if we have a cached client, use it.
    // Ideally, we'd listen for config changes to invalidate the cache.
    // Given the constraints, let's just check if we have one.
    // If the user updates the PAT, they might need to restart or we need a way to clear cache.
    // Let's add a `clearCache` method or similar if needed later.

    if (this.clients.has(repoPath)) {
      // We might want to check if the PAT inside the adapter matches the current PAT,
      // but the adapter encapsulates it.
      // Let's blindly trust the cache for now.
      return this.clients.get(repoPath)!
    }

    // Determine owner/repo from remotes
    // We'll prioritize 'origin', then the first remote
    let remotes: { remote: string; url: string }[] = []
    try {
      remotes = await git.listRemotes({ fs, dir: repoPath })
    } catch (e) {
      log.error('Failed to list remotes:', e)
      return null
    }

    if (remotes.length === 0) {
      return null
    }

    const origin = remotes.find((r) => r.remote === 'origin') || remotes[0]
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

  async getState(repoPath: string): Promise<GitForgeState> {
    const client = await this.getClient(repoPath)
    if (!client) {
      return { pullRequests: [] }
    }
    return client.getState()
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

  invalidateCache(repoPath: string) {
    this.clients.delete(repoPath)
  }

  invalidateAll() {
    this.clients.clear()
  }
}

export const gitForgeService = new GitForgeService()
