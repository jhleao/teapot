import type {
  Branch,
  Commit as DomainCommit,
  RebaseIntent,
  RebaseJobId,
  RebaseProjection,
  RebaseState,
  Repo,
  StackNodeState,
  UiPullRequest,
  UiStack,
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

export function buildUiStack(
  repo: Repo,
  gitForgeState: GitForgeState | null = null,
  options: { declutterTrunk?: boolean } = {}
): UiStack | null {
  const { declutterTrunk = true } = options

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

  // Find remote trunk to extend lineage if it's ahead
  const remoteTrunk = repo.branches.find((b) => b.isTrunk && b.isRemote)

  // Build trunk stack from local trunk, extending to include remote trunk commits if ahead
  const trunkResult = buildTrunkUiStack(trunk, state, remoteTrunk)
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

  // For annotations, include ALL branches (including remote trunk)
  // Remote trunk should not build a stack, but should still annotate commits
  const allBranchesForAnnotation = [...repo.branches]
  const annotationBranches = allBranchesForAnnotation.sort((a, b) => {
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

  // Trim trunk commits that have no useful information (no spinoffs, no branches)
  // This removes "dead" history below the deepest point of interest
  // Can be disabled via declutterTrunk option
  if (trunkStack && declutterTrunk) {
    trimTrunkCommits(trunkStack)
  }

  return trunkStack
}

export type FullUiStateOptions = {
  rebaseIntent?: RebaseIntent | null
  rebaseSession?: RebaseState | null
  generateJobId?: () => RebaseJobId
  gitForgeState?: GitForgeState | null
  declutterTrunk?: boolean
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
  const { declutterTrunk } = options
  const stack = buildUiStack(repo, options.gitForgeState, { declutterTrunk })
  const rebase = deriveRebaseProjection(repo, options)
  const projectedStack = deriveProjectedStack(repo, rebase, options.gitForgeState, declutterTrunk)

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
  const localOrTrunk = branches.filter((branch) => {
    // Exclude remote trunk branches - they should only be used for annotations, not stack building
    if (branch.isRemote && branch.isTrunk) {
      return false
    }
    // Include local branches, local trunk, and canonical trunk branches
    return !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
  })
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

function buildTrunkUiStack(
  branch: Branch,
  state: BuildState,
  remoteTrunk?: Branch
): TrunkBuildResult | null {
  if (!branch.headSha) {
    return null
  }

  // Collect lineage from local trunk
  const localLineage = collectBranchLineage(branch.headSha, state.commitMap)

  // If remote trunk exists and differs from local, determine which lineage to use
  let lineage = localLineage
  if (remoteTrunk?.headSha && remoteTrunk.headSha !== branch.headSha) {
    const remoteLineage = collectBranchLineage(remoteTrunk.headSha, state.commitMap)
    const localSet = new Set(localLineage)
    const remoteSet = new Set(remoteLineage)

    // Check if remote is ahead of local (remote contains local head as ancestor)
    const remoteIsAhead = remoteSet.has(branch.headSha)
    // Check if local is ahead of remote (local contains remote head as ancestor)
    const localIsAhead = localSet.has(remoteTrunk.headSha)

    if (remoteIsAhead && !localIsAhead) {
      // Remote is strictly ahead - use remote lineage only
      // This happens after Ship it: origin/main moved forward, local main is behind
      // Don't show orphaned commits that only exist on local path
      lineage = remoteLineage
    } else if (localIsAhead && !remoteIsAhead) {
      // Local is strictly ahead - use local lineage only
      // This happens when user has unpushed commits on main
      lineage = localLineage
    } else {
      // Diverged or same - merge both lineages (original behavior)
      const allShas = new Set([...localLineage, ...remoteLineage])
      lineage = Array.from(allShas).sort((a, b) => {
        const commitA = state.commitMap.get(a)
        const commitB = state.commitMap.get(b)
        if (!commitA || !commitB) return 0
        return (commitA.timeMs ?? 0) - (commitB.timeMs ?? 0)
      })
    }
  }

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
  // Pre-compute set of merged branch names for efficient lookup
  const mergedBranchNames = new Set(gitForgeState?.mergedBranchNames ?? [])

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
    let isMerged: boolean | undefined
    let hasStaleTarget = false

    if (gitForgeState) {
      const normalizedRef = normalizeBranchRef(branch)
      const pr = gitForgeState.pullRequests.find((pr) => pr.headRefName === normalizedRef)
      if (pr) {
        pullRequest = {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state,
          isInSync: pr.headSha === branch.headSha,
          isMergeable: pr.isMergeable
        }
        // PR 'merged' state is authoritative
        // For 'closed' PRs, also check local detection since commits may have been
        // merged via rebase/squash (PR closed but commits are on trunk)
        if (pr.state === 'merged') {
          isMerged = true
        } else if (pr.state === 'closed') {
          // Closed PR - check if commits are actually on trunk
          isMerged = mergedBranchNames.has(branch.ref)
        } else {
          isMerged = false
        }
        // Check if PR targets a merged branch (stale target)
        // Ship It should be blocked when targeting a merged branch
        hasStaleTarget = mergedBranchNames.has(pr.baseRefName)
      } else {
        // No PR found - check local detection fallback
        isMerged = mergedBranchNames.has(branch.ref)
      }
    }

    commitNode.branches.push({
      name: branch.ref,
      isCurrent: branch.ref === state.currentBranch,
      isRemote: branch.isRemote,
      isTrunk: branch.isTrunk,
      pullRequest,
      isMerged,
      hasStaleTarget: hasStaleTarget || undefined
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

/**
 * Trims trunk commits from the bottom (oldest) up to the deepest point where
 * there's meaningful information (spinoffs or branch annotations).
 * This prevents showing "dead" history that has no branches or features.
 */
function trimTrunkCommits(trunkStack: UiStack): void {
  if (!trunkStack.isTrunk || trunkStack.commits.length === 0) {
    return
  }

  // Find the index of the deepest (oldest, earliest in array) commit that has useful info
  let deepestUsefulIndex = trunkStack.commits.length - 1 // Default to tip (most recent)

  // Walk from oldest to newest to find the oldest commit with spinoffs or branches
  for (let i = 0; i < trunkStack.commits.length; i++) {
    const commit = trunkStack.commits[i]
    if (!commit) continue

    const hasSpinoffs = commit.spinoffs.length > 0
    const hasBranches = commit.branches.length > 0

    if (hasSpinoffs || hasBranches) {
      // Found the oldest commit with useful info, keep everything from here to the tip
      deepestUsefulIndex = i
      break
    }
  }

  // Trim commits below (before) the deepest useful point
  // Keep commits from deepestUsefulIndex to end (tip)
  trunkStack.commits = trunkStack.commits.slice(deepestUsefulIndex)
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
  gitForgeState: GitForgeState | null = null,
  declutterTrunk?: boolean
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
  const stack = buildUiStack(projectedRepo, gitForgeState, { declutterTrunk })

  if (stack) {
    // Apply rebase status to commits in the projected stack
    applyRebaseStatusToStack(stack, intent)
  }

  return stack
}

/**
 * Applies rebaseStatus to commits in the stack based on the rebase intent.
 *
 * - The head commit of each target gets 'prompting' status
 * - All descendant commits of 'prompting' commits get 'idle' status
 */
function applyRebaseStatusToStack(stack: UiStack, intent: RebaseIntent): void {
  // Build a set of "prompting" commit SHAs (the head of each target)
  const promptingShas = new Set<string>()
  // Build a set of all commits that are children of prompting commits
  const idleShas = new Set<string>()

  for (const target of intent.targets) {
    promptingShas.add(target.node.headSha)
    // Collect all children recursively
    collectChildShas(target.node.children, idleShas)
  }

  // Walk the stack and apply statuses
  applyStatusToStackRecursive(stack, promptingShas, idleShas)
}

/**
 * Recursively collects all child commit SHAs from StackNodeState children.
 */
function collectChildShas(children: StackNodeState[], result: Set<string>): void {
  for (const child of children) {
    result.add(child.headSha)
    collectChildShas(child.children, result)
  }
}

/**
 * Recursively walks the UiStack and applies rebaseStatus to commits.
 */
function applyStatusToStackRecursive(
  stack: UiStack,
  promptingShas: Set<string>,
  idleShas: Set<string>
): void {
  for (const commit of stack.commits) {
    if (promptingShas.has(commit.sha)) {
      commit.rebaseStatus = 'prompting'
    } else if (idleShas.has(commit.sha)) {
      commit.rebaseStatus = 'idle'
    }

    // Recurse into spinoffs
    for (const spinoff of commit.spinoffs) {
      applyStatusToStackRecursive(spinoff, promptingShas, idleShas)
    }
  }
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
