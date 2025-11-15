import type { Repo, Branch, Commit as DomainCommit, WorkingTreeStatus, Stack } from '@teapot/contract';

type UiCommit = Stack['commits'][number];

type BuildState = {
  repo: Repo;
  commitMap: Map<string, DomainCommit>;
  tipOfBranches: Map<string, string[]>;
  membership: Map<string, Set<string>>;
  commitNodes: Map<string, UiCommit>;
  branchRanks: Map<string, number>;
  stackBranchRefs: Set<string>;
  currentBranch: string;
};

type BranchAttachment = {
  exclusiveShas: string[];
  attachmentSha: string | null;
};

export function buildUiState(repo: Repo): Stack[] {
  if (!repo.commits.length) {
    return [];
  }

  const commitMap = new Map<string, DomainCommit>(repo.commits.map((commit) => [commit.sha, commit]));
  const tipOfBranches = buildTipOfBranches(repo.branches);
  const stackBranches = selectBranchesForStacks(repo.branches);
  if (stackBranches.length === 0) {
    return [];
  }

  const membership = buildMembershipMap(stackBranches, commitMap);
  const trunk = findTrunkBranch(stackBranches, repo.workingTreeStatus);
  const branchRanks = computeBranchRanks(stackBranches, membership, commitMap, trunk?.ref ?? null);
  const stackBranchRefs = new Set(stackBranches.map((branch) => branch.ref));

  const state: BuildState = {
    repo,
    commitMap,
    tipOfBranches,
    membership,
    commitNodes: new Map(),
    branchRanks,
    stackBranchRefs,
    currentBranch: repo.workingTreeStatus.currentBranch,
  };

  const stacks: Stack[] = [];
  const orderedBranches = [...stackBranches].sort((a, b) => {
    const rankDiff = (branchRanks.get(a.ref) ?? Number.MAX_SAFE_INTEGER) - (branchRanks.get(b.ref) ?? Number.MAX_SAFE_INTEGER);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.ref.localeCompare(b.ref);
  });

  orderedBranches.forEach((branch) => {
    attachBranchStack(branch, state, stacks);
  });

  return stacks;
}

function selectBranchesForStacks(branches: Branch[]): Branch[] {
  const localOrTrunk = branches.filter((branch) => !branch.isRemote || branch.isTrunk);
  return localOrTrunk.length > 0 ? localOrTrunk : branches;
}

function buildTipOfBranches(branches: Branch[]): Map<string, string[]> {
  const tips = new Map<string, string[]>();
  branches.forEach((branch) => {
    if (!branch.headSha) {
      return;
    }
    const entries = tips.get(branch.headSha) ?? [];
    entries.push(branch.ref);
    tips.set(branch.headSha, entries);
  });
  return tips;
}

function buildMembershipMap(
  branches: Branch[],
  commitMap: Map<string, DomainCommit>
): Map<string, Set<string>> {
  const membership = new Map<string, Set<string>>();

  branches.forEach((branch) => {
    if (!branch.headSha) {
      return;
    }
    let currentSha: string | null = branch.headSha;
    const visited = new Set<string>();
    while (currentSha && !visited.has(currentSha)) {
      visited.add(currentSha);
      const members = membership.get(currentSha) ?? new Set<string>();
      members.add(branch.ref);
      membership.set(currentSha, members);
      const commit = commitMap.get(currentSha);
      if (!commit?.parentSha) {
        break;
      }
      currentSha = commit.parentSha;
    }
  });

  return membership;
}

function findTrunkBranch(branches: Branch[], workingTree: WorkingTreeStatus): Branch | null {
  return (
    branches.find((branch) => branch.isTrunk) ??
    branches.find((branch) => branch.ref === workingTree.currentBranch) ??
    branches[0] ??
    null
  );
}

function computeBranchRanks(
  branches: Branch[],
  membership: Map<string, Set<string>>,
  commitMap: Map<string, DomainCommit>,
  trunkRef: string | null
): Map<string, number> {
  const ranks = new Map<string, number>();

  branches.forEach((branch) => {
    const rank = branch.ref === trunkRef ? 0 : 1 + computeDistanceToTrunk(branch, membership, commitMap, trunkRef);
    ranks.set(branch.ref, rank);
  });

  return ranks;
}

function computeDistanceToTrunk(
  branch: Branch,
  membership: Map<string, Set<string>>,
  commitMap: Map<string, DomainCommit>,
  trunkRef: string | null
): number {
  if (!branch.headSha) {
    return Number.MAX_SAFE_INTEGER / 2;
  }
  if (!trunkRef) {
    return 0;
  }
  let steps = 0;
  let currentSha: string | null = branch.headSha;
  const visited = new Set<string>();
  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha);
    const commitMembership = membership.get(currentSha);
    if (commitMembership?.has(trunkRef)) {
      return steps;
    }
    steps += 1;
    const commit = commitMap.get(currentSha);
    if (!commit?.parentSha) {
      break;
    }
    currentSha = commit.parentSha;
  }

  return steps;
}

function attachBranchStack(branch: Branch, state: BuildState, stacks: Stack[]): void {
  if (!branch.headSha) {
    return;
  }

  const attachment = traceBranchAttachment(branch, state);
  if (attachment.exclusiveShas.length === 0 && attachment.attachmentSha) {
    annotateExistingCommitWithBranch(branch, attachment.attachmentSha, state);
    return;
  }

  const commits = buildStackCommits(attachment.exclusiveShas, branch, state);
  if (commits.length === 0) {
    return;
  }

  commits[commits.length - 1].branch = {
    name: branch.ref,
    isCurrent: branch.ref === state.currentBranch,
  };

  const stack: Stack = { commits };
  if (attachment.attachmentSha) {
    const parentCommit = state.commitNodes.get(attachment.attachmentSha);
    if (parentCommit) {
      parentCommit.spinoffs.push(stack);
      return;
    }
  }

  stacks.push(stack);
}

function traceBranchAttachment(branch: Branch, state: BuildState): BranchAttachment {
  const exclusiveShas: string[] = [];
  let currentSha: string | null = branch.headSha ?? null;
  const visited = new Set<string>();
  const currentRank = state.branchRanks.get(branch.ref) ?? Number.POSITIVE_INFINITY;

  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha);
    const membership = state.membership.get(currentSha);
    const otherRefs =
      membership?.has(branch.ref) && membership.size > 1
        ? [...membership].filter((ref) => {
            if (ref === branch.ref) {
              return false;
            }
            if (!state.stackBranchRefs.has(ref)) {
              return false;
            }
            const refRank = state.branchRanks.get(ref);
            return refRank !== undefined && refRank < currentRank;
          })
        : [];

    if (otherRefs.length > 0) {
      const attachmentRef = chooseParentBranch(otherRefs, state.branchRanks);
      if (attachmentRef) {
        return { exclusiveShas, attachmentSha: currentSha };
      }
    }

    exclusiveShas.push(currentSha);
    const commit = state.commitMap.get(currentSha);
    if (!commit?.parentSha) {
      break;
    }
    currentSha = commit.parentSha;
  }

  return { exclusiveShas, attachmentSha: null };
}

function chooseParentBranch(branchRefs: string[], ranks: Map<string, number>): string | null {
  let bestRef: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  branchRefs.forEach((ref) => {
    const rank = ranks.get(ref);
    if (rank !== undefined && rank < bestRank) {
      bestRank = rank;
      bestRef = ref;
    }
  });

  return bestRef;
}

function annotateExistingCommitWithBranch(branch: Branch, commitSha: string, state: BuildState): void {
  const commitNode = state.commitNodes.get(commitSha);
  if (!commitNode) {
    return;
  }
  if (!commitNode.branch) {
    commitNode.branch = {
      name: branch.ref,
      isCurrent: branch.ref === state.currentBranch,
    };
  }
}

function buildStackCommits(shas: string[], branch: Branch, state: BuildState): UiCommit[] {
  const commits: UiCommit[] = [];
  shas
    .slice()
    .reverse()
    .forEach((sha) => {
      const commitNode = getOrCreateUiCommit(sha, state);
      if (commitNode) {
        commits.push(commitNode);
      }
    });
  return commits;
}

function getOrCreateUiCommit(sha: string, state: BuildState): UiCommit | null {
  const existing = state.commitNodes.get(sha);
  if (existing) {
    return existing;
  }
  const commit = state.commitMap.get(sha);
  if (!commit) {
    return null;
  }

  const uiCommit: UiCommit = {
    sha: commit.sha,
    name: formatCommitName(commit),
    timestampMs: commit.timeMs ?? 0,
    tipOfBranches: state.tipOfBranches.get(commit.sha) ?? [],
    spinoffs: [],
  };
  state.commitNodes.set(sha, uiCommit);
  return uiCommit;
}

function formatCommitName(commit: DomainCommit): string {
  const subject = commit.message.split('\n')[0] || '(no message)';
  const shortSha = commit.sha.slice(0, 7);
  return `${shortSha} ${subject}`;
}
