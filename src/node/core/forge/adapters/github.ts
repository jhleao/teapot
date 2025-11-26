import { request } from 'undici'
import { ForgePullRequest, GitForgeAdapter, GitForgeState } from '../../../../shared/types/git-forge'

export class GitHubAdapter implements GitForgeAdapter {
  constructor(
    private readonly pat: string,
    private readonly owner: string,
    private readonly repo: string
  ) {}

  async fetchState(): Promise<GitForgeState> {
    // Fetch open PRs
    // We want 'open' state. GitHub API returns both PRs and Issues in /issues endpoint,
    // but /pulls gives us strictly PRs.
    // Docs: https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=100`

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
      state: pr.draft ? 'draft' : pr.state,
      headRefName: pr.head.ref,
      headSha: pr.head.sha,
      baseRefName: pr.base.ref,
      createdAt: pr.created_at
    }))

    return { pullRequests }
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
      throw new Error(`GitHub API failed with status ${statusCode}: ${text}`)
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
}

type GitHubPullRequest = {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  draft: boolean
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
  }
  created_at: string
}
