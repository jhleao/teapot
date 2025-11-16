import type { Repo, Branch, Commit as DomainCommit, WorkingTreeStatus, Stack } from '@teapot/contract';

const CANONICAL_TRUNK_NAMES = ['main', 'master', 'develop'];

type UiCommit = Stack['commits'][number];

type BuildState = {
  commitMap: Map<string, DomainCommit>;
  tipOfBranches: Map<string, string[]>;
  commitNodes: Map<string, UiCommit>;
  currentBranch: string;
  trunkShas: Set<string>;
  stackMembership: Map<string, Stack>;
};

type TrunkBuildResult = {
  stack: Stack;
  trunkSet: Set<string>;
};

export function buildUiState(repo: Repo): Stack[] {
  if (!repo.commits.length) {
    return [];
  }

  const commitMap = new Map<string, DomainCommit>(repo.commits.map((commit) => [commit.sha, commit]));
  const tipOfBranches = buildTipOfBranches(repo.branches);
  const trunk = findTrunkBranch(repo.branches, repo.workingTreeStatus);
  let stackBranches = selectBranchesForStacks(repo.branches);
  if (trunk && !stackBranches.some((branch) => branch.ref === trunk.ref)) {
    stackBranches = [...stackBranches, trunk];
  }
  if (stackBranches.length === 0) {
    return [];
  }

  const state: BuildState = {
    commitMap,
    tipOfBranches,
    commitNodes: new Map(),
    currentBranch: repo.workingTreeStatus.currentBranch,
    trunkShas: new Set(),
    stackMembership: new Map(),
  };

  const stacks: Stack[] = [];
  if (trunk) {
    const trunkResult = buildTrunkStack(trunk, state);
    if (!trunkResult) {
      return [];
    }
    state.trunkShas = trunkResult.trunkSet;
    trunkResult.stack.commits.forEach((commit) => {
      state.stackMembership.set(commit.sha, trunkResult.stack);
    });
    stacks.push(trunkResult.stack);
    trunkResult.stack.commits.forEach((commit) => {
      createSpinoffStacks(commit, state);
    });
  }

  const annotationBranches = [...stackBranches].sort((a, b) => {
    if (trunk) {
      if (a.ref === trunk.ref && b.ref !== trunk.ref) {
        return -1;
      }
      if (b.ref === trunk.ref && a.ref !== trunk.ref) {
        return 1;
      }
    }
    if (a.isRemote && !b.isRemote) {
      return 1;
    }
    if (!a.isRemote && b.isRemote) {
      return -1;
    }
    return a.ref.localeCompare(b.ref);
  });

  annotateBranchHeads(annotationBranches, state);

  return stacks;
}

function selectBranchesForStacks(branches: Branch[]): Branch[] {
  const canonicalRefs = new Set(
    branches.filter((branch) => isCanonicalTrunkBranch(branch)).map((branch) => branch.ref)
  );
  const localOrTrunk = branches.filter(
    (branch) => !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
  );
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

function findTrunkBranch(branches: Branch[], workingTree: WorkingTreeStatus): Branch | null {
  const normalizedCurrent = workingTree.currentBranch;
  return (
    branches.find((branch) => branch.isTrunk && !branch.isRemote) ??
    branches.find((branch) => branch.isTrunk) ??
    branches.find((branch) => isCanonicalTrunkBranch(branch) && !branch.isRemote) ??
    branches.find((branch) => isCanonicalTrunkBranch(branch)) ??
    branches.find((branch) => normalizeBranchRef(branch) === normalizedCurrent) ??
    branches.find((branch) => branch.ref === normalizedCurrent) ??
    branches[0] ??
    null
  );
}

function buildTrunkStack(branch: Branch, state: BuildState): TrunkBuildResult | null {
  if (!branch.headSha) {
    return null;
  }
  const lineage = collectBranchLineage(branch.headSha, state.commitMap);
  if (lineage.length === 0) {
    return null;
  }
  const commits: UiCommit[] = [];
  lineage.forEach((sha) => {
    const node = getOrCreateUiCommit(sha, state);
    if (node) {
      commits.push(node);
    }
  });
  if (commits.length === 0) {
    return null;
  }
  const tipCommit = commits[commits.length - 1];
  if (tipCommit) {
    tipCommit.branch = {
      name: branch.ref,
      isCurrent: branch.ref === state.currentBranch,
    };
  }
  return { stack: { commits }, trunkSet: new Set(lineage) };
}

function collectBranchLineage(headSha: string, commitMap: Map<string, DomainCommit>): string[] {
  const shas: string[] = [];
  let currentSha: string | null = headSha;
  const visited = new Set<string>();
  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha);
    shas.push(currentSha);
    const commit = commitMap.get(currentSha);
    if (!commit?.parentSha) {
      break;
    }
    currentSha = commit.parentSha;
  }
  return shas.slice().reverse();
}

function createSpinoffStacks(parentCommit: UiCommit, state: BuildState): void {
  const domainCommit = state.commitMap.get(parentCommit.sha);
  if (!domainCommit) {
    return;
  }
  const childShas = getOrderedChildren(domainCommit, state, { excludeTrunk: true });
  childShas.forEach((childSha) => {
    if (state.stackMembership.has(childSha)) {
      return;
    }
    const stack = buildNonTrunkStack(childSha, state);
    if (stack) {
      parentCommit.spinoffs.push(stack);
    }
  });
}

function buildNonTrunkStack(startSha: string, state: BuildState): Stack | null {
  const stack: Stack = { commits: [] };
  let currentSha: string | null = startSha;
  const visited = new Set<string>();

  while (currentSha && !visited.has(currentSha)) {
    if (state.stackMembership.has(currentSha)) {
      break;
    }
    visited.add(currentSha);
    const commitNode = getOrCreateUiCommit(currentSha, state);
    if (!commitNode) {
      break;
    }
    stack.commits.push(commitNode);
    state.stackMembership.set(currentSha, stack);

    const domainCommit = state.commitMap.get(currentSha);
    if (!domainCommit) {
      break;
    }
    const childShas = getOrderedChildren(domainCommit, state, { excludeTrunk: true });
    if (childShas.length === 0) {
      break;
    }
    if (childShas.length === 1) {
      const [nextSha] = childShas;
      if (!nextSha) {
        break;
      }
      currentSha = nextSha;
      continue;
    }
    const [continuationSha, ...spinoffShas] = childShas;
    if (!continuationSha) {
      break;
    }
    spinoffShas.forEach((childSha) => {
      if (state.stackMembership.has(childSha)) {
        return;
      }
      const spinoffStack = buildNonTrunkStack(childSha, state);
      if (spinoffStack) {
        commitNode.spinoffs.push(spinoffStack);
      }
    });
    currentSha = continuationSha;
  }

  return stack.commits.length > 0 ? stack : null;
}

function getOrderedChildren(
  commit: DomainCommit,
  state: BuildState,
  options: { excludeTrunk?: boolean } = {}
): string[] {
  const { excludeTrunk = false } = options;
  const knownChildren = commit.childrenSha.filter((sha) => state.commitMap.has(sha));
  const filtered = excludeTrunk ? knownChildren.filter((sha) => !state.trunkShas.has(sha)) : knownChildren;
  return filtered.sort((a, b) => {
    const timeDiff = (state.commitMap.get(a)?.timeMs ?? 0) - (state.commitMap.get(b)?.timeMs ?? 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.localeCompare(b);
  });
}

function annotateBranchHeads(branches: Branch[], state: BuildState): void {
  branches.forEach((branch) => {
    if (!branch.headSha) {
      return;
    }
    const commitNode = state.commitNodes.get(branch.headSha);
    if (!commitNode || commitNode.branch) {
      return;
    }
    commitNode.branch = {
      name: branch.ref,
      isCurrent: branch.ref === state.currentBranch,
    };
  });
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

function normalizeBranchRef(branch: Branch): string {
  if (!branch.isRemote) {
    return branch.ref;
  }
  const slashIndex = branch.ref.indexOf('/');
  return slashIndex >= 0 ? branch.ref.slice(slashIndex + 1) : branch.ref;
}

function isCanonicalTrunkBranch(branch: Branch): boolean {
  const normalized = normalizeBranchRef(branch);
  return CANONICAL_TRUNK_NAMES.includes(normalized);
}
