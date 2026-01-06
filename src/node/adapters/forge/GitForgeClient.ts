import { log } from '@shared/logger'
import {
  ForgeStateResult,
  ForgeStatus,
  GitForgeAdapter,
  GitForgeState,
  MergeStrategy
} from '@shared/types/git-forge'

// Re-exporting shared types here for convenience if needed by consumers in node/
export type { ForgeStateResult, ForgeStatus, GitForgeAdapter, GitForgeState, MergeStrategy }

/**
 * This class handles caching and periodic fetching of the forge state.
 * It acts as a middleware between the raw adapter and the application state.
 *
 * Key behaviors:
 * - Caches state with a 10-second TTL to reduce API calls
 * - Returns stale state on error to maintain UI continuity
 * - Tracks fetch status for UI feedback (loading/error indicators)
 * - On error, schedules retry sooner than normal TTL
 */
export class GitForgeClient {
  private state: GitForgeState = { pullRequests: [] }
  private lastFetchTime = 0
  private lastSuccessfulFetch = 0
  private status: ForgeStatus = 'idle'
  private lastError?: string
  private readonly CACHE_TTL_MS = 3_000 // 3 seconds - faster updates for status checks
  private readonly ERROR_RETRY_MS = 2_000 // Retry sooner after error

  constructor(private readonly adapter: GitForgeAdapter) {}

  /**
   * Returns the current forge state with status metadata.
   * Fetches fresh data if cache is expired, otherwise returns cached state.
   * On error, returns stale state with error status for graceful degradation.
   */
  async getStateWithStatus(): Promise<ForgeStateResult> {
    const now = Date.now()

    if (now - this.lastFetchTime > this.CACHE_TTL_MS) {
      this.status = 'fetching'
      this.lastFetchTime = now

      try {
        this.state = await this.adapter.fetchState()
        this.lastSuccessfulFetch = now
        this.status = 'success'
        this.lastError = undefined
      } catch (error) {
        this.status = 'error'
        this.lastError = error instanceof Error ? error.message : String(error)
        log.error('Failed to fetch git forge state:', error)
        // Schedule earlier retry by adjusting lastFetchTime
        this.lastFetchTime = now - this.CACHE_TTL_MS + this.ERROR_RETRY_MS
      }
    }

    return {
      state: this.state,
      status: this.status,
      error: this.lastError,
      lastSuccessfulFetch: this.lastSuccessfulFetch || undefined
    }
  }

  /**
   * Forces a refresh of the forge state, bypassing the cache.
   * Returns state with status metadata.
   */
  async refreshWithStatus(): Promise<ForgeStateResult> {
    this.lastFetchTime = 0
    return this.getStateWithStatus()
  }

  async createPullRequest(
    title: string,
    headBranch: string,
    baseBranch: string,
    draft?: boolean
  ): Promise<ForgeStateResult> {
    await this.adapter.createPullRequest(title, headBranch, baseBranch, draft)
    // Immediately refresh state to include the new PR
    return this.refreshWithStatus()
  }

  async closePullRequest(number: number): Promise<ForgeStateResult> {
    await this.adapter.closePullRequest(number)
    return this.refreshWithStatus()
  }

  async deleteRemoteBranch(branchName: string): Promise<void> {
    await this.adapter.deleteRemoteBranch(branchName)
  }

  /**
   * Merges a pull request using the specified merge strategy.
   * After merging, refreshes the state to reflect the merged status.
   */
  async mergePullRequest(number: number, strategy: MergeStrategy): Promise<ForgeStateResult> {
    await this.adapter.mergePullRequest(number, strategy)
    return this.refreshWithStatus()
  }
}
