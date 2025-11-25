import type {
  Branch,
  Commit as DomainCommit,
  RebaseIntent,
  RebaseJobId,
  RebaseProjection,
  RebaseState,
  Repo,
  StackNodeState,
  UiStack,
  UiPullRequest,
  WorkingTreeStatus
} from '@shared/types'
import { createRebasePlan } from '@shared/types'
import { GitForgeState } from '../../../shared/types/git-forge'

const CANONICAL_TRUNK_NAMES = ['main', 'master', 'develop']

type UiCommit = UiStack['commits'][number]

type BuildState = {
  commitMap: Map<string, DomainCommit>
  commitNodes: Map<string, UiCommit>
  currentBranch: string
  currentCommitSha: string
  trunkShas: Set<string>
  UiStackMembership: Map<string, UiStack>
}

type TrunkBuildResult = {
  UiStack: UiStack
  trunkSet: Set<string>
}

export function buildUiStack(repo: Repo, gitForgeState: GitForgeState | null = null): UiStack | null {
  if (!repo.commits.length) {
    return null
  }

  const commitMap = new Map<string, DomainCommit>(
    repo.commits.map((commit) => [commit.sha, commit])
  )
  const trunk = findTrunkBranch(repo.branches, repo.workingTreeStatus)
  let UiStackBranches = selectBranchesForUiStacks(repo.branches)
  if (trunk && !UiStackBranches.some((branch) => branch.ref === trunk.ref)) {
    UiStackBranches = [...UiStackBranches, trunk]
  }
  if (UiStackBranches.length === 0) {
    return null
  }

  const state: BuildState = {
    commitMap,
    commitNodes: new Map(),
    currentBranch: repo.workingTreeStatus.currentBranch,
    currentCommitSha: repo.workingTreeStatus.currentCommitSha,
    trunkShas: new Set(),
    UiStackMembership: new Map()
  }

  let trunkStack: UiStack | null = null
  if (!trunk) {
    return null
  }
  const trunkResult = buildTrunkUiStack(trunk, state)
  if (!trunkResult) {
    return null
  }
  state.trunkShas = trunkResult.trunkSet
  trunkResult.UiStack.commits.forEach((commit) => {
    state.UiStackMembership.set(commit.sha, trunkResult.UiStack)
  })
  trunkStack = trunkResult.UiStack
  trunkStack.commits.forEach((commit) => {
    createSpinoffUiStacks(commit, state)
  })

  const annotationBranches = [...UiStackBranches].sort((a, b) => {
    if (trunk) {
      if (a.ref === trunk.ref && b.ref !== trunk.ref) {
        return -1
      }
      if (b.ref === trunk.ref && a.ref !== trunk.ref) {
        return 1
      }
    }
    if (a.isRemote && !b.isRemote) {
      return 1
    }
    if (!a.isRemote && b.isRemote) {
      return -1
    }
    return a.ref.localeCompare(b.ref)
  })

  annotateBranchHeads(annotationBranches, state, gitForgeState)

  return trunkStack
}

export type FullUiStateOptions = {
  rebaseIntent?: RebaseIntent | null
  rebaseSession?: RebaseState | null
  generateJobId?: () => RebaseJobId
  gitForgeState?: GitForgeState | null
}

export type FullUiState = {
  stack: UiStack | null
  projectedStack: UiStack | null
  workingTree: WorkingTreeStatus
  rebase: RebaseProjection
}

/**
 * @TODO Delete the FullUiState model for simplicity. Use the lower level utilities instead
 * or create a high level replacement that fn(repo, rebaseQueue) -> UiState
 */
export function buildFullUiState(repo: Repo, options: FullUiStateOptions = {}): FullUiState {
  const stack = buildUiStack(repo, options.gitForgeState)
  const rebase = deriveRebaseProjection(repo, options)
  const projectedStack = deriveProjectedStack(repo, rebase, options.gitForgeState)

  return {
    stack,
    projectedStack,
    workingTree: repo.workingTreeStatus,
    rebase
  }
}

function selectBranchesForUiStacks(branches: Branch[]): Branch[] {
  const canonicalRefs = new Set(
    branches.filter((branch) => isCanonicalTrunkBranch(branch)).map((branch) => branch.ref)
  )
  const localOrTrunk = branches.filter(
    (branch) => !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
  )
  return localOrTrunk.length > 0 ? localOrTrunk : branches
}

function findTrunkBranch(branches: Branch[], workingTree: WorkingTreeStatus): Branch | null {
  const normalizedCurrent = workingTree.currentBranch
  return (
    branches.find((branch) => branch.isTrunk && !branch.isRemote) ??
    branches.find((branch) => branch.isTrunk) ??
    branches.find((branch) => isCanonicalTrunkBranch(branch) && !branch.isRemote) ??
    branches.find((branch) => isCanonicalTrunkBranch(branch)) ??
    branches.find((branch) => normalizeBranchRef(branch) === normalizedCurrent) ??
    branches.find((branch) => branch.ref === normalizedCurrent) ??
    branches[0] ??
    null
  )
}

function buildTrunkUiStack(branch: Branch, state: BuildState): TrunkBuildResult | null {
  if (!branch.headSha) {
    return null
  }
  const lineage = collectBranchLineage(branch.headSha, state.commitMap)
  if (lineage.length === 0) {
    return null
  }
  const commits: UiCommit[] = []
  lineage.forEach((sha) => {
    const node = getOrCreateUiCommit(sha, state)
    if (node) {
      commits.push(node)
    }
  })
  if (commits.length === 0) {
    return null
  }
  const stack: UiStack = { commits, isTrunk: true }
  return { UiStack: stack, trunkSet: new Set(lineage) }
}

function collectBranchLineage(headSha: string, commitMap: Map<string, DomainCommit>): string[] {
  const shas: string[] = []
  let currentSha: string | null = headSha
  const visited = new Set<string>()
  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha)
    shas.push(currentSha)
    const commit = commitMap.get(currentSha)
    if (!commit?.parentSha) {
      break
    }
    currentSha = commit.parentSha
  }
  return shas.slice().reverse()
}

function createSpinoffUiStacks(parentCommit: UiCommit, state: BuildState): void {
  const domainCommit = state.commitMap.get(parentCommit.sha)
  if (!domainCommit) {
    return
  }
  const childShas = getOrderedChildren(domainCommit, state, { excludeTrunk: true })
  childShas.forEach((childSha) => {
    if (state.UiStackMembership.has(childSha)) {
      return
    }
    const UiStack = buildNonTrunkUiStack(childSha, state)
    if (UiStack) {
      parentCommit.spinoffs.push(UiStack)
    }
  })
}

function buildNonTrunkUiStack(startSha: string, state: BuildState): UiStack | null {
  const UiStack: UiStack = { commits: [], isTrunk: false }
  let currentSha: string | null = startSha
  const visited = new Set<string>()

  while (currentSha && !visited.has(currentSha)) {
    if (state.UiStackMembership.has(currentSha)) {
      break
    }
    visited.add(currentSha)
    const commitNode = getOrCreateUiCommit(currentSha, state)
    if (!commitNode) {
      break
    }
    UiStack.commits.push(commitNode)
    state.UiStackMembership.set(currentSha, UiStack)

    const domainCommit = state.commitMap.get(currentSha)
    if (!domainCommit) {
      break
    }
    const childShas = getOrderedChildren(domainCommit, state, { excludeTrunk: true })
    if (childShas.length === 0) {
      break
    }
    if (childShas.length === 1) {
      const [nextSha] = childShas
      if (!nextSha) {
        break
      }
      currentSha = nextSha
      continue
    }
    const [continuationSha, ...spinoffShas] = childShas
    if (!continuationSha) {
      break
    }
    spinoffShas.forEach((childSha) => {
      if (state.UiStackMembership.has(childSha)) {
        return
      }
      const spinoffUiStack = buildNonTrunkUiStack(childSha, state)
      if (spinoffUiStack) {
        commitNode.spinoffs.push(spinoffUiStack)
      }
    })
    currentSha = continuationSha
  }

  return UiStack.commits.length > 0 ? UiStack : null
}

function getOrderedChildren(
  commit: DomainCommit,
  state: BuildState,
  options: { excludeTrunk?: boolean } = {}
): string[] {
  const { excludeTrunk = false } = options
  const knownChildren = commit.childrenSha.filter((sha) => state.commitMap.has(sha))
  const filtered = excludeTrunk
    ? knownChildren.filter((sha) => !state.trunkShas.has(sha))
    : knownChildren
  return filtered.sort((a, b) => {
    const timeDiff = (state.commitMap.get(a)?.timeMs ?? 0) - (state.commitMap.get(b)?.timeMs ?? 0)
    if (timeDiff !== 0) {
      return timeDiff
    }
    return a.localeCompare(b)
  })
}

function annotateBranchHeads(
  branches: Branch[],
  state: BuildState,
  gitForgeState: GitForgeState | null
): void {
  branches.forEach((branch) => {
    if (!branch.headSha) {
      return
    }
    const commitNode = state.commitNodes.get(branch.headSha)
    if (!commitNode) {
      return
    }
    const alreadyAnnotated = commitNode.branches.some((existing) => existing.name === branch.ref)
    if (alreadyAnnotated) {
      return
    }

    let pullRequest: UiPullRequest | undefined
    if (gitForgeState) {
      const normalizedRef = normalizeBranchRef(branch)
      const pr = gitForgeState.pullRequests.find((pr) => pr.headRefName === normalizedRef)
      if (pr) {
        pullRequest = {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state,
          isInSync: pr.headSha === branch.headSha
        }
      }
    }

    commitNode.branches.push({
      name: branch.ref,
      isCurrent: branch.ref === state.currentBranch,
      pullRequest
    })
  })
}

function getOrCreateUiCommit(sha: string, state: BuildState): UiCommit | null {
  const existing = state.commitNodes.get(sha)
  if (existing) {
    return existing
  }
  const commit = state.commitMap.get(sha)
  if (!commit) {
    return null
  }

  const uiCommit: UiCommit = {
    sha: commit.sha,
    name: formatCommitName(commit),
    timestampMs: commit.timeMs ?? 0,
    isCurrent: commit.sha === state.currentCommitSha,
    rebaseStatus: null,
    spinoffs: [],
    branches: []
  }
  state.commitNodes.set(sha, uiCommit)

  return uiCommit
}

function formatCommitName(commit: DomainCommit): string {
  const subject = commit.message.split('\n')[0] || '(no message)'
  return subject
}

function normalizeBranchRef(branch: Branch): string {
  if (!branch.isRemote) {
    return branch.ref
  }
  const slashIndex = branch.ref.indexOf('/')
  return slashIndex >= 0 ? branch.ref.slice(slashIndex + 1) : branch.ref
}

function isCanonicalTrunkBranch(branch: Branch): boolean {
  const normalized = normalizeBranchRef(branch)
  return CANONICAL_TRUNK_NAMES.includes(normalized)
}

function deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
  if (options.rebaseSession) {
    return {
      kind: 'rebasing',
      session: options.rebaseSession
    }
  }

  const intent = options.rebaseIntent
  if (!intent || intent.targets.length === 0) {
    return { kind: 'idle' }
  }

  const generateJobId = options.generateJobId ?? createDefaultPreviewJobIdGenerator()
  const plan = createRebasePlan({
    repo,
    intent,
    generateJobId
  })

  return {
    kind: 'planning',
    plan
  }
}

function createDefaultPreviewJobIdGenerator(): () => RebaseJobId {
  let counter = 0
  return () => {
    counter += 1
    return `preview-job-${counter}`
  }
}

function deriveProjectedStack(
  repo: Repo,
  projection: RebaseProjection,
  gitForgeState: GitForgeState | null = null
): UiStack | null {
  if (projection.kind !== 'planning') {
    return null
  }
  const { intent } = projection.plan
  if (intent.targets.length === 0) {
    return null
  }
  const projectedCommits = projectCommitsForIntent(repo.commits, intent)
  const projectedRepo: Repo = {
    ...repo,
    commits: projectedCommits
  }
  return buildUiStack(projectedRepo, gitForgeState)
}

type SyntheticCommit = DomainCommit & { childrenSha: string[] }

function projectCommitsForIntent(commits: DomainCommit[], intent: RebaseIntent): DomainCommit[] {
  const synthetic = new Map<string, SyntheticCommit>()
  commits.forEach((commit) => {
    synthetic.set(commit.sha, {
      ...commit,
      childrenSha: [...commit.childrenSha]
    })
  })

  let timeCounter = 0
  const allocateSyntheticTime = () => intent.createdAtMs + timeCounter++

  intent.targets.forEach((target) => {
    applyIntentTarget(synthetic, target.node, target.targetBaseSha, allocateSyntheticTime)
  })

  return commits.map((commit) => synthetic.get(commit.sha) ?? commit)
}

function applyIntentTarget(
  commits: Map<string, SyntheticCommit>,
  node: StackNodeState,
  targetBaseSha: string,
  allocateSyntheticTime: () => number
): void {
  const commit = commits.get(node.headSha)
  if (!commit) {
    return
  }

  if (commit.parentSha) {
    const previousParent = commits.get(commit.parentSha)
    if (previousParent) {
      previousParent.childrenSha = previousParent.childrenSha.filter((sha) => sha !== commit.sha)
    }
  }

  commit.parentSha = targetBaseSha
  const newParent = commits.get(targetBaseSha)
  if (newParent && !newParent.childrenSha.includes(commit.sha)) {
    newParent.childrenSha = [...newParent.childrenSha, commit.sha]
  }

  const parentTime = newParent?.timeMs ?? 0
  const syntheticTime = Math.max(allocateSyntheticTime(), parentTime + 1, commit.timeMs ?? 0)
  commit.timeMs = syntheticTime

  node.children.forEach((child) =>
    applyIntentTarget(commits, child, commit.sha, allocateSyntheticTime)
  )
}
