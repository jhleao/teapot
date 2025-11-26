import { GitForgeAdapter, GitForgeState } from '../../../shared/types/git-forge'

// Re-exporting shared types here for convenience if needed by consumers in node/
export type { GitForgeAdapter, GitForgeState }

/**
 * This class handles caching and periodic fetching of the forge state.
 * It acts as a middleware between the raw adapter and the application state.
 */
export class GitForgeClient {
  private state: GitForgeState = { pullRequests: [] }
  private lastFetchTime = 0
  private readonly CACHE_TTL_MS = 10000 // 10 seconds

  constructor(private readonly adapter: GitForgeAdapter) {}

  async getState(): Promise<GitForgeState> {
    const now = Date.now()
    if (now - this.lastFetchTime > this.CACHE_TTL_MS) {
      try {
        this.state = await this.adapter.fetchState()
        this.lastFetchTime = now
      } catch (error) {
        console.error('Failed to fetch git forge state:', error)
        // Return stale state on error to prevent UI flicker
      }
    }
    return this.state
  }

  // Method to force refresh if needed (e.g. user clicks "refresh")
  async refresh(): Promise<GitForgeState> {
    this.lastFetchTime = 0
    return this.getState()
  }

  async createPullRequest(
    title: string,
    headBranch: string,
    baseBranch: string,
    draft?: boolean
  ): Promise<GitForgeState> {
    await this.adapter.createPullRequest(title, headBranch, baseBranch, draft)
    // Immediately refresh state to include the new PR
    return this.refresh()
  }

  async closePullRequest(number: number): Promise<GitForgeState> {
    await this.adapter.closePullRequest(number)
    return this.refresh()
  }
}
