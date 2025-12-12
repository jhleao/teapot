export type LocalRepo = {
  path: string
  isSelected: boolean
}

export type UiState = {
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
  /** The SHA of the current trunk head commit. Used for rebase operations. */
  trunkHeadSha: string
}

export type UiStack = {
  commits: UiCommit[]
  isTrunk: boolean
}

export type UiCommit = {
  sha: string
  name: string
  timestampMs: number
  spinoffs: UiStack[]
  rebaseStatus: UiCommitRebaseStatus
  /** Mostly redundant with branches.isCurrent, but not always (commits can be checked out without a branch). */
  isCurrent: boolean
  /** Which branches is this commit a tip of. */
  branches: UiBranch[]
}

export type UiBranch = {
  name: string
  /**
   * This is needed alongside UiCommit.isCurrent because
   * a single commit can be a tip of multiple branches.
   * You could be checked out to any of these branches,
   * or just directly to the commit.
   */
  isCurrent: boolean
  pullRequest?: UiPullRequest
  /**
   * True if this branch has been merged into trunk.
   * Detected via:
   * 1. GitHub PR state === 'merged'
   * 2. Local detection: branch head is ancestor of trunk (fallback)
   */
  isMerged?: boolean
}

export type UiPullRequest = {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged' | 'draft'
  /**
   * True if the local branch tip matches the PR head SHA.
   */
  isInSync: boolean
}

export type UiWorkingTreeFile = {
  stageStatus: 'staged' | 'unstaged' | 'partially-staged'
  path: string
  status: 'modified' | 'deleted' | 'renamed' | 'added' | 'conflicted'
}

export type UiCommitRebaseStatus =
  /** This commit is the base of a rebase plan and is showing a button for confirming/canceling the plan. */
  | 'prompting'
  /** This commit is a child of a 'prompting' commit, so it's just waiting for confirmation. */
  | 'idle'
  /** This commit is being rebased right now. */
  | 'running'
  /** This commit has conflicts that must be resolved before proceeding. */
  | 'conflicted'
  /** This commit's conflicts have been resolved and is waiting for user to click Continue. */
  | 'resolved'
  /** This commit is part of a confirmed rebase plan that is running. It's just not its turn yet. */
  | 'scheduled'
  /** This commit is not being rebased or involved in a rebasing operation. */
  | null
