import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubAdapter } from '../GitHubAdapter'

// Mock the GraphQL client to throw by default (falls back to REST)
const mockGraphQLClient = {
  query: vi.fn().mockRejectedValue(new Error('GraphQL disabled for test')),
  getRateLimitInfo: vi.fn().mockReturnValue(null),
  invalidateCache: vi.fn()
}

vi.mock('../GitHubGraphQLClient', () => ({
  GitHubGraphQLClient: class MockGitHubGraphQLClient {
    query = mockGraphQLClient.query
    getRateLimitInfo = mockGraphQLClient.getRateLimitInfo
    invalidateCache = mockGraphQLClient.invalidateCache
  },
  FETCH_PRS_QUERY: 'mock query'
}))

// Mock undici's request function and Agent class
vi.mock('undici', () => {
  // Create a mock Agent class
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

describe('GitHubAdapter', () => {
  const pat = 'test-pat-token'
  const owner = 'test-owner'
  const repo = 'test-repo'
  let adapter: GitHubAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new GitHubAdapter(pat, owner, repo)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('mergePullRequest', () => {
    it('should call GitHub API with squash merge method', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({ sha: 'merged-sha', merged: true }),
          text: async () => ''
        }
      } as never)

      await adapter.mergePullRequest(123, 'squash')

      expect(mockRequest).toHaveBeenCalledWith(
        `https://api.github.com/repos/${owner}/${repo}/pulls/123/merge`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: `Bearer ${pat}`,
            'User-Agent': 'Teapot-Git-Client'
          }),
          body: JSON.stringify({ merge_method: 'squash' })
        })
      )
    })

    it('should call GitHub API with merge method', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({ sha: 'merged-sha', merged: true }),
          text: async () => ''
        }
      } as never)

      await adapter.mergePullRequest(456, 'merge')

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ merge_method: 'merge' })
        })
      )
    })

    it('should call GitHub API with rebase method', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({ sha: 'merged-sha', merged: true }),
          text: async () => ''
        }
      } as never)

      await adapter.mergePullRequest(789, 'rebase')

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ merge_method: 'rebase' })
        })
      )
    })

    it('should throw error when PR has merge conflicts (409)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 409,
        body: {
          json: async () => ({ message: 'Merge conflict' }),
          text: async () => JSON.stringify({ message: 'Merge conflict' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(/conflict/i)
    })

    it('should throw error when branch protection blocks merge (405)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 405,
        body: {
          json: async () => ({
            message: 'Pull Request is not mergeable',
            documentation_url: 'https://docs.github.com/...'
          }),
          text: async () => JSON.stringify({ message: 'Pull Request is not mergeable' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(
        /not mergeable|blocked|branch protection/i
      )
    })

    it('should throw error when required status checks have not passed (405)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 405,
        body: {
          json: async () => ({
            message: 'Required status check is not passing'
          }),
          text: async () => JSON.stringify({ message: 'Required status check is not passing' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(
        /status check|not passing|blocked/i
      )
    })

    it('should throw error when PR is already merged or closed (422)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 422,
        body: {
          json: async () => ({
            message: 'Pull Request is not open'
          }),
          text: async () => JSON.stringify({ message: 'Pull Request is not open' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(/not open|already/i)
    })

    it('should throw error when PAT lacks permissions (403)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 403,
        body: {
          json: async () => ({
            message: 'Resource not accessible by integration'
          }),
          text: async () => JSON.stringify({ message: 'Resource not accessible by integration' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(
        /permission|forbidden|access/i
      )
    })

    it('should throw error when PR not found (404)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 404,
        body: {
          json: async () => ({ message: 'Not Found' }),
          text: async () => JSON.stringify({ message: 'Not Found' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(/not found/i)
    })

    it('should throw error when PAT is invalid (401)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 401,
        body: {
          json: async () => ({ message: 'Bad credentials' }),
          text: async () => JSON.stringify({ message: 'Bad credentials' })
        }
      } as never)

      await expect(adapter.mergePullRequest(123, 'squash')).rejects.toThrow(
        /authentication|credentials|invalid|expired/i
      )
    })
  })

})
