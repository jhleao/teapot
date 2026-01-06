import type { MergeReadiness } from './git-forge'

export type LocalRepo = {
  path: string
  isSelected: boolean
  /** Active worktree path, or null to use main worktree. */
  activeWorktreePath: string | null
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
  /** True if this is a remote-tracking branch (e.g., origin/main) */
  isRemote: boolean
  /** True if this is a trunk branch (main, master, origin/main, origin/master) */
  isTrunk: boolean
  pullRequest?: UiPullRequest
  /**
   * True if this branch has been merged into trunk.
   * Detected via:
   * 1. GitHub PR state === 'merged'
   * 2. Local detection: branch head is ancestor of trunk (fallback)
   */
  isMerged?: boolean
  /**
   * True if this branch has a PR that targets a merged branch.
   * Ship It should be disabled when true.
   */
  hasStaleTarget?: boolean
  /**
   * If this branch is checked out in a worktree (other than the current one),
   * this contains information about that worktree.
   */
  worktree?: UiWorktreeBadge
}

/**
 * Information about a worktree that has this branch checked out.
 * Used for displaying worktree badges on branches.
 */
export type UiWorktreeBadge = {
  /** Absolute path to the worktree */
  path: string
  /**
   * Status of the worktree:
   * - 'clean': No uncommitted changes
   * - 'dirty': Has uncommitted changes (branch is blocked)
   * - 'active': This is the currently active worktree in Teapot
   * - 'stale': Worktree path no longer exists
   */
  status: 'clean' | 'dirty' | 'active' | 'stale'
  /** True if this is the main worktree (original clone location) */
  isMain: boolean
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
  /**
   * True if the PR can be merged (no conflicts, checks passed, not blocked by branch policies).
   * Only true when GitHub returns mergeable=true AND mergeable_state='clean'.
   */
  isMergeable: boolean
  /**
   * Detailed merge readiness information including CI check status.
   * Only populated for open PRs.
   */
  mergeReadiness?: MergeReadiness
}

export type UiWorkingTreeFile = {
  stageStatus: 'staged' | 'unstaged' | 'partially-staged'
  path: string
  status: 'modified' | 'deleted' | 'renamed' | 'added' | 'conflicted'
  /** For conflicted files: true if conflict markers have been removed from the file */
  resolved?: boolean
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
  /** This branch is pending in queue after an external continue - waiting for user to resume. */
  | 'queued'
  /** This commit is not being rebased or involved in a rebasing operation. */
  | null

// ============================================================================
// Ship It Navigation Types
// ============================================================================

/**
 * Result of Ship It navigation after merging a PR.
 */
export type ShipItNavigationResult = {
  /** What action was taken */
  action: 'stayed' | 'switched-to-main' | 'switched-to-parent'
  /** Branch user is now on (if switched) */
  targetBranch?: string
  /** Info message to show user */
  message: string
  /** Whether remaining branches need rebasing */
  needsRebase: boolean
}

/**
 * Context needed to determine Ship It navigation.
 */
export type ShipItNavigationContext = {
  /** Repository path for git operations */
  repoPath: string
  /** The branch that was shipped */
  shippedBranch: string
  /** The branch the PR targeted (parent or main) */
  prTargetBranch: string
  /** The branch user was on before shipping */
  userCurrentBranch: string | null
  /** Whether user was in detached HEAD */
  wasDetached: boolean
  /** Whether shipped branch has children in the stack */
  hasChildren: boolean
  /** Whether working tree is clean */
  isWorkingTreeClean: boolean
}
