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
  GraphQLBranchProtectionRule,
  GraphQLCheckRun,
  GraphQLPullRequest,
  GraphQLPullRequestsResponse,
  GraphQLRuleset,
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
    const response = await this.graphqlClient.query<GraphQLPullRequestsResponse>(FETCH_PRS_QUERY, {
      owner: this.owner,
      repo: this.repo,
      first: 100
    })

    if (!response.data?.repository) {
      throw new Error('Repository not found or not accessible')
    }

    const branchProtectionRules = response.data.repository.branchProtectionRules.nodes
    const rulesets = response.data.repository.rulesets.nodes

    const pullRequests: ForgePullRequest[] = response.data.repository.pullRequests.nodes.map((pr) =>
      this.mapGraphQLPullRequest(pr, branchProtectionRules, rulesets)
    )

    return {
      pullRequests,
      rateLimit: response.rateLimit ?? undefined
    }
  }

  /**
   * Maps a GraphQL PR response to our ForgePullRequest type.
   */
  private mapGraphQLPullRequest(
    pr: GraphQLPullRequest,
    branchProtectionRules: GraphQLBranchProtectionRule[],
    rulesets: GraphQLRuleset[]
  ): ForgePullRequest {
    const state = this.mapGraphQLPrState(pr)
    const checks = this.extractGraphQLChecks(pr)
    const mergeReadiness = this.buildGraphQLMergeReadiness(
      pr,
      checks,
      branchProtectionRules,
      rulesets
    )

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
    const allChecks = contexts.map((ctx) => {
      if (ctx.__typename === 'CheckRun') {
        return this.mapGraphQLCheckRun(ctx)
      } else {
        return this.mapGraphQLStatusContext(ctx)
      }
    })

    // Deduplicate by name — GitHub can return multiple CheckRun entries for
    // the same check (e.g. re-runs). Contexts are returned in chronological
    // order, so the last entry for a given name is the most recent.
    const byName = new Map<string, StatusCheck>()
    for (const check of allChecks) {
      byName.set(check.name, check)
    }
    return [...byName.values()]
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
   * Finds the branch protection rule that matches a given branch name.
   * Patterns can be exact matches or glob patterns (e.g., "main", "releases/*").
   */
  private findMatchingBranchProtectionRule(
    branchName: string,
    rules: GraphQLBranchProtectionRule[]
  ): GraphQLBranchProtectionRule | undefined {
    return rules.find((rule) => {
      // Exact match
      if (rule.pattern === branchName) return true
      // Simple glob pattern matching (e.g., "releases/*" matches "releases/v1")
      if (rule.pattern.endsWith('/*')) {
        const prefix = rule.pattern.slice(0, -1) // Remove trailing *
        return branchName.startsWith(prefix)
      }
      // Wildcard at start (e.g., "*/main" matches "feature/main")
      if (rule.pattern.startsWith('*/')) {
        const suffix = rule.pattern.slice(2) // Remove leading */
        return branchName.endsWith(suffix)
      }
      return false
    })
  }

  /**
   * Extracts required status check contexts from rulesets that apply to a branch.
   * Rulesets can target branches via patterns like "~DEFAULT_BRANCH", "refs/heads/main", etc.
   */
  private extractRequiredChecksFromRulesets(
    branchName: string,
    rulesets: GraphQLRuleset[]
  ): string[] {
    const requiredChecks: string[] = []

    for (const ruleset of rulesets) {
      // Skip disabled rulesets
      if (ruleset.enforcement === 'DISABLED') continue

      // Only consider branch-targeting rulesets
      if (ruleset.target !== 'BRANCH') continue

      // Check if this ruleset applies to the branch
      const includePatterns = ruleset.conditions?.refName?.include ?? []
      const appliesToBranch = includePatterns.some((pattern) => {
        // Handle special patterns
        if (pattern === '~DEFAULT_BRANCH') {
          // Assume main/master are default branches
          return branchName === 'main' || branchName === 'master'
        }
        if (pattern === '~ALL') {
          return true
        }
        // Handle refs/heads/ prefix
        const normalizedPattern = pattern.startsWith('refs/heads/')
          ? pattern.slice('refs/heads/'.length)
          : pattern
        // Exact match
        if (normalizedPattern === branchName) return true
        // Glob patterns (simplified)
        if (normalizedPattern.endsWith('/*')) {
          const prefix = normalizedPattern.slice(0, -1)
          return branchName.startsWith(prefix)
        }
        if (normalizedPattern.startsWith('*/')) {
          const suffix = normalizedPattern.slice(2)
          return branchName.endsWith(suffix)
        }
        return false
      })

      if (!appliesToBranch) continue

      // Extract required status checks from the ruleset rules
      for (const rule of ruleset.rules.nodes) {
        if (rule.type === 'REQUIRED_STATUS_CHECKS' && rule.parameters?.requiredStatusChecks) {
          for (const check of rule.parameters.requiredStatusChecks) {
            requiredChecks.push(check.context)
          }
        }
      }
    }

    return requiredChecks
  }

  /**
   * Builds MergeReadiness from GraphQL PR data.
   */
  private buildGraphQLMergeReadiness(
    pr: GraphQLPullRequest,
    checks: StatusCheck[],
    branchProtectionRules: GraphQLBranchProtectionRule[],
    rulesets: GraphQLRuleset[]
  ): MergeReadiness {
    const canMerge = pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'CLEAN'

    // Find matching branch protection rule for the PR's base branch
    const protectionRule = this.findMatchingBranchProtectionRule(
      pr.baseRefName,
      branchProtectionRules
    )

    // Get required check names from branch protection rules
    const protectionRuleChecks: string[] =
      protectionRule?.requiredStatusChecks?.map((c) => c.context) ?? []

    // Get required check names from rulesets
    const rulesetChecks = this.extractRequiredChecksFromRulesets(pr.baseRefName, rulesets)

    // Combine both sources, deduplicating by lowercase name
    const allRequiredChecks = new Set<string>()
    for (const name of [...protectionRuleChecks, ...rulesetChecks]) {
      allRequiredChecks.add(name)
    }
    const requiredCheckNames = [...allRequiredChecks]

    const existingCheckNames = new Set(checks.map((c) => c.name.toLowerCase()))
    const expectedChecks: StatusCheck[] = requiredCheckNames
      .filter((name) => !existingCheckNames.has(name.toLowerCase()))
      .map((name) => ({
        name,
        status: 'expected' as const,
        description: 'Waiting for status to be reported'
      }))

    // Combine existing checks with expected checks
    const allChecks = [...checks, ...expectedChecks]

    // Surface review approval as a visible status check.
    // The "review required" blocker (when reviewDecision is REVIEW_REQUIRED or
    // CHANGES_REQUESTED) is handled separately by deriveGraphQLBlockers — don't
    // duplicate that here. Only inject the approval state so it doesn't silently
    // vanish from the checks list once the review is approved.
    if (pr.reviewDecision === 'APPROVED') {
      allChecks.push({
        name: 'Review',
        status: 'success',
        description: 'Approved'
      })
    }

    const blockers = this.deriveGraphQLBlockers(pr, checks, protectionRule)
    let checksStatus = this.deriveChecksStatus(allChecks)

    // Account for expected checks: if the rollup state indicates pending/failure
    // but individual checks all show success (or none exist), trust the rollup.
    const rollupState = pr.commits.nodes[0]?.commit.statusCheckRollup?.state
    if (
      rollupState &&
      (checksStatus === 'success' || checksStatus === 'none') &&
      rollupState === 'EXPECTED'
    ) {
      // Required checks exist but haven't started yet
      checksStatus = 'expected'
    } else if (
      rollupState &&
      (checksStatus === 'success' || checksStatus === 'none') &&
      rollupState === 'PENDING'
    ) {
      checksStatus = 'pending'
    } else if (
      rollupState &&
      checksStatus === 'success' &&
      (rollupState === 'FAILURE' || rollupState === 'ERROR')
    ) {
      checksStatus = 'failure'
    }

    return {
      canMerge,
      blockers,
      checksStatus,
      checks: allChecks
    }
  }

  /**
   * Derives merge blockers from GraphQL PR state.
   */
  private deriveGraphQLBlockers(
    pr: GraphQLPullRequest,
    checks: StatusCheck[],
    _protectionRule?: GraphQLBranchProtectionRule
  ): MergeBlocker[] {
    const blockers: MergeBlocker[] = []

    // Unknown mergeable state - still computing
    if (pr.mergeable === 'UNKNOWN') {
      blockers.push('computing')
    }

    // Merge conflicts
    if (pr.mergeable === 'CONFLICTING') {
      blockers.push('conflicts')
    }

    // Review decision from GitHub (direct signal, works with both classic branch protection and rulesets)
    if (pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewDecision === 'CHANGES_REQUESTED') {
      blockers.push('reviews_required')
    }

    // Map mergeStateStatus to blockers
    switch (pr.mergeStateStatus) {
      case 'BLOCKED':
        if (checks.some((c) => c.status === 'failure')) {
          blockers.push('checks_failed')
        } else if (checks.some((c) => c.status === 'pending')) {
          blockers.push('checks_pending')
        } else if (!blockers.includes('reviews_required')) {
          // BLOCKED with no failing/pending checks and no review requirement detected —
          // likely a branch protection rule we can't identify specifically
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
   * Derives the overall checks status from individual check results.
   */
  private deriveChecksStatus(checks: StatusCheck[]): MergeReadiness['checksStatus'] {
    if (checks.length === 0) return 'none'
    if (checks.some((c) => c.status === 'failure')) return 'failure'
    if (checks.some((c) => c.status === 'pending')) return 'pending'
    if (checks.some((c) => c.status === 'expected')) return 'expected'
    return 'success'
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
