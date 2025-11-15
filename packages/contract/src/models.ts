type Contract = {};

export type Repo = {
  path: string;
  branches: Branch[];
};

export type Branch = {
  ref: string;
  isTrunk: boolean;
};

export type Configuration = {
  repoPath: string;
};

