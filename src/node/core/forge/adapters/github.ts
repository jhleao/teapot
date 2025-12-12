import { request } from 'undici'
import {
  ForgePullRequest,
  GitForgeAdapter,
  GitForgeState
} from '../../../../shared/types/git-forge'

export class GitHubAdapter implements GitForgeAdapter {
  constructor(
    private readonly pat: string,
    private readonly owner: string,
    private readonly repo: string
  ) {}

  async fetchState(): Promise<GitForgeState> {
    // Fetch PRs with all states (open, closed, merged)
    // This allows us to detect merged PRs and show appropriate UI
    // Docs: https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests
    //
    // Note: GitHub API returns state='closed' for both closed and merged PRs.
    // We distinguish merged PRs by checking the `merged_at` field (non-null = merged).
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`

    const { body, statusCode } = await request(url, {
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

    // For open (non-draft) PRs, fetch individual details to get mergeable state
    // The list endpoint doesn't include mergeable/mergeable_state fields
    const pullRequests: ForgePullRequest[] = await Promise.all(
      data.map(async (pr) => {
        const state = this.mapPrState(pr)
        let isMergeable = false

        // Only fetch mergeable state for open, non-draft PRs
        if (state === 'open') {
          try {
            const details = await this.fetchPrDetails(pr.number)
            // Only mergeable when both conditions are met:
            // - mergeable is explicitly true (not null/false)
            // - mergeable_state is 'clean' (all checks passed, no blocks)
            isMergeable = details.mergeable === true && details.mergeable_state === 'clean'
          } catch {
            // If fetching details fails, assume not mergeable
            isMergeable = false
          }
        }

        return {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state,
          headRefName: pr.head.ref,
          headSha: pr.head.sha,
          baseRefName: pr.base.ref,
          createdAt: pr.created_at,
          isMergeable
        }
      })
    )

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
   * Fetches detailed information about a specific pull request.
   * Used to get mergeable state which is not included in the list endpoint.
   *
   * Docs: https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
   */
  async fetchPrDetails(number: number): Promise<{ mergeable: boolean | null; mergeable_state: string }> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}`

    const { body, statusCode } = await request(url, {
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
      mergeable_state: data.mergeable_state
    }
  }

  /**
   * Merges a pull request using the specified merge method.
   *
   * Docs: https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
   */
  async mergePullRequest(number: number, mergeMethod: 'squash' | 'merge' | 'rebase'): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}/merge`

    const { body, statusCode } = await request(url, {
      method: 'PUT',
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
}
