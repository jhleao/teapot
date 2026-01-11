import { log } from '@shared/logger'
import {
  CheckStatus,
  ForgePullRequest,
  GitForgeAdapter,
  GitForgeState,
  MergeBlocker,
  MergeReadiness,
  MergeStrategy,
  RateLimitInfo,
  StatusCheck
} from '@shared/types/git-forge'
import { Agent, request } from 'undici'
import {
  FETCH_PRS_QUERY,
  GitHubGraphQLClient,
  GraphQLCheckRun,
  GraphQLPullRequest,
  GraphQLPullRequestsResponse,
  GraphQLStatusContext
} from './GitHubGraphQLClient'

/**
 * Shared HTTP agent with timeout configuration for GitHub API requests.
 * Prevents indefinite hangs on network issues.
 */
const githubAgent = new Agent({
  connectTimeout: 10_000, // 10s to establish connection
  headersTimeout: 30_000, // 30s to receive headers
  bodyTimeout: 30_000 // 30s to receive body
})

/** Per-request timeout for GitHub API calls */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Extended forge state that includes rate limit information.
 * Used internally by GitHubAdapter to pass rate limit data.
 */
export type GitForgeStateWithRateLimit = GitForgeState & {
  rateLimit?: RateLimitInfo
}

export class GitHubAdapter implements GitForgeAdapter {
  private readonly graphqlClient: GitHubGraphQLClient

  constructor(
    private readonly pat: string,
    private readonly owner: string,
    private readonly repo: string
  ) {
    this.graphqlClient = new GitHubGraphQLClient(pat, owner, repo)
  }

  /**
   * Returns the current rate limit information from the last API request.
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.graphqlClient.getRateLimitInfo()
  }

  /**
   * Fetches the current state of pull requests using GraphQL API.
   * This is much more efficient than REST - single request vs ~16 requests.
   *
   * Returns extended state including rate limit information.
   */
  async fetchState(): Promise<GitForgeStateWithRateLimit> {
    try {
      return await this.fetchStateGraphQL()
    } catch (error) {
      // Log the error and fall back to REST if GraphQL fails
      log.warn('[GitHubAdapter] GraphQL fetch failed, falling back to REST:', error)
      return this.fetchStateREST()
    }
  }

  /**
   * Fetches PR state using GitHub GraphQL API.
   * Single request gets all PR data including check status.
   */
  private async fetchStateGraphQL(): Promise<GitForgeStateWithRateLimit> {
    const response = await this.graphqlClient.query<GraphQLPullRequestsResponse>(FETCH_PRS_QUERY, {
      owner: this.owner,
      repo: this.repo,
      first: 100
    })

    if (!response.data?.repository) {
      throw new Error('Repository not found or not accessible')
    }

    const pullRequests: ForgePullRequest[] = response.data.repository.pullRequests.nodes.map((pr) =>
      this.mapGraphQLPullRequest(pr)
    )

    return {
      pullRequests,
      rateLimit: response.rateLimit ?? undefined
    }
  }

  /**
   * Maps a GraphQL PR response to our ForgePullRequest type.
   */
  private mapGraphQLPullRequest(pr: GraphQLPullRequest): ForgePullRequest {
    const state = this.mapGraphQLPrState(pr)
    const checks = this.extractGraphQLChecks(pr)
    const mergeReadiness = this.buildGraphQLMergeReadiness(pr, checks)

    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state,
      headRefName: pr.headRefName,
      headSha: pr.headRefOid,
      baseRefName: pr.baseRefName,
      createdAt: pr.createdAt,
      isMergeable: pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'CLEAN',
      mergeReadiness: state === 'open' || state === 'draft' ? mergeReadiness : undefined
    }
  }

  /**
   * Maps GraphQL PR state to our internal state.
   */
  private mapGraphQLPrState(pr: GraphQLPullRequest): ForgePullRequest['state'] {
    if (pr.isDraft) return 'draft'
    if (pr.state === 'MERGED') return 'merged'
    if (pr.state === 'CLOSED') return 'closed'
    return 'open'
  }

  /**
   * Extracts status checks from GraphQL PR response.
   */
  private extractGraphQLChecks(pr: GraphQLPullRequest): StatusCheck[] {
    const lastCommit = pr.commits.nodes[0]
    if (!lastCommit?.commit.statusCheckRollup) {
      return []
    }

    const contexts = lastCommit.commit.statusCheckRollup.contexts.nodes
    return contexts.map((ctx) => {
      if (ctx.__typename === 'CheckRun') {
        return this.mapGraphQLCheckRun(ctx)
      } else {
        return this.mapGraphQLStatusContext(ctx)
      }
    })
  }

  /**
   * Maps a GraphQL CheckRun to our StatusCheck type.
   */
  private mapGraphQLCheckRun(run: GraphQLCheckRun): StatusCheck {
    let status: CheckStatus = 'pending'

    if (run.status === 'COMPLETED') {
      switch (run.conclusion) {
        case 'SUCCESS':
          status = 'success'
          break
        case 'FAILURE':
        case 'TIMED_OUT':
        case 'ACTION_REQUIRED':
        case 'STARTUP_FAILURE':
          status = 'failure'
          break
        case 'NEUTRAL':
        case 'SKIPPED':
        case 'CANCELLED':
        case 'STALE':
          status = 'neutral'
          break
        default:
          status = 'pending'
      }
    }

    return {
      name: run.name,
      status,
      description: run.summary ?? undefined,
      detailsUrl: run.detailsUrl ?? undefined
    }
  }

  /**
   * Maps a GraphQL StatusContext (legacy commit status) to our StatusCheck type.
   */
  private mapGraphQLStatusContext(ctx: GraphQLStatusContext): StatusCheck {
    let status: CheckStatus = 'pending'

    switch (ctx.state) {
      case 'SUCCESS':
        status = 'success'
        break
      case 'FAILURE':
      case 'ERROR':
        status = 'failure'
        break
      case 'PENDING':
      case 'EXPECTED':
        status = 'pending'
        break
    }

    return {
      name: ctx.context,
      status,
      description: ctx.description ?? undefined,
      detailsUrl: ctx.targetUrl ?? undefined
    }
  }

  /**
   * Builds MergeReadiness from GraphQL PR data.
   */
  private buildGraphQLMergeReadiness(
    pr: GraphQLPullRequest,
    checks: StatusCheck[]
  ): MergeReadiness {
    const canMerge = pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'CLEAN'
    const blockers = this.deriveGraphQLBlockers(pr, checks)
    const checksStatus = this.deriveChecksStatus(checks)

    return {
      canMerge,
      blockers,
      checksStatus,
      checks
    }
  }

  /**
   * Derives merge blockers from GraphQL PR state.
   */
  private deriveGraphQLBlockers(pr: GraphQLPullRequest, checks: StatusCheck[]): MergeBlocker[] {
    const blockers: MergeBlocker[] = []

    // Unknown mergeable state - still computing
    if (pr.mergeable === 'UNKNOWN') {
      blockers.push('computing')
    }

    // Merge conflicts
    if (pr.mergeable === 'CONFLICTING') {
      blockers.push('conflicts')
    }

    // Map mergeStateStatus to blockers
    switch (pr.mergeStateStatus) {
      case 'BLOCKED':
        if (checks.some((c) => c.status === 'failure')) {
          blockers.push('checks_failed')
        } else if (checks.some((c) => c.status === 'pending')) {
          blockers.push('checks_pending')
        } else {
          blockers.push('reviews_required')
        }
        break
      case 'UNSTABLE':
        if (!blockers.includes('checks_pending')) {
          blockers.push('checks_pending')
        }
        break
      case 'DIRTY':
        if (!blockers.includes('conflicts')) {
          blockers.push('conflicts')
        }
        break
      case 'BEHIND':
        blockers.push('branch_protection')
        break
    }

    // Add check-based blockers if not already present
    if (checks.some((c) => c.status === 'failure') && !blockers.includes('checks_failed')) {
      blockers.push('checks_failed')
    }
    if (
      checks.some((c) => c.status === 'pending') &&
      !blockers.includes('checks_pending') &&
      !blockers.includes('computing')
    ) {
      blockers.push('checks_pending')
    }

    return blockers
  }

  /**
   * Fallback REST implementation.
   * Used when GraphQL fails or for testing.
   */
  private async fetchStateREST(): Promise<GitForgeState> {
    // Fetch PRs with all states (open, closed, merged)
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`

    const { body, statusCode } = await request(url, {
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json'
      }
    })

    if (statusCode !== 200) {
      const text = await body.text()
      throw new Error(`GitHub API failed with status ${statusCode}: ${text}`)
    }

    const data = (await body.json()) as GitHubPullRequest[]

    // Separate open PRs that need details fetched
    const openPrs = data.filter((pr) => this.mapPrState(pr) === 'open')

    // Fetch details for open PRs in parallel with concurrency limit
    const CONCURRENCY = 5
    const detailsMap = new Map<
      number,
      { mergeable: boolean | null; mergeable_state: string; mergeReadiness: MergeReadiness }
    >()

    for (let i = 0; i < openPrs.length; i += CONCURRENCY) {
      const batch = openPrs.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map((pr) => this.fetchPrDetailsWithChecks(pr.number).catch(() => null))
      )
      batch.forEach((pr, idx) => {
        const result = results[idx]
        if (result) {
          detailsMap.set(pr.number, result)
        }
      })
    }

    // Build pull request objects
    const pullRequests: ForgePullRequest[] = data.map((pr) => {
      const state = this.mapPrState(pr)
      const details = detailsMap.get(pr.number)

      // Determine isMergeable from details or default to false
      const isMergeable = details
        ? details.mergeable === true && details.mergeable_state === 'clean'
        : false

      return {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state,
        headRefName: pr.head.ref,
        headSha: pr.head.sha,
        baseRefName: pr.base.ref,
        createdAt: pr.created_at,
        isMergeable,
        mergeReadiness: details?.mergeReadiness
      }
    })

    return { pullRequests }
  }

  /**
   * Maps GitHub PR state to our internal state.
   *
   * GitHub API returns state='closed' for both closed and merged PRs.
   * We distinguish merged PRs by checking `merged_at` field.
   */
  private mapPrState(pr: GitHubPullRequest): ForgePullRequest['state'] {
    if (pr.draft) {
      return 'draft'
    }
    if (pr.state === 'closed' && pr.merged_at !== null) {
      return 'merged'
    }
    return pr.state
  }

  async createPullRequest(
    title: string,
    headBranch: string,
    baseBranch: string,
    draft?: boolean
  ): Promise<ForgePullRequest> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls`

    const { body, statusCode } = await request(url, {
      method: 'POST',
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        head: headBranch,
        base: baseBranch,
        draft
      })
    })

    if (statusCode !== 201) {
      const text = await body.text()
      const errorMessage = this.parseGitHubError(statusCode, text)
      throw new Error(errorMessage)
    }

    const pr = (await body.json()) as GitHubPullRequest

    return {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.draft ? 'draft' : pr.state,
      headRefName: pr.head.ref,
      headSha: pr.head.sha,
      baseRefName: pr.base.ref,
      createdAt: pr.created_at,
      isMergeable: false // Newly created PRs need CI to run first
    }
  }

  async closePullRequest(number: number): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}`

    const { body, statusCode } = await request(url, {
      method: 'PATCH',
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: 'closed'
      })
    })

    if (statusCode !== 200) {
      const text = await body.text()
      throw new Error(`GitHub API failed with status ${statusCode}: ${text}`)
    }
  }

  /**
   * Updates a pull request's base branch.
   * Used when a branch has been rebased onto a different base.
   *
   * Docs: https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request
   */
  async updatePullRequestBase(number: number, baseBranch: string): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}`

    const { body, statusCode } = await request(url, {
      method: 'PATCH',
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        base: baseBranch
      })
    })

    if (statusCode !== 200) {
      const text = await body.text()
      throw new Error(`GitHub API failed with status ${statusCode}: ${text}`)
    }
  }

  /**
   * Fetches detailed information about a specific pull request.
   * Used to get mergeable state which is not included in the list endpoint.
   *
   * Docs: https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
   */
  async fetchPrDetails(
    number: number
  ): Promise<{ mergeable: boolean | null; mergeable_state: string; headSha: string }> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}`

    const { body, statusCode } = await request(url, {
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json'
      }
    })

    if (statusCode !== 200) {
      const text = await body.text()
      throw new Error(`GitHub API failed with status ${statusCode}: ${text}`)
    }

    const data = (await body.json()) as GitHubPullRequestDetails

    return {
      mergeable: data.mergeable,
      mergeable_state: data.mergeable_state,
      headSha: data.head.sha
    }
  }

  /**
   * Fetches check runs for a specific commit SHA.
   * Uses GitHub Check Runs API (includes GitHub Actions and external checks).
   *
   * Docs: https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
   */
  async fetchCheckRuns(ref: string): Promise<StatusCheck[]> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/commits/${ref}/check-runs`

    try {
      const { body, statusCode } = await request(url, {
        dispatcher: githubAgent,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.pat}`,
          'User-Agent': 'Teapot-Git-Client',
          Accept: 'application/vnd.github.v3+json'
        }
      })

      if (statusCode !== 200) {
        // Return empty array on error - don't fail the whole fetch
        return []
      }

      const data = (await body.json()) as GitHubCheckRunsResponse

      return data.check_runs.map((run) => ({
        name: run.name,
        status: this.mapCheckRunStatus(run),
        description: run.output.summary ?? undefined,
        detailsUrl: run.html_url
      }))
    } catch {
      // Return empty array on error for graceful degradation
      return []
    }
  }

  /**
   * Fetches commit statuses for a specific commit SHA.
   * Uses GitHub Commit Status API (legacy CI systems like Travis, CircleCI legacy).
   *
   * Docs: https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference
   */
  async fetchCommitStatuses(ref: string): Promise<StatusCheck[]> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/commits/${ref}/status`

    try {
      const { body, statusCode } = await request(url, {
        dispatcher: githubAgent,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.pat}`,
          'User-Agent': 'Teapot-Git-Client',
          Accept: 'application/vnd.github.v3+json'
        }
      })

      if (statusCode !== 200) {
        return []
      }

      const data = (await body.json()) as GitHubCombinedStatus

      return data.statuses.map((status) => ({
        name: status.context,
        status: this.mapCommitStatusState(status.state),
        description: status.description ?? undefined,
        detailsUrl: status.target_url ?? undefined
      }))
    } catch {
      return []
    }
  }

  /**
   * Maps GitHub commit status state to our CheckStatus type.
   */
  private mapCommitStatusState(state: GitHubCommitStatus['state']): CheckStatus {
    switch (state) {
      case 'success':
        return 'success'
      case 'failure':
      case 'error':
        return 'failure'
      case 'pending':
        return 'pending'
      default:
        return 'pending'
    }
  }

  /**
   * Merges check runs and commit statuses, preferring check runs when names match.
   * Check Runs API is the modern standard, so we prefer it over legacy statuses.
   */
  private mergeChecksAndStatuses(
    checkRuns: StatusCheck[],
    commitStatuses: StatusCheck[]
  ): StatusCheck[] {
    // Use a Map to deduplicate by name, preferring check runs
    const checksMap = new Map<string, StatusCheck>()

    // Add commit statuses first (will be overwritten by check runs if name matches)
    for (const status of commitStatuses) {
      checksMap.set(status.name.toLowerCase(), status)
    }

    // Add check runs (overwrites any matching commit statuses)
    for (const run of checkRuns) {
      checksMap.set(run.name.toLowerCase(), run)
    }

    return Array.from(checksMap.values())
  }

  /**
   * Maps GitHub check run status/conclusion to our CheckStatus type.
   */
  private mapCheckRunStatus(run: GitHubCheckRun): CheckStatus {
    if (run.status !== 'completed') {
      return 'pending'
    }
    switch (run.conclusion) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
      case 'action_required':
        return 'failure'
      case 'neutral':
      case 'skipped':
      case 'cancelled':
        return 'neutral'
      default:
        return 'pending'
    }
  }

  /**
   * Derives the overall checks status from individual check results.
   */
  private deriveChecksStatus(checks: StatusCheck[]): MergeReadiness['checksStatus'] {
    if (checks.length === 0) return 'none'
    if (checks.some((c) => c.status === 'failure')) return 'failure'
    if (checks.some((c) => c.status === 'pending')) return 'pending'
    return 'success'
  }

  /**
   * Derives merge blockers from PR state and check results.
   */
  private deriveBlockers(
    mergeable: boolean | null,
    mergeable_state: string,
    checks: StatusCheck[]
  ): MergeBlocker[] {
    const blockers: MergeBlocker[] = []

    // GitHub still computing mergeable state
    if (mergeable === null) {
      blockers.push('computing')
    }

    // Merge conflicts
    if (mergeable_state === 'dirty') {
      blockers.push('conflicts')
    }

    // Branch protection blocking (reviews or other rules)
    if (mergeable_state === 'blocked') {
      // Check if it's due to failed checks or reviews
      if (checks.some((c) => c.status === 'failure')) {
        blockers.push('checks_failed')
      } else if (checks.some((c) => c.status === 'pending')) {
        blockers.push('checks_pending')
      } else {
        // Likely reviews or other branch protection
        blockers.push('reviews_required')
      }
    }

    // Unstable means checks are failing/pending
    if (mergeable_state === 'unstable') {
      if (!blockers.includes('checks_pending')) {
        blockers.push('checks_pending')
      }
    }

    // Add check-based blockers if not already added
    if (checks.some((c) => c.status === 'failure') && !blockers.includes('checks_failed')) {
      blockers.push('checks_failed')
    }
    if (
      checks.some((c) => c.status === 'pending') &&
      !blockers.includes('checks_pending') &&
      !blockers.includes('computing')
    ) {
      blockers.push('checks_pending')
    }

    return blockers
  }

  /**
   * Builds a complete MergeReadiness object from PR details and check runs.
   */
  private buildMergeReadiness(
    mergeable: boolean | null,
    mergeable_state: string,
    checks: StatusCheck[]
  ): MergeReadiness {
    const canMerge = mergeable === true && mergeable_state === 'clean'
    const blockers = this.deriveBlockers(mergeable, mergeable_state, checks)
    const checksStatus = this.deriveChecksStatus(checks)

    return {
      canMerge,
      blockers,
      checksStatus,
      checks
    }
  }

  /**
   * Fetches PR details including check runs and builds MergeReadiness.
   * Returns both the raw mergeable state and the enriched MergeReadiness.
   *
   * Fetches PR details and check runs/statuses in parallel for better performance.
   */
  async fetchPrDetailsWithChecks(number: number): Promise<{
    mergeable: boolean | null
    mergeable_state: string
    mergeReadiness: MergeReadiness
  }> {
    // First fetch PR details to get mergeable state and head SHA
    const prDetails = await this.fetchPrDetails(number)

    // Fetch both check runs and commit statuses in parallel
    // Check Runs: GitHub Actions, modern CI
    // Commit Statuses: Legacy CI systems (Travis, CircleCI legacy, etc.)
    const [checkRuns, commitStatuses] = await Promise.all([
      this.fetchCheckRuns(prDetails.headSha),
      this.fetchCommitStatuses(prDetails.headSha)
    ])

    // Merge both into a single checks array, deduplicating by name
    const checks = this.mergeChecksAndStatuses(checkRuns, commitStatuses)

    // Build the complete merge readiness object
    const mergeReadiness = this.buildMergeReadiness(
      prDetails.mergeable,
      prDetails.mergeable_state,
      checks
    )

    return {
      mergeable: prDetails.mergeable,
      mergeable_state: prDetails.mergeable_state,
      mergeReadiness
    }
  }

  /**
   * Merges a pull request using the specified merge strategy.
   *
   * Docs: https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
   */
  async mergePullRequest(number: number, mergeMethod: MergeStrategy): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}/merge`

    const { body, statusCode } = await request(url, {
      method: 'PUT',
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        merge_method: mergeMethod
      })
    })

    if (statusCode === 200) {
      return
    }

    const text = await body.text()
    const errorMessage = this.parseGitHubMergeError(statusCode, text)
    throw new Error(errorMessage)
  }

  /**
   * Deletes a branch from the remote repository.
   *
   * Uses GitHub API: DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}
   * Docs: https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#delete-a-reference
   *
   * Treats 404/422 as success (branch already deleted or doesn't exist).
   */
  async deleteRemoteBranch(branchName: string): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(branchName)}`

    const { body, statusCode } = await request(url, {
      method: 'DELETE',
      dispatcher: githubAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'User-Agent': 'Teapot-Git-Client',
        Accept: 'application/vnd.github.v3+json'
      }
    })

    // 204 = success, 404/422 = branch doesn't exist (treat as success)
    if (statusCode === 204 || statusCode === 404 || statusCode === 422) {
      return
    }

    const text = await body.text()
    throw new Error(`GitHub API failed with status ${statusCode}: ${text}`)
  }

  private parseGitHubError(statusCode: number, responseText: string): string {
    // Try to parse GitHub API error response
    let errorMessage = ''
    let githubMessage = ''

    try {
      const errorData = JSON.parse(responseText)
      githubMessage = errorData.message || ''
    } catch {
      // If not JSON, use raw text
      githubMessage = responseText
    }

    switch (statusCode) {
      case 401:
        errorMessage =
          'GitHub authentication failed. Your Personal Access Token (PAT) is invalid or has expired.\n\n' +
          'Please check your PAT in settings and ensure it is still valid.'
        break

      case 403:
        // Check if it's a permissions issue
        if (
          githubMessage.toLowerCase().includes('permission') ||
          githubMessage.toLowerCase().includes('scope')
        ) {
          errorMessage =
            'GitHub permission denied. Your Personal Access Token (PAT) does not have the required permissions.\n\n' +
            'Please ensure your PAT has the "repo" scope enabled. You can update your token permissions at:\n' +
            'https://github.com/settings/tokens'
        } else if (githubMessage.toLowerCase().includes('rate limit')) {
          errorMessage =
            'GitHub API rate limit exceeded. Please wait a few minutes before trying again.\n\n' +
            'If you continue to see this error, check your rate limit status at:\n' +
            'https://github.com/settings/tokens'
        } else {
          errorMessage =
            'GitHub access forbidden. This could be due to:\n' +
            '• Insufficient PAT permissions (needs "repo" scope)\n' +
            '• Repository access restrictions\n' +
            '• Organization policies\n\n' +
            `GitHub says: ${githubMessage}`
        }
        break

      case 404:
        errorMessage =
          'GitHub repository or branch not found. This could mean:\n' +
          '• The repository does not exist or you do not have access to it\n' +
          '• The branch has not been pushed to the remote\n' +
          '• Your PAT does not have access to this repository\n\n' +
          'Please ensure the branch is pushed and you have access to the repository.'
        break

      case 422:
        // Validation error - parse the specific issue
        if (githubMessage.toLowerCase().includes('already exists')) {
          errorMessage =
            'A pull request already exists for this branch.\n\n' +
            'Please check existing pull requests or use a different branch.'
        } else if (
          githubMessage.toLowerCase().includes('no commits') ||
          githubMessage.toLowerCase().includes('same')
        ) {
          errorMessage =
            'Cannot create pull request: the head branch is the same as the base branch or has no new commits.\n\n' +
            'Please ensure your branch has commits that are not in the base branch.'
        } else {
          errorMessage =
            'GitHub validation error. The pull request parameters are invalid.\n\n' +
            `GitHub says: ${githubMessage}`
        }
        break

      default:
        errorMessage = `GitHub API error (status ${statusCode}).\n\n${githubMessage || 'Unknown error'}`
    }

    return errorMessage
  }

  /**
   * Parse GitHub API errors specific to merge operations.
   * Merge endpoint has specific error codes:
   * - 405: PR not mergeable (branch protection, required checks, etc.)
   * - 409: Merge conflict
   * - 422: Validation failed (PR not open, already merged, etc.)
   */
  private parseGitHubMergeError(statusCode: number, responseText: string): string {
    let githubMessage = ''

    try {
      const errorData = JSON.parse(responseText)
      githubMessage = errorData.message || ''
    } catch {
      githubMessage = responseText
    }

    switch (statusCode) {
      case 401:
        return (
          'GitHub authentication failed. Your Personal Access Token (PAT) is invalid or has expired.\n\n' +
          'Please check your PAT in settings and ensure it is still valid.'
        )

      case 403:
        return (
          'GitHub access forbidden. Your PAT may not have permission to merge pull requests.\n\n' +
          `GitHub says: ${githubMessage}`
        )

      case 404:
        return (
          'Pull request not found. It may have been closed or deleted.\n\n' +
          'Please refresh and try again.'
        )

      case 405:
        // Method not allowed - PR cannot be merged
        if (githubMessage.toLowerCase().includes('status check')) {
          return (
            'Cannot merge: required status checks have not passed.\n\n' +
            'Please wait for all CI checks to complete and pass before merging.'
          )
        }
        if (githubMessage.toLowerCase().includes('review')) {
          return (
            'Cannot merge: required reviews have not been approved.\n\n' +
            'Please ensure all required reviews are approved before merging.'
          )
        }
        return (
          'Pull request cannot be merged. This may be due to:\n' +
          '• Required status checks have not passed\n' +
          '• Required reviews are missing\n' +
          '• Branch protection rules are blocking the merge\n\n' +
          `GitHub says: ${githubMessage}`
        )

      case 409:
        return (
          'Cannot merge: there are merge conflicts.\n\n' +
          'Please resolve the conflicts locally and push the changes before merging.'
        )

      case 422:
        if (githubMessage.toLowerCase().includes('not open')) {
          return 'Pull request is not open. It may have already been merged or closed.'
        }
        return `Cannot merge pull request.\n\nGitHub says: ${githubMessage}`

      default:
        return `Failed to merge pull request (status ${statusCode}).\n\n${githubMessage || 'Unknown error'}`
    }
  }
}

type GitHubPullRequest = {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  draft: boolean
  /** ISO 8601 timestamp when the PR was merged, or null if not merged */
  merged_at: string | null
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
  }
  created_at: string
}

/**
 * Extended PR details from the single PR endpoint.
 * Includes mergeable fields not available in the list endpoint.
 */
type GitHubPullRequestDetails = {
  mergeable: boolean | null
  /** Undocumented but stable. Values: 'clean', 'dirty', 'blocked', 'unstable', 'unknown' */
  mergeable_state: string
  head: {
    sha: string
  }
}

/**
 * GitHub Check Run from the Check Runs API.
 * Docs: https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
 */
type GitHubCheckRun = {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'skipped'
    | 'timed_out'
    | 'action_required'
    | null
  html_url: string
  output: {
    title: string | null
    summary: string | null
  }
}

/**
 * Response from GitHub Check Runs API.
 */
type GitHubCheckRunsResponse = {
  total_count: number
  check_runs: GitHubCheckRun[]
}

/**
 * GitHub Commit Status from the legacy Status API.
 * Docs: https://docs.github.com/en/rest/commits/statuses
 */
type GitHubCommitStatus = {
  state: 'error' | 'failure' | 'pending' | 'success'
  context: string
  description: string | null
  target_url: string | null
}

/**
 * Combined status response from GitHub.
 * Docs: https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference
 */
type GitHubCombinedStatus = {
  state: 'failure' | 'pending' | 'success'
  statuses: GitHubCommitStatus[]
}
