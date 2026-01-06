import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubAdapter } from '../GitHubAdapter'

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

  describe('fetchPrDetails', () => {
    it('should fetch mergeable state for a PR', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            number: 123,
            mergeable: true,
            mergeable_state: 'clean',
            head: { sha: 'abc123' }
          }),
          text: async () => ''
        }
      } as never)

      const details = await adapter.fetchPrDetails(123)

      expect(details.mergeable).toBe(true)
      expect(details.mergeable_state).toBe('clean')
      expect(details.headSha).toBe('abc123')
      expect(mockRequest).toHaveBeenCalledWith(
        `https://api.github.com/repos/${owner}/${repo}/pulls/123`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${pat}`
          })
        })
      )
    })

    it('should return mergeable=false when PR has conflicts (dirty)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            number: 123,
            mergeable: false,
            mergeable_state: 'dirty',
            head: { sha: 'abc123' }
          }),
          text: async () => ''
        }
      } as never)

      const details = await adapter.fetchPrDetails(123)

      expect(details.mergeable).toBe(false)
      expect(details.mergeable_state).toBe('dirty')
    })

    it('should return mergeable_state=blocked when branch protection blocks', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            number: 123,
            mergeable: true,
            mergeable_state: 'blocked',
            head: { sha: 'abc123' }
          }),
          text: async () => ''
        }
      } as never)

      const details = await adapter.fetchPrDetails(123)

      expect(details.mergeable).toBe(true)
      expect(details.mergeable_state).toBe('blocked')
    })

    it('should return mergeable_state=unstable when CI is running', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            number: 123,
            mergeable: true,
            mergeable_state: 'unstable',
            head: { sha: 'abc123' }
          }),
          text: async () => ''
        }
      } as never)

      const details = await adapter.fetchPrDetails(123)

      expect(details.mergeable).toBe(true)
      expect(details.mergeable_state).toBe('unstable')
    })

    it('should handle mergeable=null (still computing)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            number: 123,
            mergeable: null,
            mergeable_state: 'unknown',
            head: { sha: 'abc123' }
          }),
          text: async () => ''
        }
      } as never)

      const details = await adapter.fetchPrDetails(123)

      expect(details.mergeable).toBe(null)
      expect(details.mergeable_state).toBe('unknown')
    })
  })

  describe('fetchState with isMergeable', () => {
    // Helper to create a mock check runs response
    const mockCheckRunsResponse = (
      checks: { name: string; status: string; conclusion?: string }[] = []
    ) => ({
      statusCode: 200,
      body: {
        json: async () => ({
          total_count: checks.length,
          check_runs: checks.map((c, i) => ({
            id: i,
            name: c.name,
            status: c.status,
            conclusion: c.conclusion ?? null,
            html_url: `https://github.com/owner/repo/runs/${i}`,
            output: { title: null, summary: null }
          }))
        }),
        text: async () => ''
      }
    })

    it('should set isMergeable=true only when mergeable=true AND mergeable_state=clean', async () => {
      // First call: list PRs
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => [
            {
              number: 1,
              title: 'Open PR - Clean',
              html_url: 'https://github.com/owner/repo/pull/1',
              state: 'open',
              draft: false,
              merged_at: null,
              head: { ref: 'feature-1', sha: 'sha1' },
              base: { ref: 'main' },
              created_at: '2024-01-01T00:00:00Z'
            },
            {
              number: 2,
              title: 'Open PR - Blocked',
              html_url: 'https://github.com/owner/repo/pull/2',
              state: 'open',
              draft: false,
              merged_at: null,
              head: { ref: 'feature-2', sha: 'sha2' },
              base: { ref: 'main' },
              created_at: '2024-01-02T00:00:00Z'
            },
            {
              number: 3,
              title: 'Merged PR',
              html_url: 'https://github.com/owner/repo/pull/3',
              state: 'closed',
              draft: false,
              merged_at: '2024-01-03T00:00:00Z',
              head: { ref: 'feature-3', sha: 'sha3' },
              base: { ref: 'main' },
              created_at: '2024-01-03T00:00:00Z'
            }
          ],
          text: async () => ''
        }
      } as never)

      // PR #1: fetch details then check runs
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            mergeable: true,
            mergeable_state: 'clean',
            head: { sha: 'sha1' }
          }),
          text: async () => ''
        }
      } as never)
      mockRequest.mockResolvedValueOnce(
        mockCheckRunsResponse([{ name: 'CI', status: 'completed', conclusion: 'success' }]) as never
      )

      // PR #2: fetch details then check runs
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            mergeable: true,
            mergeable_state: 'blocked',
            head: { sha: 'sha2' }
          }),
          text: async () => ''
        }
      } as never)
      mockRequest.mockResolvedValueOnce(
        mockCheckRunsResponse([{ name: 'CI', status: 'completed', conclusion: 'success' }]) as never
      )

      const state = await adapter.fetchState()

      expect(state.pullRequests).toHaveLength(3)

      // PR #1: mergeable=true, state=clean → isMergeable=true
      expect(state.pullRequests[0].isMergeable).toBe(true)
      expect(state.pullRequests[0].number).toBe(1)

      // PR #2: mergeable=true, state=blocked → isMergeable=false
      expect(state.pullRequests[1].isMergeable).toBe(false)
      expect(state.pullRequests[1].number).toBe(2)

      // PR #3: merged (not open) → isMergeable=false (not fetched)
      expect(state.pullRequests[2].isMergeable).toBe(false)
      expect(state.pullRequests[2].number).toBe(3)
    })

    it('should set isMergeable=false for draft PRs', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => [
            {
              number: 1,
              title: 'Draft PR',
              html_url: 'https://github.com/owner/repo/pull/1',
              state: 'open',
              draft: true,
              merged_at: null,
              head: { ref: 'feature-1', sha: 'sha1' },
              base: { ref: 'main' },
              created_at: '2024-01-01T00:00:00Z'
            }
          ],
          text: async () => ''
        }
      } as never)

      // Draft PRs don't get details fetched (state !== 'open')

      const state = await adapter.fetchState()

      expect(state.pullRequests[0].state).toBe('draft')
      expect(state.pullRequests[0].isMergeable).toBe(false)
    })

    it('should set isMergeable=false when mergeable is null (still computing)', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => [
            {
              number: 1,
              title: 'Open PR',
              html_url: 'https://github.com/owner/repo/pull/1',
              state: 'open',
              draft: false,
              merged_at: null,
              head: { ref: 'feature-1', sha: 'sha1' },
              base: { ref: 'main' },
              created_at: '2024-01-01T00:00:00Z'
            }
          ],
          text: async () => ''
        }
      } as never)

      // PR details
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({
            mergeable: null,
            mergeable_state: 'unknown',
            head: { sha: 'sha1' }
          }),
          text: async () => ''
        }
      } as never)
      // Check runs
      mockRequest.mockResolvedValueOnce(mockCheckRunsResponse([]) as never)

      const state = await adapter.fetchState()

      expect(state.pullRequests[0].isMergeable).toBe(false)
    })

    it('should not fetch details for closed/merged PRs', async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => [
            {
              number: 1,
              title: 'Closed PR',
              html_url: 'https://github.com/owner/repo/pull/1',
              state: 'closed',
              draft: false,
              merged_at: null,
              head: { ref: 'feature-1', sha: 'sha1' },
              base: { ref: 'main' },
              created_at: '2024-01-01T00:00:00Z'
            }
          ],
          text: async () => ''
        }
      } as never)

      const state = await adapter.fetchState()

      // Should only have called request once (for list), not for details
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(state.pullRequests[0].isMergeable).toBe(false)
    })
  })
})
