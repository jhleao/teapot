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

    const pullRequests: ForgePullRequest[] = data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: this.mapPrState(pr),
      headRefName: pr.head.ref,
      headSha: pr.head.sha,
      baseRefName: pr.base.ref,
      createdAt: pr.created_at
    }))

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
      createdAt: pr.created_at
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
