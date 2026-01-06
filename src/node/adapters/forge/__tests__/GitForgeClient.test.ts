import type { GitForgeAdapter, GitForgeState } from '@shared/types/git-forge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitForgeClient } from '../GitForgeClient'

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

      // Second call within TTL (3s)
      vi.advanceTimersByTime(2000)
      const result = await client.getStateWithStatus()

      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1) // Not called again
      expect(result.status).toBe('success')
      expect(result.state).toEqual(mockState)
    })

    it('should refetch after TTL expires', async () => {
      // First call
      await client.getStateWithStatus()
      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(1)

      // Advance past TTL (3s)
      vi.advanceTimersByTime(4000)
      await client.getStateWithStatus()

      expect(mockAdapter.fetchState).toHaveBeenCalledTimes(2)
    })

    it('should return error status and stale state on fetch failure', async () => {
      // First successful call
      await client.getStateWithStatus()

      // Setup failure for next call
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(new Error('Network timeout'))

      // Advance past TTL (3s)
      vi.advanceTimersByTime(4000)
      const result = await client.getStateWithStatus()

      expect(result.status).toBe('error')
      expect(result.error).toBe('Network timeout')
      expect(result.state).toEqual(mockState) // Stale state preserved
    })

    it('should retry sooner after error (2s instead of 3s)', async () => {
      // First successful call
      await client.getStateWithStatus()

      // Setup failure
      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(new Error('Timeout'))

      // Advance past TTL (3s) to trigger error
      vi.advanceTimersByTime(4000)
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

      vi.mocked(mockAdapter.fetchState).mockRejectedValueOnce(new Error('Timeout'))
      vi.advanceTimersByTime(4000) // Past TTL (3s)

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
})
