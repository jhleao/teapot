import { log } from '@shared/logger'
import type { RateLimitInfo } from '@shared/types/git-forge'
import { createHash } from 'crypto'
import { Agent, request } from 'undici'

// Re-export for convenience
export type { RateLimitInfo }

/**
 * Response from a GraphQL request, including rate limit and change detection info.
 */
export type GraphQLResponse<T> = {
  data: T | null
  errors?: Array<{ message: string; type?: string }>
  rateLimit: RateLimitInfo | null
  /** True if the response data is unchanged from the previous request (hash comparison) */
  unchanged: boolean
}

/**
 * Shared HTTP agent with timeout configuration for GitHub API requests.
 */
const githubAgent = new Agent({
  connectTimeout: 10_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000
})

const REQUEST_TIMEOUT_MS = 15_000

/**
 * GitHub GraphQL API client with response hash caching and rate limit tracking.
 *
 * Key features:
 * - Single GraphQL query fetches all PR data in one request (vs ~16 REST calls)
 * - Response hash comparison to detect unchanged data
 * - Proactive rate limit tracking from response headers
 * - Exponential backoff on errors with jitter
 */
export class GitHubGraphQLClient {
  private lastResponseHash: string | null = null
  private rateLimitInfo: RateLimitInfo | null = null
  private consecutiveErrors = 0

  /** Max backoff delay in milliseconds */
  private readonly MAX_BACKOFF_MS = 60_000

  /** Base backoff delay in milliseconds */
  private readonly BASE_BACKOFF_MS = 1_000

  constructor(
    private readonly pat: string,
    _owner: string, // Used for consistency with other adapters; query uses variables
    _repo: string // Used for consistency with other adapters; query uses variables
  ) {}

  /**
   * Returns current rate limit info (may be stale if no recent requests).
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo
  }

  /**
   * Returns true if we should pause requests due to rate limiting.
   * Triggers when remaining < 5% of limit or we're within 60s of reset.
   */
  shouldPauseForRateLimit(): boolean {
    if (!this.rateLimitInfo) return false

    const { remaining, limit, reset } = this.rateLimitInfo
    const now = Math.floor(Date.now() / 1000)

    // If we have very few requests left, pause
    if (remaining < limit * 0.05) {
      return true
    }

    // If we're out of requests and reset is in the future
    if (remaining === 0 && reset > now) {
      return true
    }

    return false
  }

  /**
   * Returns the delay (in ms) before we should retry after rate limiting.
   * Returns 0 if no delay needed.
   */
  getRateLimitRetryDelay(): number {
    if (!this.rateLimitInfo) return 0

    const { remaining, reset } = this.rateLimitInfo
    const now = Math.floor(Date.now() / 1000)

    if (remaining === 0 && reset > now) {
      // Wait until reset time + 1 second buffer
      return (reset - now + 1) * 1000
    }

    return 0
  }

  /**
   * Returns the backoff delay for the next retry after an error.
   * Uses exponential backoff with jitter.
   */
  getErrorBackoffDelay(): number {
    if (this.consecutiveErrors === 0) return 0

    // Exponential backoff: 1s, 2s, 4s, 8s, ..., max 60s
    const exponentialDelay = this.BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1)
    const cappedDelay = Math.min(exponentialDelay, this.MAX_BACKOFF_MS)

    // Add jitter (±25%) to prevent thundering herd
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1)

    return Math.floor(cappedDelay + jitter)
  }

  /**
   * Resets the error counter on successful request.
   */
  private onSuccess(): void {
    this.consecutiveErrors = 0
  }

  /**
   * Increments the error counter on failed request.
   */
  private onError(): void {
    this.consecutiveErrors++
  }

  /**
   * Clears the cached response hash, causing next response to be treated as changed.
   */
  invalidateCache(): void {
    this.lastResponseHash = null
  }

  /**
   * Executes a GraphQL query against GitHub's API.
   *
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @param checkUnchanged - If true, compares response hash to detect unchanged data
   * @returns GraphQL response with rate limit and change detection info
   */
  async query<T>(
    query: string,
    variables: Record<string, unknown> = {},
    checkUnchanged = true
  ): Promise<GraphQLResponse<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.pat}`,
      'User-Agent': 'Teapot-Git-Client',
      'Content-Type': 'application/json'
    }

    try {
      const {
        body,
        statusCode,
        headers: responseHeaders
      } = await request('https://api.github.com/graphql', {
        method: 'POST',
        dispatcher: githubAgent,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers,
        body: JSON.stringify({ query, variables })
      })

      // Parse rate limit headers
      this.rateLimitInfo = this.parseRateLimitHeaders(responseHeaders)

      if (statusCode === 401) {
        this.onError()
        throw new Error(
          'GitHub authentication failed. Your Personal Access Token (PAT) is invalid or has expired.'
        )
      }

      if (statusCode === 403) {
        this.onError()
        const text = await body.text()
        if (text.toLowerCase().includes('rate limit')) {
          throw new Error(
            `GitHub API rate limit exceeded. Resets at ${new Date((this.rateLimitInfo?.reset ?? 0) * 1000).toLocaleTimeString()}`
          )
        }
        throw new Error(`GitHub access forbidden: ${text}`)
      }

      if (statusCode !== 200) {
        this.onError()
        const text = await body.text()
        throw new Error(`GitHub GraphQL API failed with status ${statusCode}: ${text}`)
      }

      const result = (await body.json()) as { data?: T; errors?: Array<{ message: string }> }

      // Check for GraphQL-level errors
      if (result.errors && result.errors.length > 0) {
        this.onError()
        const errorMessages = result.errors.map((e) => e.message).join(', ')
        throw new Error(`GitHub GraphQL errors: ${errorMessages}`)
      }

      // Compute hash of response data to detect changes
      let unchanged = false
      if (checkUnchanged && result.data) {
        const responseHash = this.computeHash(result.data)
        unchanged = responseHash === this.lastResponseHash
        this.lastResponseHash = responseHash
      }

      this.onSuccess()
      return {
        data: result.data ?? null,
        errors: result.errors,
        rateLimit: this.rateLimitInfo,
        unchanged
      }
    } catch (error) {
      this.onError()
      throw error
    }
  }

  /**
   * Computes a SHA-256 hash of the given data for change detection.
   */
  private computeHash(data: unknown): string {
    const json = JSON.stringify(data)
    return createHash('sha256').update(json).digest('hex')
  }

  /**
   * Parses rate limit information from response headers.
   */
  private parseRateLimitHeaders(
    headers: Record<string, string | string[] | undefined>
  ): RateLimitInfo | null {
    const limit = this.parseHeaderNumber(headers['x-ratelimit-limit'])
    const remaining = this.parseHeaderNumber(headers['x-ratelimit-remaining'])
    const reset = this.parseHeaderNumber(headers['x-ratelimit-reset'])
    const used = this.parseHeaderNumber(headers['x-ratelimit-used'])

    if (limit === null || remaining === null || reset === null || used === null) {
      return null
    }

    // Log rate limit info for debugging
    if (remaining < 100) {
      log.warn(
        `[GitHubGraphQL] Rate limit low: ${remaining}/${limit} remaining, resets at ${new Date(reset * 1000).toLocaleTimeString()}`
      )
    }

    return { limit, remaining, reset, used }
  }

  /**
   * Parses a header value as a number.
   */
  private parseHeaderNumber(value: string | string[] | undefined): number | null {
    if (value === undefined) return null
    const str = Array.isArray(value) ? value[0] : value
    const num = parseInt(str, 10)
    return isNaN(num) ? null : num
  }
}

/**
 * GraphQL query to fetch all PR data in a single request.
 *
 * This replaces ~16 REST API calls with a single GraphQL query:
 * - List PRs (1 call)
 * - PR details per open PR (~5 calls)
 * - Check runs per open PR (~5 calls)
 * - Commit statuses per open PR (~5 calls)
 *
 * The query fetches:
 * - All PRs (open, closed, merged) with basic info
 * - Mergeable status for open PRs
 * - Status check rollup (combined check runs + commit statuses)
 * - Individual check runs with status and conclusion
 */
export const FETCH_PRS_QUERY = `
query FetchPullRequests($owner: String!, $repo: String!, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        state
        isDraft
        mergeable
        mergeStateStatus
        createdAt
        mergedAt
        headRefName
        headRefOid
        baseRefName
        reviewDecision
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      detailsUrl
                      summary: text
                    }
                    ... on StatusContext {
                      context
                      state
                      description
                      targetUrl
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    branchProtectionRules(first: 20) {
      nodes {
        pattern
        requiredStatusChecks {
          context
        }
        requiresApprovingReviews
        requiredApprovingReviewCount
      }
    }
    rulesets(first: 20, includeParents: true) {
      nodes {
        name
        target
        enforcement
        conditions {
          refName {
            include
          }
        }
        rules(first: 100) {
          nodes {
            type
            parameters {
              ... on RequiredStatusChecksParameters {
                requiredStatusChecks {
                  context
                }
              }
            }
          }
        }
      }
    }
  }
}
`

/**
 * TypeScript types for the GraphQL response.
 */
export type GraphQLBranchProtectionRule = {
  pattern: string
  requiredStatusChecks: Array<{ context: string }> | null
  requiresApprovingReviews: boolean
  requiredApprovingReviewCount: number
}

export type GraphQLRulesetRule = {
  type: string
  parameters: {
    requiredStatusChecks?: Array<{ context: string }>
  } | null
}

export type GraphQLRuleset = {
  name: string
  target: 'BRANCH' | 'TAG' | 'PUSH'
  enforcement: 'ACTIVE' | 'DISABLED' | 'EVALUATE'
  conditions: {
    refName: {
      include: string[]
    } | null
  } | null
  rules: {
    nodes: GraphQLRulesetRule[]
  }
}

export type GraphQLPullRequestsResponse = {
  repository: {
    pullRequests: {
      nodes: GraphQLPullRequest[]
    }
    branchProtectionRules: {
      nodes: GraphQLBranchProtectionRule[]
    }
    rulesets: {
      nodes: GraphQLRuleset[]
    }
  } | null
}

export type GraphQLPullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus: 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  createdAt: string
  mergedAt: string | null
  headRefName: string
  headRefOid: string
  baseRefName: string
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: 'ERROR' | 'EXPECTED' | 'FAILURE' | 'PENDING' | 'SUCCESS'
          contexts: {
            nodes: Array<GraphQLCheckRun | GraphQLStatusContext>
          }
        } | null
      }
    }>
  }
}

export type GraphQLCheckRun = {
  __typename: 'CheckRun'
  name: string
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'WAITING' | 'PENDING' | 'REQUESTED'
  conclusion:
    | 'ACTION_REQUIRED'
    | 'CANCELLED'
    | 'FAILURE'
    | 'NEUTRAL'
    | 'SKIPPED'
    | 'STALE'
    | 'SUCCESS'
    | 'TIMED_OUT'
    | 'STARTUP_FAILURE'
    | null
  detailsUrl: string | null
  summary: string | null
}

export type GraphQLStatusContext = {
  __typename: 'StatusContext'
  context: string
  state: 'ERROR' | 'EXPECTED' | 'FAILURE' | 'PENDING' | 'SUCCESS'
  description: string | null
  targetUrl: string | null
}
