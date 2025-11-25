export type GitForgeState = {
  pullRequests: ForgePullRequest[]
}

export type ForgePullRequest = {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged' | 'draft'

  /**
   * The name of the branch where the changes are implemented.
   * Used to link the PR to a local branch.
   */
  headRefName: string

  /**
   * The SHA of the commit at the tip of the PR branch.
   * Used to determine if the local branch is in sync with the PR.
   */
  headSha: string

  /**
   * The name of the branch into which the changes are to be merged.
   */
  baseRefName: string

  createdAt: string
}

export interface GitForgeAdapter {
  /**
   * Fetches the current state of the forge (e.g. open PRs).
   * This is expected to be called periodically or on demand.
   */
  fetchState(): Promise<GitForgeState>

  /**
   * Creates a new pull request.
   */
  createPullRequest(
    title: string,
    headBranch: string,
    baseBranch: string,
    draft?: boolean
  ): Promise<ForgePullRequest>
}
