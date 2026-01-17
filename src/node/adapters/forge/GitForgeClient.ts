import { log } from '@shared/logger'
import {
  ForgeStateResult,
  ForgeStatus,
  GitForgeAdapter,
  GitForgeState,
  MergeStrategy,
  RateLimitInfo
} from '@shared/types/git-forge'
import { configStore } from '../../store'
import type { GitForgeStateWithRateLimit } from './github/GitHubAdapter'

// Re-exporting shared types here for convenience if needed by consumers in node/
export type { ForgeStateResult, ForgeStatus, GitForgeAdapter, GitForgeState, MergeStrategy }

/**
 * This class handles caching and periodic fetching of the forge state.
 * It acts as a middleware between the raw adapter and the application state.
 *
 * Key behaviors:
 * - Caches state with a 15-second in-memory TTL to reduce API calls
 * - Persists cache to disk for instant startup (with debounced writes)
 * - Returns stale state on error to maintain UI continuity
 * - Tracks fetch status for UI feedback (loading/error indicators)
 * - On error, schedules retry sooner than normal TTL
 * - Deduplicates concurrent requests (returns same promise for in-flight requests)
 */
export class GitForgeClient {
  private state: GitForgeState = { pullRequests: [] }
  private lastFetchTime = 0
  private lastSuccessfulFetch = 0
  private status: ForgeStatus = 'idle'
  private lastError?: string
  private rateLimit?: RateLimitInfo
  private readonly CACHE_TTL_MS = 15_000 // 15 seconds - balance between freshness and rate limiting
  private readonly ERROR_RETRY_MS = 2_000 // Retry sooner after error
  private readonly DEBOUNCE_WRITE_MS = 2_000 // Debounce disk writes
  private readonly TRANSIENT_RETRY_COUNT = 2 // Number of immediate retries for transient errors
  private readonly TRANSIENT_RETRY_DELAY_MS = 500 // Delay between transient retries
  private pendingCacheWrite: ReturnType<typeof setTimeout> | null = null
  private repoPath: string | null = null
  /** In-flight request promise for deduplication */
  private inFlightRequest: Promise<ForgeStateResult> | null = null

  constructor(private readonly adapter: GitForgeAdapter) {}

  /**
   * Set the repository path for persistent cache operations.
   * Must be called before using getStateWithStatus for cache persistence to work.
   */
  setRepoPath(path: string): void {
    this.repoPath = path

    // Load cached state from disk on initialization
    const cached = configStore.getCachedForgeState(path)
    if (cached) {
      this.state = cached.state
      this.lastSuccessfulFetch = cached.timestamp
      this.status = 'success'
      log.info(
        `[GitForgeClient] Loaded cached state for ${path} from ${new Date(cached.timestamp).toISOString()}`
      )
    }
  }

  /**
   * Returns the current forge state with status metadata.
   * Fetches fresh data if cache is expired, otherwise returns cached state.
   * On error, returns stale state with error status for graceful degradation.
   * Transient errors (network issues, 5xx) are immediately retried before giving up.
   *
   * Request deduplication: If a request is already in flight, returns the same promise.
   */
  async getStateWithStatus(): Promise<ForgeStateResult> {
    // If there's already a request in flight, reuse it (deduplication)
    // Check this FIRST to avoid race conditions where lastFetchTime is already updated
    if (this.inFlightRequest) {
      return this.inFlightRequest
    }

    const now = Date.now()

    // If cache is still valid, return immediately
    if (now - this.lastFetchTime <= this.CACHE_TTL_MS) {
      return this.buildResult()
    }

    // Start a new fetch
    this.inFlightRequest = this.performFetch()

    try {
      return await this.inFlightRequest
    } finally {
      this.inFlightRequest = null
    }
  }

  /**
   * Performs the actual fetch operation.
   */
  private async performFetch(): Promise<ForgeStateResult> {
    this.status = 'fetching'
    this.lastFetchTime = Date.now()

    try {
      const result = await this.fetchWithRetry()
      this.state = result
      this.lastSuccessfulFetch = Date.now()
      this.status = 'success'
      this.lastError = undefined

      // Extract rate limit info if available
      if ('rateLimit' in result) {
        this.rateLimit = (result as GitForgeStateWithRateLimit).rateLimit
      }

      // Persist to disk cache (debounced)
      this.scheduleCacheWrite()
    } catch (error) {
      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      log.error('Failed to fetch git forge state:', error)
      // Schedule earlier retry by adjusting lastFetchTime
      this.lastFetchTime = Date.now() - this.CACHE_TTL_MS + this.ERROR_RETRY_MS
    }

    return this.buildResult()
  }

  /**
   * Builds the ForgeStateResult from current state.
   */
  private buildResult(): ForgeStateResult {
    return {
      state: this.state,
      status: this.status,
      error: this.lastError,
      lastSuccessfulFetch: this.lastSuccessfulFetch || undefined,
      rateLimit: this.rateLimit
    }
  }

  /**
   * Fetches state with immediate retries for transient errors.
   * Transient errors include network issues (timeout, connection reset) and 5xx server errors.
   */
  private async fetchWithRetry(): Promise<GitForgeState> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.TRANSIENT_RETRY_COUNT; attempt++) {
      try {
        return await this.adapter.fetchState()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if this is a transient error worth retrying
        if (!this.isTransientError(lastError)) {
          throw lastError
        }

        // Don't retry after the last attempt
        if (attempt < this.TRANSIENT_RETRY_COUNT) {
          log.warn(
            `[GitForgeClient] Transient error (attempt ${attempt + 1}/${this.TRANSIENT_RETRY_COUNT + 1}): ${lastError.message}. Retrying...`
          )
          await this.delay(this.TRANSIENT_RETRY_DELAY_MS)
        }
      }
    }

    throw lastError!
  }

  /**
   * Determines if an error is transient and worth retrying immediately.
   */
  private isTransientError(error: Error): boolean {
    const message = error.message.toLowerCase()

    // Network errors
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('socket hang up') ||
      message.includes('network')
    ) {
      return true
    }

    // Server errors (5xx)
    if (
      message.includes('status 5') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    ) {
      return true
    }

    return false
  }

  /**
   * Simple delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Schedules a debounced write of the current state to disk cache.
   * This prevents frequent disk I/O when multiple fetches happen in quick succession.
   */
  private scheduleCacheWrite(): void {
    if (!this.repoPath) return

    // Clear any pending write
    if (this.pendingCacheWrite) {
      clearTimeout(this.pendingCacheWrite)
    }

    // Schedule new write
    this.pendingCacheWrite = setTimeout(() => {
      if (this.repoPath && this.state.pullRequests.length > 0) {
        configStore.setCachedForgeState(this.repoPath, this.state)
        log.debug(`[GitForgeClient] Persisted cache for ${this.repoPath}`)
      }
      this.pendingCacheWrite = null
    }, this.DEBOUNCE_WRITE_MS)
  }

  /**
   * Flushes any pending cache write immediately.
   * Call this before the client is destroyed to ensure data is persisted.
   */
  flushCache(): void {
    if (this.pendingCacheWrite) {
      clearTimeout(this.pendingCacheWrite)
      this.pendingCacheWrite = null
    }
    if (this.repoPath && this.state.pullRequests.length > 0) {
      configStore.setCachedForgeState(this.repoPath, this.state)
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

  /**
   * Updates a pull request's base branch.
   * Used when a branch has been rebased onto a different base.
   */
  async updatePullRequestBase(number: number, baseBranch: string): Promise<ForgeStateResult> {
    await this.adapter.updatePullRequestBase(number, baseBranch)
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
