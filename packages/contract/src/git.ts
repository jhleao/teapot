export type Repo = {
  path: string;
  commits: Commit[];
  branches: Branch[];
  workingTreeStatus: WorkingTreeStatus;
};

export type Branch = {
  ref: string;
  isTrunk: boolean;
  isRemote: boolean;
  headSha: string;
};

export type Commit = {
  sha: string;
  message: string;
  timeMs: number;
  parentSha: string;
  childrenSha: string[];
};

export type WorkingTreeStatus = {
  /** Logical name of the branch that HEAD points at, e.g. main, feature/foo. */
  currentBranch: string;
  /** HEAD SHA; anchor for diffs and ahead/behind calculations. */
  currentCommitSha: string;
  /** Configured upstream for currentBranch (e.g. origin/main) or null when unset. */
  tracking: string | null;
  /** True when HEAD is detached (points directly to a commit rather than refs/heads/*). */
  detached: boolean;
  /** True when a rebase is in progress (.git/rebase-merge or .git/rebase-apply exists). */
  isRebasing: boolean;
  /** Paths with index changes (added/modified/removed in the index vs HEAD). */
  staged: string[];
  /** Paths changed in working tree but not staged (diff between index and workdir). */
  modified: string[];
  /** New, tracked files. */
  created: string[];
  /** Paths removed from workdir or staged as deletions. */
  deleted: string[];
  /** Paths detected as renames/moves (R entries in status). */
  renamed: string[];
  /** Untracked files (present in workdir, absent from index and HEAD). */
  not_added: string[];
  /** Paths with merge/rebase conflicts (e.g. U* status codes). */
  conflicted: string[];
  /** Convenience union of all paths that differ from a clean state */
  allChangedFiles: string[];
};

export type Configuration = {
  repoPath: string;
};
