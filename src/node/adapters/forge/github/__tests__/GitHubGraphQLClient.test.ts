import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FETCH_PRS_QUERY, GitHubGraphQLClient } from '../GitHubGraphQLClient'

// Mock undici's request function and Agent class
vi.mock('undici', () => {
  const MockAgent = function () {
    return {}
  }
  return {
    request: vi.fn(),
    Agent: MockAgent
  }
})

import { request } from 'undici'

const mockRequest = vi.mocked(request)

describe('GitHubGraphQLClient', () => {
  const pat = 'test-pat-token'
  const owner = 'test-owner'
  const repo = 'test-repo'
  let client: GitHubGraphQLClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new GitHubGraphQLClient(pat, owner, repo)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('query', () => {
    it('should send GraphQL query with correct headers', async () => {
      const mockData = { repository: { pullRequests: { nodes: [] } } }
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '1'
        },
        body: {
          json: async () => ({ data: mockData }),
          text: async () => ''
        }
      } as never)

      await client.query(FETCH_PRS_QUERY, { owner, repo, first: 100 })

      expect(mockRequest).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${pat}`,
            'User-Agent': 'Teapot-Git-Client',
            'Content-Type': 'application/json'
          })
        })
      )
    })

    it('should return data and rate limit info', async () => {
      const mockData = { repository: { pullRequests: { nodes: [] } } }
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '1'
        },
        body: {
          json: async () => ({ data: mockData }),
          text: async () => ''
        }
      } as never)

      const result = await client.query('query { test }')

      expect(result.data).toEqual(mockData)
      expect(result.rateLimit).toEqual({
        limit: 5000,
        remaining: 4999,
        reset: 1704067200,
        used: 1
      })
      expect(result.unchanged).toBe(false)
    })

    it('should detect unchanged responses with hash comparison', async () => {
      const mockData = { repository: { pullRequests: { nodes: [] } } }
      const mockResponse = {
        statusCode: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '1'
        },
        body: {
          json: async () => ({ data: mockData }),
          text: async () => ''
        }
      }
      mockRequest.mockResolvedValue(mockResponse as never)

      // First request
      const result1 = await client.query('query { test }')
      expect(result1.unchanged).toBe(false)

      // Second request with same data
      const result2 = await client.query('query { test }')
      expect(result2.unchanged).toBe(true)
    })

    it('should throw on 401 Unauthorized', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 401,
        headers: {},
        body: {
          json: async () => ({ message: 'Unauthorized' }),
          text: async () => 'Unauthorized'
        }
      } as never)

      await expect(client.query('query { test }')).rejects.toThrow('GitHub authentication failed')
    })

    it('should throw on 403 rate limit', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 403,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '5000'
        },
        body: {
          json: async () => ({ message: 'rate limit exceeded' }),
          text: async () => 'rate limit exceeded'
        }
      } as never)

      await expect(client.query('query { test }')).rejects.toThrow('rate limit exceeded')
    })

    it('should throw on GraphQL errors', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          json: async () => ({
            errors: [{ message: 'Field not found' }, { message: 'Invalid query' }]
          }),
          text: async () => ''
        }
      } as never)

      await expect(client.query('query { invalid }')).rejects.toThrow(
        'Field not found, Invalid query'
      )
    })
  })

  describe('rate limit tracking', () => {
    it('should track rate limit info across requests', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '1'
        },
        body: {
          json: async () => ({ data: {} }),
          text: async () => ''
        }
      } as never)

      await client.query('query { test }')

      const rateLimit = client.getRateLimitInfo()
      expect(rateLimit).toEqual({
        limit: 5000,
        remaining: 4999,
        reset: 1704067200,
        used: 1
      })
    })

    it('should return null if no rate limit headers', async () => {
      expect(client.getRateLimitInfo()).toBeNull()
    })

    it('should detect when rate limit is low', async () => {
      // Mock response with low rate limit
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '100', // 2% remaining
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '4900'
        },
        body: {
          json: async () => ({ data: {} }),
          text: async () => ''
        }
      } as never)

      await client.query('query { test }')

      expect(client.shouldPauseForRateLimit()).toBe(true)
    })

    it('should not pause when rate limit is healthy', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4500', // 90% remaining
          'x-ratelimit-reset': '1704067200',
          'x-ratelimit-used': '500'
        },
        body: {
          json: async () => ({ data: {} }),
          text: async () => ''
        }
      } as never)

      await client.query('query { test }')

      expect(client.shouldPauseForRateLimit()).toBe(false)
    })
  })

  describe('error backoff', () => {
    it('should track consecutive errors', async () => {
      mockRequest.mockRejectedValue(new Error('Network error'))

      // Initial state - no errors
      expect(client.getErrorBackoffDelay()).toBe(0)

      // First error
      try {
        await client.query('query { test }')
      } catch {
        // Expected
      }
      const firstDelay = client.getErrorBackoffDelay()
      expect(firstDelay).toBeGreaterThan(0)
      expect(firstDelay).toBeLessThanOrEqual(1500) // ~1000ms + jitter

      // Second error
      try {
        await client.query('query { test }')
      } catch {
        // Expected
      }
      const secondDelay = client.getErrorBackoffDelay()
      expect(secondDelay).toBeGreaterThan(firstDelay)
    })

    it('should reset error count on success', async () => {
      // First, trigger some errors
      mockRequest.mockRejectedValueOnce(new Error('Network error'))
      try {
        await client.query('query { test }')
      } catch {
        // Expected
      }
      expect(client.getErrorBackoffDelay()).toBeGreaterThan(0)

      // Now succeed
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          json: async () => ({ data: {} }),
          text: async () => ''
        }
      } as never)
      await client.query('query { test }')

      expect(client.getErrorBackoffDelay()).toBe(0)
    })
  })

  describe('cache invalidation', () => {
    it('should clear response hash on invalidateCache', async () => {
      const mockData = { test: 'data' }
      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          json: async () => ({ data: mockData }),
          text: async () => ''
        }
      }
      mockRequest.mockResolvedValue(mockResponse as never)

      // First request sets the hash
      const result1 = await client.query('query { test }')
      expect(result1.unchanged).toBe(false)

      // Second request with same data would be unchanged
      const result2 = await client.query('query { test }')
      expect(result2.unchanged).toBe(true)

      // Invalidate cache
      client.invalidateCache()

      // Third request should now show as changed
      const result3 = await client.query('query { test }')
      expect(result3.unchanged).toBe(false)
    })
  })
})
