export type Repo = {
  path: string;
  commits: Commit[];
  branches: Branch[];
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

export type Configuration = {
  repoPath: string;
};
