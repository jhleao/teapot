export type GitState = {
  revisionMap: Record<string, Revision>;
  rootRevisionID: string;
  branches: Record<string, BranchInfo>;
  currentStatus: WorkingTreeStatus;
  trunkBranch: string;
  trunkBranchID: string;
  prTemplate: PullRequestTemplate | null;
};

export type Revision = {
  hash: string;
  abbrevHash: string;
  treeHash: string;
  parentIDs: string[];
  childrenIDs: string[];
  mergedChildrenIDs: string[];
  author: Person;
  committer: Person;
  subject: string;
  title: string;
  files: string[];
  status: string[];
  branchIDs: string[];
  localBranchIDs: string[];
  remoteBranchIDs: string[];
  isTrunk: boolean;
  isLeftTrunk: boolean;
  isTipOfTrunk: boolean;
  isTipOfRemoteTrunk: boolean;
  isDescendantOfTrunk: boolean;
  canHide: boolean;
};

export type BranchInfo = {
  name: string;
  label: string;
  commit: string;
  current: boolean;
  hasRemote: boolean;
  isRemote: boolean;
  isDetached: boolean;
};

export type WorkingTreeStatus = {
  currentBranch: string;
  currentRevisionID: string;
  isClean: boolean;
  ahead: number;
  behind: number;
  tracking: string | null;
  staged: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  renamed: string[];
  not_added: string[];
  conflicted: string[];
  conflictedMap: Record<string, unknown>;
  allChangedFiles: string[];
  ghOwner?: string;
  ghRepo?: string;
  isRebasing: boolean;
  detached: boolean;
};

export type Person = {
  name: string;
  email: string;
  date?: string;
  relativeDate?: string;
  avatarUrl?: string;
};

export type PullRequest = {
  id?: number;
  number?: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged' | 'draft';
  baseBranch: string;
  headBranch: string;
  author: Person;
  assignees: Person[];
  reviewers: Person[];
  labels: string[];
  mergeCommitSha?: string;
  createdAt: string;
  updatedAt: string;
  template: PullRequestTemplate | null;
};

export type PullRequestTemplate = {
  path: string;
  raw: string;
  sections: PullRequestTemplateSection[];
};

export type PullRequestTemplateSection = {
  title: string;
  body: string;
  checklistItems: string[];
};
