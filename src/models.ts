export type Repo = {
  path: string;
  branches: Branch[];
};

export type Branch = {
  ref: string;
  isTrunk: boolean;
};
