import type { GitForgeAdapter, GitForgeState } from '@shared/types/git-forge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configStore } from '../../../store'
import { GitForgeClient } from '../GitForgeClient'

// Mock the config store
vi.mock('../../../store', () => ({
  configStore: {
    getCachedForgeState: vi.fn(),
    setCachedForgeState: vi.fn(),
    clearCachedForgeState: vi.fn()
  }
}))

describe('GitForgeClient', () => {
  let mockAdapter: GitForgeAdapter
  let client: GitForgeClient

  const mockState: GitForgeState = {
    pullRequests: [
      {
        number: 1,
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/1',
        state: 'open',
        headRefName: 'feature-branch',
        baseRefName: 'main',
        headSha: 'abc123',
        isMergeable: true,
        createdAt: '2024-01-01T00:00:00Z'
      }
    ]
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockAdapter = {
      fetchState: vi.fn().mockResolvedValue(mockState),
      createPullRequest: vi.fn(),
      closePullRequest: vi.fn(),
      updatePullRequestBase: vi.fn(),
      deleteRemoteBranch: vi.fn(),
      mergePullRequest: vi.fn(),
      fetchPrDetails: vi.fn()
    }
    client = new GitForgeClient(mockAdapter)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('getStateWithStatus', () => {
    it('should return idle status on first call before fetch completes', async () => {
      // First call triggers fetch
      const resultPromise = client.getStateWithStatus()

      // Before resolution, status should be 'fetching'
      const result = await resultPromise
      expect(result.status).toBe('success')
      expect(result.state).toEqual(mockState)
      expect(result.error).toBeUndefined()
    })

    it('should return cached state within TTL', async () => {
      // First call
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)

      // Second call within TTL (15s)
      vi.advanceTimersByTime(10000)
      const result = await client.getStateWithStatus()

      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1) // Not called again
      expect(result.status).toBe('success')
      expect(result.state).toEqual(mockState)
    })

    it('should refetch after TTL expires', async () => {
      // First call
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)

      // Advance past TTL (15s)
      vi.advanceTimersByTime(16000)
      await client.getStateWithStatus()

      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2)
    })

    it('should return error status and stale state on fetch failure', async () => {
      // First successful call
      await client.getStateWithStatus()

      // Setup failure for next call - using non-transient error (won't retry)
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(new Error('Authentication failed'))

      // Advance past TTL (15s)
      vi.advanceTimersByTime(16000)
      const result = await client.getStateWithStatus()

      expect(result.status).toBe('error')
      expect(result.error).toBe('Authentication failed')
      expect(result.state).toEqual(mockState) // Stale state preserved
    })

    it('should retry sooner after error (2s instead of 15s)', async () => {
      // First successful call
      await client.getStateWithStatus()

      // Setup failure - using non-transient error (won't retry)
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(new Error('Auth error'))

      // Advance past TTL (15s) to trigger error
      vi.advanceTimersByTime(16000)
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2)

      // Advance 1s - should NOT retry yet (error retry is 2s)
      vi.advanceTimersByTime(1000)
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2) // Still 2

      // Advance 2 more seconds (total 3s since error) - should retry now
      vi.advanceTimersByTime(2000)
      await client.getStateWithStatus()

      // Should have retried
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(3)
    })

    it('should track lastSuccessfulFetch timestamp', async () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const result = await client.getStateWithStatus()

      expect(result.lastSuccessfulFetch).toBe(new Date('2024-01-15T10:00:00Z').getTime())
    })

    it('should preserve lastSuccessfulFetch on error', async () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      await client.getStateWithStatus()

      // Use non-transient error (won't retry)
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(new Error('Auth failed'))
      vi.advanceTimersByTime(16000) // Past TTL (15s)

      const result = await client.getStateWithStatus()

      expect(result.status).toBe('error')
      expect(result.lastSuccessfulFetch).toBe(new Date('2024-01-15T10:00:00Z').getTime())
    })
  })

  describe('refreshWithStatus', () => {
    it('should bypass cache and fetch fresh data', async () => {
      // First call
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)

      // Immediately refresh (within TTL)
      await client.refreshWithStatus()

      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2)
    })
  })

  describe('transient error retry', () => {
    it('should retry on network timeout errors', async () => {
      // First call fails with timeout, second succeeds
      vi.mocked(mockAdapter.fetchState)
        .mockRejectedValueOnce(new Error('Request timeout'))
        .mockRejectedValueOnce(new Error('Request timeout'))
        .mockResolvedValueOnce(mockState)

      // Start the fetch - it will await the delay
      const resultPromise = client.getStateWithStatus()

      // Advance past retry delays (500ms each)
      await vi.advanceTimersByTimeAsync(600)
      await vi.advanceTimersByTimeAsync(600)

      const result = await resultPromise

      // Should have retried 3 times total (initial + 2 retries)
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(3)
      expect(result.status).toBe('success')
      expect(result.state).toEqual(mockState)
    })

    it('should retry on 5xx server errors', async () => {
      vi.mocked(mockAdapter.fetchState)
        .mockRejectedValueOnce(new Error('GitHub API failed with status 503'))
        .mockResolvedValueOnce(mockState)

      const resultPromise = client.getStateWithStatus()
      await vi.advanceTimersByTimeAsync(600)
      const result = await resultPromise

      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2)
      expect(result.status).toBe('success')
    })

    it('should NOT retry on 4xx client errors', async () => {
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(
        new Error('GitHub API failed with status 401: Unauthorized')
      )

      const result = await client.getStateWithStatus()

      // Should not retry - 401 is not transient
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)
      expect(result.status).toBe('error')
      expect(result.error).toContain('401')
    })

    it('should NOT retry on rate limit errors', async () => {
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(
        new Error('GitHub API rate limit exceeded')
      )

      const result = await client.getStateWithStatus()

      // Should not retry - rate limit is not transient
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)
      expect(result.status).toBe('error')
    })

    it('should give up after max retries', async () => {
      // Use error message that matches transient pattern (ECONNRESET)
      vi.mocked(mockAdapter.fetchState).mockRejectedValue(
        new Error('ECONNRESET: Connection reset by peer')
      )

      const resultPromise = client.getStateWithStatus()
      // Advance past all retry delays
      await vi.advanceTimersByTimeAsync(600)
      await vi.advanceTimersByTimeAsync(600)
      const result = await resultPromise

      // 1 initial + 2 retries = 3 total attempts
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(3)
      expect(result.status).toBe('error')
      expect(result.error).toContain('ECONNRESET')
    })
  })

  describe('cache persistence', () => {
    it('should load cached state on setRepoPath', () => {
      const cachedState: GitForgeState = {
        pullRequests: [
          {
            number: 99,
            title: 'Cached PR',
            url: 'https://github.com/owner/repo/pull/99',
            state: 'open',
            headRefName: 'cached-branch',
            baseRefName: 'main',
            headSha: 'cached123',
            isMergeable: true,
            createdAt: '2024-01-01T00:00:00Z'
          }
        ]
      }

      vi.mocked(configStore.getCachedForgeState).mockReturnValue({
        state: cachedState,
        timestamp: Date.now() - 1000
      })

      client.setRepoPath('/test/repo')

      expect(configStore.getCachedForgeState).toHaveBeenCalledWith('/test/repo')
    })

    it('should persist state to cache after successful fetch (debounced)', async () => {
      client.setRepoPath('/test/repo')
      vi.mocked(configStore.getCachedForgeState).mockReturnValue(null)

      await client.getStateWithStatus()

      // Cache write is debounced - advance timer to trigger it
      vi.advanceTimersByTime(3000)

      expect(configStore.setCachedForgeState).toHaveBeenCalledWith('/test/repo', mockState)
    })

    it('should debounce rapid cache writes', async () => {
      client.setRepoPath('/test/repo')
      vi.mocked(configStore.getCachedForgeState).mockReturnValue(null)

      // First fetch
      await client.getStateWithStatus()

      // Advance only 1s (less than debounce delay of 2s) - cache not written yet
      vi.advanceTimersByTime(1000)
      expect(configStore.setCachedForgeState).not.toHaveBeenCalled()

      // Force a refresh (bypasses TTL)
      await client.refreshWithStatus()

      // Still haven't written - debounce restarted
      vi.advanceTimersByTime(1000)
      expect(configStore.setCachedForgeState).not.toHaveBeenCalled()

      // Force another refresh
      await client.refreshWithStatus()

      // Now advance past debounce delay
      vi.advanceTimersByTime(3000)

      // Should only have written once despite 3 fetches
      expect(configStore.setCachedForgeState).toHaveBeenCalledTimes(1)
    })

    it('should flush cache immediately when requested', async () => {
      client.setRepoPath('/test/repo')
      vi.mocked(configStore.getCachedForgeState).mockReturnValue(null)

      await client.getStateWithStatus()

      // Flush immediately (no timer advance)
      client.flushCache()

      expect(configStore.setCachedForgeState).toHaveBeenCalledWith('/test/repo', mockState)
    })
  })

  describe('request deduplication', () => {
    it('should deduplicate concurrent requests', async () => {
      // Make the fetch slow so we can trigger concurrent requests
      let resolvePromise: (value: typeof mockState) => void
      const slowPromise = new Promise<typeof mockState>((resolve) => {
        resolvePromise = resolve
      })
      vi.mocked(mockAdapter.fetchState).mockReturnValue(slowPromise)

      // Start two concurrent requests
      const request1 = client.getStateWithStatus()
      const request2 = client.getStateWithStatus()

      // Resolve the promise
      resolvePromise!(mockState)

      const [result1, result2] = await Promise.all([request1, request2])

      // Should only have called fetchState once (deduplication)
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)

      // Both results should have the same state data
      expect(result1.state).toEqual(mockState)
      expect(result2.state).toEqual(mockState)
      expect(result1.status).toBe('success')
      expect(result2.status).toBe('success')
    })

    it('should allow new request after previous completes', async () => {
      // First request
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)

      // Advance past TTL
      vi.advanceTimersByTime(16000)

      // Second request should trigger new fetch
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2)
    })
  })
})
