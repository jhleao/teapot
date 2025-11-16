export type UiState = {
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
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
}

export type UiWorkingTreeFile = {
  isStaged: boolean
  path: string
  status: 'modified' | 'deleted' | 'renamed' | 'untracked'
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
  /** This commit is part of a confirmed rebase plan that is running. It's just not its turn yet. */
  | 'scheduled'
  /** This commit is not being rebased or involved in a rebasing operation. */
  | null
