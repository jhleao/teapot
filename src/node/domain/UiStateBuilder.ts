/**
 * UiStateBuilder - Pure domain logic for building UI state representations.
 *
 * Transforms repository data (Repo) into UI-friendly structures (UiStack, UiWorkingTreeFile).
 * All functions are pure and synchronous.
 */

import { log } from '@shared/logger'
import type {
  Branch,
  Commit as DomainCommit,
  RebaseIntent,
  RebaseJobId,
  RebaseProjection,
  RebaseSessionPhase,
  RebaseState,
  Repo,
  StackNodeState,
  UiPullRequest,
  UiStack,
  UiWorkingTreeFile,
  UiWorktreeBadge,
  WorkingTreeStatus,
  Worktree
} from '@shared/types'
import type { GitForgeState } from '../../shared/types/git-forge'
import { canRecreatePr, countOpenPrs, findBestPr } from '../../shared/types/git-forge'
import { calculateCommitOwnership, isForkPoint } from './CommitOwnership'
import { PrTargetResolver } from './PrTargetResolver'
import { RebaseStateMachine } from './RebaseStateMachine'
import { TrunkResolver } from './TrunkResolver'

type UiCommit = UiStack['commits'][number]

type BuildState = {
  repo: Repo
  commitMap: Map<string, DomainCommit>
  commitNodes: Map<string, UiCommit>
  currentBranch: string
  currentCommitSha: string
  trunkShas: Set<string>
  UiStackMembership: Map<string, UiStack>
  worktreeByBranch: Map<string, Worktree>
  currentWorktreePath: string
  branchHeadIndex: Map<string, string[]>
  trunkHeadSha: string
}

type TrunkBuildResult = {
  UiStack: UiStack
  trunkSet: Set<string>
}

export type FullUiStateOptions = {
  rebaseIntent?: RebaseIntent | null
  rebaseSession?: RebaseState | null
  /** Phase of the rebase session for explicit UI state tracking */
  rebaseSessionPhase?: RebaseSessionPhase | null
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

export class UiStateBuilder {
  private constructor() {}

  /**
   * Builds a UiStack from repository data.
   */
  public static buildUiStack(
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
    const trunk = UiStateBuilder.findTrunkBranch(repo.branches, repo.workingTreeStatus)
    let UiStackBranches = UiStateBuilder.selectBranchesForUiStacks(repo.branches)
    if (trunk && !UiStackBranches.some((branch) => branch.ref === trunk.ref)) {
      UiStackBranches = [...UiStackBranches, trunk]
    }
    if (UiStackBranches.length === 0) {
      return null
    }

    const worktreeByBranch = new Map<string, Worktree>()
    for (const worktree of repo.worktrees) {
      if (worktree.branch) {
        worktreeByBranch.set(worktree.branch, worktree)
      }
    }

    const currentWorktreePath = repo.activeWorktreePath ?? repo.path

    const branchHeadIndex = new Map<string, string[]>()
    for (const branch of UiStackBranches) {
      if (!branch.headSha || branch.isRemote) continue
      const existing = branchHeadIndex.get(branch.headSha) ?? []
      existing.push(branch.ref)
      branchHeadIndex.set(branch.headSha, existing)
    }

    if (!trunk) {
      return null
    }

    const state: BuildState = {
      repo,
      commitMap,
      commitNodes: new Map(),
      currentBranch: repo.workingTreeStatus.currentBranch,
      currentCommitSha: repo.workingTreeStatus.currentCommitSha,
      trunkShas: new Set(),
      UiStackMembership: new Map(),
      worktreeByBranch,
      currentWorktreePath,
      branchHeadIndex,
      trunkHeadSha: trunk.headSha ?? ''
    }

    const remoteTrunk = repo.branches.find((b) => b.isTrunk && b.isRemote)

    const trunkResult = UiStateBuilder.buildTrunkUiStack(trunk, state, remoteTrunk)
    if (!trunkResult) {
      return null
    }
    state.trunkShas = trunkResult.trunkSet
    trunkResult.UiStack.commits.forEach((commit) => {
      state.UiStackMembership.set(commit.sha, trunkResult.UiStack)
    })
    const trunkStack = trunkResult.UiStack
    trunkStack.commits.forEach((commit) => {
      UiStateBuilder.createSpinoffUiStacks(commit, state)
    })

    const allBranchesForAnnotation = [...repo.branches]
    const annotationBranches = allBranchesForAnnotation.sort((a, b) => {
      if (a.ref === trunk.ref && b.ref !== trunk.ref) return -1
      if (b.ref === trunk.ref && a.ref !== trunk.ref) return 1
      if (a.isRemote && !b.isRemote) return 1
      if (!a.isRemote && b.isRemote) return -1
      return a.ref.localeCompare(b.ref)
    })

    UiStateBuilder.annotateBranchHeads(annotationBranches, state, gitForgeState)

    if (declutterTrunk) {
      UiStateBuilder.trimTrunkCommits(trunkStack)
    }

    return trunkStack
  }

  /**
   * Builds the full UI state including stack, projected stack, and rebase projection.
   */
  public static buildFullUiState(repo: Repo, options: FullUiStateOptions = {}): FullUiState {
    const { declutterTrunk } = options
    const stack = UiStateBuilder.buildUiStack(repo, options.gitForgeState, { declutterTrunk })
    const rebase = UiStateBuilder.deriveRebaseProjection(repo, options)
    const projectedStack = UiStateBuilder.deriveProjectedStack(
      repo,
      rebase,
      options.gitForgeState,
      declutterTrunk
    )

    return {
      stack,
      projectedStack,
      workingTree: repo.workingTreeStatus,
      rebase
    }
  }

  /**
   * Builds UI working tree file list from repository data.
   */
  public static buildUiWorkingTree(repo: Repo): UiWorkingTreeFile[] {
    const { workingTreeStatus } = repo
    const fileMap = new Map<
      string,
      { stageStatus: UiWorkingTreeFile['stageStatus']; status: UiWorkingTreeFile['status'] }
    >()

    for (const path of workingTreeStatus.staged) {
      fileMap.set(path, { stageStatus: 'staged', status: 'modified' })
    }

    for (const path of workingTreeStatus.deleted) {
      const existing = fileMap.get(path)
      fileMap.set(path, {
        stageStatus: existing?.stageStatus ?? 'unstaged',
        status: 'deleted'
      })
    }

    for (const path of workingTreeStatus.renamed) {
      const existing = fileMap.get(path)
      if (!existing) {
        fileMap.set(path, { stageStatus: 'unstaged', status: 'renamed' })
      } else {
        fileMap.set(path, { stageStatus: existing.stageStatus, status: 'renamed' })
      }
    }

    for (const path of workingTreeStatus.modified) {
      const existing = fileMap.get(path)
      if (!existing) {
        fileMap.set(path, { stageStatus: 'unstaged', status: 'modified' })
      } else if (existing.stageStatus === 'staged') {
        fileMap.set(path, { ...existing, stageStatus: 'partially-staged' })
      }
    }

    for (const path of workingTreeStatus.created) {
      const existing = fileMap.get(path)
      if (existing) {
        fileMap.set(path, { stageStatus: existing.stageStatus, status: 'added' })
      } else {
        fileMap.set(path, { stageStatus: 'unstaged', status: 'added' })
      }
    }

    for (const path of workingTreeStatus.not_added) {
      const existing = fileMap.get(path)
      if (!existing) {
        fileMap.set(path, { stageStatus: 'unstaged', status: 'added' })
      }
    }

    for (const path of workingTreeStatus.conflicted) {
      fileMap.set(path, { stageStatus: 'unstaged', status: 'conflicted' })
    }

    return Array.from(fileMap.entries())
      .map(([path, { stageStatus, status }]) => ({
        path,
        stageStatus,
        status
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  /**
   * Recursively finds commits belonging to a branch and marks them with the given rebase status.
   * Used to show which commits are currently being rebased and their conflict state.
   */
  public static applyRebaseStatusToCommits(
    stack: UiStack,
    branchName: string,
    status: 'conflicted' | 'resolved' | 'queued'
  ): void {
    for (const commit of stack.commits) {
      if (commit.branches.some((b) => b.name === branchName)) {
        commit.rebaseStatus = status
      }

      for (const spinoff of commit.spinoffs) {
        UiStateBuilder.applyRebaseStatusToCommits(spinoff, branchName, status)
      }
    }
  }

  private static selectBranchesForUiStacks(branches: Branch[]): Branch[] {
    const canonicalRefs = new Set(
      branches
        .filter((branch) => TrunkResolver.isCanonicalTrunk(branch))
        .map((branch) => branch.ref)
    )
    const localOrTrunk = branches.filter((branch) => {
      if (branch.isRemote && branch.isTrunk) return false
      return !branch.isRemote || branch.isTrunk || canonicalRefs.has(branch.ref)
    })
    return localOrTrunk.length > 0 ? localOrTrunk : branches
  }

  private static findTrunkBranch(
    branches: Branch[],
    workingTree: WorkingTreeStatus
  ): Branch | null {
    const normalizedCurrent = workingTree.currentBranch
    return (
      branches.find((branch) => branch.isTrunk && !branch.isRemote) ??
      branches.find((branch) => branch.isTrunk) ??
      branches.find((branch) => TrunkResolver.isCanonicalTrunk(branch) && !branch.isRemote) ??
      branches.find((branch) => TrunkResolver.isCanonicalTrunk(branch)) ??
      branches.find((branch) => UiStateBuilder.normalizeBranchRef(branch) === normalizedCurrent) ??
      branches.find((branch) => branch.ref === normalizedCurrent) ??
      branches[0] ??
      null
    )
  }

  private static buildTrunkUiStack(
    branch: Branch,
    state: BuildState,
    remoteTrunk?: Branch
  ): TrunkBuildResult | null {
    if (!branch.headSha) {
      return null
    }

    const localLineage = UiStateBuilder.collectBranchLineage(branch.headSha, state.commitMap)

    let lineage = localLineage
    if (remoteTrunk?.headSha && remoteTrunk.headSha !== branch.headSha) {
      const remoteLineage = UiStateBuilder.collectBranchLineage(
        remoteTrunk.headSha,
        state.commitMap
      )
      const localSet = new Set(localLineage)
      const remoteSet = new Set(remoteLineage)

      const remoteIsAhead = remoteSet.has(branch.headSha)
      const localIsAhead = localSet.has(remoteTrunk.headSha)

      if (remoteIsAhead && !localIsAhead) {
        lineage = remoteLineage
      } else if (localIsAhead && !remoteIsAhead) {
        lineage = localLineage
      } else {
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
      const node = UiStateBuilder.getOrCreateUiCommit(sha, state)
      if (node) {
        commits.push(node)
      }
    })

    if (commits.length === 0) {
      return null
    }

    const stack: UiStack = {
      commits,
      isTrunk: true,
      canRebaseToTrunk: false,
      isDirectlyOffTrunk: true
    }
    return { UiStack: stack, trunkSet: new Set(lineage) }
  }

  private static collectBranchLineage(
    headSha: string,
    commitMap: Map<string, DomainCommit>
  ): string[] {
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

  private static createSpinoffUiStacks(parentCommit: UiCommit, state: BuildState): void {
    const domainCommit = state.commitMap.get(parentCommit.sha)
    if (!domainCommit) {
      return
    }
    const childShas = UiStateBuilder.getOrderedChildren(domainCommit, state, { excludeTrunk: true })
    childShas.forEach((childSha) => {
      if (state.UiStackMembership.has(childSha)) {
        return
      }
      const stack = UiStateBuilder.buildNonTrunkUiStack(childSha, state, parentCommit.sha)
      if (stack) {
        parentCommit.spinoffs.push(stack)
      }
    })
  }

  /**
   * Builds a non-trunk UiStack starting from the given commit SHA.
   * @param startSha - The SHA of the first commit in this stack
   * @param state - Build state containing commit map and other context
   * @param baseSha - The SHA of the commit this stack branches from (used for canRebaseToTrunk).
   *                  For stacks directly off trunk, this is a trunk commit SHA.
   *                  For nested stacks, this is a non-trunk commit SHA (so canRebaseToTrunk will be false).
   */
  private static buildNonTrunkUiStack(
    startSha: string,
    state: BuildState,
    baseSha: string
  ): UiStack | null {
    const isDirectlyOffTrunk = state.trunkShas.has(baseSha)
    const canRebaseToTrunk =
      isDirectlyOffTrunk && baseSha !== state.trunkHeadSha && state.trunkHeadSha !== ''

    const stack: UiStack = { commits: [], isTrunk: false, canRebaseToTrunk, isDirectlyOffTrunk }
    let currentSha: string | null = startSha
    const visited = new Set<string>()

    while (currentSha && !visited.has(currentSha)) {
      if (state.UiStackMembership.has(currentSha)) {
        break
      }
      visited.add(currentSha)
      const commitNode = UiStateBuilder.getOrCreateUiCommit(currentSha, state)
      if (!commitNode) {
        break
      }
      stack.commits.push(commitNode)
      state.UiStackMembership.set(currentSha, stack)

      const domainCommit = state.commitMap.get(currentSha)
      if (!domainCommit) {
        break
      }
      const childShas = UiStateBuilder.getOrderedChildren(domainCommit, state, {
        excludeTrunk: true
      })
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
        const spinoffUiStack = UiStateBuilder.buildNonTrunkUiStack(childSha, state, currentSha!)
        if (spinoffUiStack) {
          commitNode.spinoffs.push(spinoffUiStack)
        }
      })
      currentSha = continuationSha
    }

    return stack.commits.length > 0 ? stack : null
  }

  private static getOrderedChildren(
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

  /**
   * Collects the SHAs of commits "owned" by a branch.
   * Delegates to the shared CommitOwnership utility for consistent behavior
   * with RebaseIntentBuilder.
   *
   * IMPORTANT: The branchHeadIndex used here excludes remote branches (see buildUiStack).
   * RebaseIntentBuilder must also exclude remote branches when building its branchHeadIndex
   * to ensure the same ownership calculation. This is critical for the rebase preview
   * to correctly show branchless ancestor commits moving with their branch.
   */
  private static collectOwnedCommitShas(
    branchHeadSha: string,
    branchRef: string,
    state: BuildState
  ): string[] {
    const result = calculateCommitOwnership({
      headSha: branchHeadSha,
      branchRef,
      commitMap: state.commitMap,
      branchHeadIndex: state.branchHeadIndex,
      trunkShas: state.trunkShas
    })

    return result.ownedShas
  }

  private static annotateBranchHeads(
    branches: Branch[],
    state: BuildState,
    gitForgeState: GitForgeState | null
  ): void {
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
      let branchCanRecreatePr: boolean | undefined

      if (gitForgeState) {
        const normalizedRef = UiStateBuilder.normalizeBranchRef(branch)
        const matchingPrs = gitForgeState.pullRequests.filter(
          (p) => p.headRefName === normalizedRef
        )
        const pr = findBestPr(normalizedRef, gitForgeState.pullRequests)
        const hasMultipleOpenPrs = countOpenPrs(normalizedRef, gitForgeState.pullRequests) > 1
        branchCanRecreatePr = canRecreatePr(normalizedRef, gitForgeState.pullRequests) || undefined

        if (matchingPrs.length > 1) {
          log.info('[UiStateBuilder] Multiple PRs found for branch', {
            branch: normalizedRef,
            prs: matchingPrs.map((p) => ({
              number: p.number,
              state: p.state,
              createdAt: p.createdAt
            })),
            selected: pr ? { number: pr.number, state: pr.state } : null
          })
        }

        if (pr && pr.state !== 'open') {
          log.debug('[UiStateBuilder] Selected non-open PR for branch', {
            branch: normalizedRef,
            prNumber: pr.number,
            prState: pr.state,
            totalPrs: matchingPrs.length
          })
        }

        if (pr) {
          pullRequest = {
            number: pr.number,
            title: pr.title,
            url: pr.url,
            state: pr.state,
            isInSync: pr.headSha === branch.headSha,
            isMergeable: pr.isMergeable,
            hasMultipleOpenPrs: hasMultipleOpenPrs || undefined
          }
          if (pr.state === 'merged') {
            isMerged = true
          } else if (pr.state === 'closed') {
            isMerged = mergedBranchNames.has(branch.ref)
          } else {
            isMerged = false
          }
          hasStaleTarget = mergedBranchNames.has(pr.baseRefName)
        } else {
          isMerged = mergedBranchNames.has(branch.ref)
        }
      }

      let worktree: UiWorktreeBadge | undefined
      const worktreeInfo = state.worktreeByBranch.get(branch.ref)
      if (worktreeInfo) {
        let status: UiWorktreeBadge['status']
        if (worktreeInfo.isStale) {
          status = 'stale'
        } else if (worktreeInfo.path === state.currentWorktreePath) {
          status = 'active'
        } else if (worktreeInfo.isDirty) {
          status = 'dirty'
        } else {
          status = 'clean'
        }

        if (status !== 'active') {
          worktree = {
            path: worktreeInfo.path,
            status,
            isMain: worktreeInfo.isMain
          }
        }
      }

      let ownedCommitShas: string[] | undefined
      if (!branch.isRemote && !branch.isTrunk) {
        ownedCommitShas = UiStateBuilder.collectOwnedCommitShas(branch.headSha, branch.ref, state)
      }

      let expectedPrBase: string | undefined
      if (!branch.isRemote && !branch.isTrunk) {
        try {
          expectedPrBase = PrTargetResolver.findBaseBranch(
            state.repo,
            branch.headSha,
            mergedBranchNames
          )
        } catch {
          log.warn('[UiStateBuilder] Failed to find base branch for PR', {
            branch: branch.ref,
            headSha: branch.headSha
          })
        }
      }

      const isCurrent = branch.ref === state.currentBranch
      const canRename = !branch.isRemote && !branch.isTrunk
      const canDelete = !isCurrent && !branch.isTrunk

      const branchCommit = state.commitMap.get(branch.headSha)
      const parentSha = branchCommit?.parentSha
      const parentIsOnTrunk = parentSha ? state.trunkShas.has(parentSha) : true
      const canSquash = !branch.isRemote && !branch.isTrunk && !parentIsOnTrunk

      let squashDisabledReason: string | undefined
      if (!canSquash) {
        if (branch.isRemote) {
          squashDisabledReason = 'Cannot squash remote branches'
        } else if (branch.isTrunk) {
          squashDisabledReason = 'Cannot squash trunk branches'
        } else if (parentIsOnTrunk) {
          squashDisabledReason = 'Cannot squash: parent commit is on trunk'
        }
      }

      const canCreateWorktree = !branch.isRemote && !branch.isTrunk

      commitNode.branches.push({
        name: branch.ref,
        isCurrent,
        isRemote: branch.isRemote,
        isTrunk: branch.isTrunk,
        pullRequest,
        isMerged,
        hasStaleTarget: hasStaleTarget || undefined,
        worktree,
        ownedCommitShas,
        expectedPrBase,
        canRename,
        canDelete,
        canSquash,
        squashDisabledReason,
        canCreateWorktree,
        canRecreatePr: branchCanRecreatePr
      })
    })
  }

  private static getOrCreateUiCommit(sha: string, state: BuildState): UiCommit | null {
    const existing = state.commitNodes.get(sha)
    if (existing) {
      return existing
    }
    const commit = state.commitMap.get(sha)
    if (!commit) {
      return null
    }

    const isIndependent = isForkPoint(commit, state.trunkShas)

    const uiCommit: UiCommit = {
      sha: commit.sha,
      name: UiStateBuilder.formatCommitName(commit),
      timestampMs: commit.timeMs ?? 0,
      isCurrent: commit.sha === state.currentCommitSha,
      rebaseStatus: null,
      spinoffs: [],
      branches: [],
      isIndependent: isIndependent || undefined
    }
    state.commitNodes.set(sha, uiCommit)

    return uiCommit
  }

  private static formatCommitName(commit: DomainCommit): string {
    const subject = commit.message.split('\n')[0] || '(no message)'
    return subject
  }

  private static normalizeBranchRef(branch: Branch): string {
    if (!branch.isRemote) {
      return branch.ref
    }
    const slashIndex = branch.ref.indexOf('/')
    return slashIndex >= 0 ? branch.ref.slice(slashIndex + 1) : branch.ref
  }

  private static trimTrunkCommits(trunkStack: UiStack): void {
    if (!trunkStack.isTrunk || trunkStack.commits.length === 0) {
      return
    }

    const lastIndex = trunkStack.commits.length - 1
    trunkStack.commits = trunkStack.commits.filter((commit, index) => {
      if (index === lastIndex) return true
      return commit.spinoffs.length > 0 || commit.branches.length > 0
    })
  }

  private static deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
    // No session - check for intent-only preview
    if (!options.rebaseSession) {
      const intent = options.rebaseIntent
      if (!intent || intent.targets.length === 0) {
        return { kind: 'idle' }
      }

      const generateJobId =
        options.generateJobId ?? UiStateBuilder.createDefaultPreviewJobIdGenerator()
      const plan = RebaseStateMachine.createRebasePlan({
        repo,
        intent,
        generateJobId
      })

      return {
        kind: 'planning',
        plan
      }
    }

    // Use phase if provided, otherwise fall back to signal inference for migration
    const phase =
      options.rebaseSessionPhase ?? UiStateBuilder.inferPhaseFromSession(options.rebaseSession)

    switch (phase) {
      case 'planning': {
        // Still in planning phase - show the rebase plan preview
        const intent = options.rebaseIntent
        if (!intent || intent.targets.length === 0) {
          // No intent but in planning phase - return rebasing state to avoid stuck UI
          return {
            kind: 'rebasing',
            session: options.rebaseSession
          }
        }
        const generateJobId =
          options.generateJobId ?? UiStateBuilder.createDefaultPreviewJobIdGenerator()
        const plan = RebaseStateMachine.createRebasePlan({
          repo,
          intent,
          generateJobId
        })
        return {
          kind: 'planning',
          plan
        }
      }
      case 'executing':
      case 'conflicted':
        // Active rebase - show rebasing state
        return {
          kind: 'rebasing',
          session: options.rebaseSession
        }
      case 'completed':
        // Rebase is done - return idle
        return { kind: 'idle' }
    }
  }

  /**
   * Infers the phase from session state for backward compatibility.
   * Used when the session doesn't have an explicit phase field.
   */
  private static inferPhaseFromSession(session: RebaseState): RebaseSessionPhase {
    if (session.session.status === 'awaiting-user') return 'conflicted'
    if (session.session.status === 'completed') return 'completed'
    if (session.session.status === 'aborted') return 'completed'
    if (session.queue.activeJobId) return 'executing'
    return 'planning'
  }

  private static createDefaultPreviewJobIdGenerator(): () => RebaseJobId {
    let counter = 0
    return () => {
      counter += 1
      return `preview-job-${counter}`
    }
  }

  private static deriveProjectedStack(
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
    const projectedCommits = UiStateBuilder.projectCommitsForIntent(repo.commits, intent)
    const projectedRepo: Repo = {
      ...repo,
      commits: projectedCommits
    }
    const stack = UiStateBuilder.buildUiStack(projectedRepo, gitForgeState, { declutterTrunk })

    if (stack) {
      UiStateBuilder.applyRebaseStatusToStack(stack, intent)
    }

    return stack
  }

  private static applyRebaseStatusToStack(stack: UiStack, intent: RebaseIntent): void {
    const promptingShas = new Set<string>()
    const idleShas = new Set<string>()

    for (const target of intent.targets) {
      target.node.ownedShas.forEach((sha) => promptingShas.add(sha))
      UiStateBuilder.collectChildShas(target.node.children, idleShas)
    }

    UiStateBuilder.applyStatusToStackRecursive(stack, promptingShas, idleShas)
  }

  private static collectChildShas(children: StackNodeState[], result: Set<string>): void {
    for (const child of children) {
      child.ownedShas.forEach((sha) => result.add(sha))
      UiStateBuilder.collectChildShas(child.children, result)
    }
  }

  private static applyStatusToStackRecursive(
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

      for (const spinoff of commit.spinoffs) {
        UiStateBuilder.applyStatusToStackRecursive(spinoff, promptingShas, idleShas)
      }
    }
  }

  private static projectCommitsForIntent(
    commits: DomainCommit[],
    intent: RebaseIntent
  ): DomainCommit[] {
    type SyntheticCommit = DomainCommit & { childrenSha: string[] }
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
      UiStateBuilder.applyIntentTarget(
        synthetic,
        target.node,
        target.targetBaseSha,
        allocateSyntheticTime
      )
    })

    return commits.map((commit) => synthetic.get(commit.sha) ?? commit)
  }

  private static applyIntentTarget(
    commits: Map<string, DomainCommit & { childrenSha: string[] }>,
    node: StackNodeState,
    targetBaseSha: string,
    allocateSyntheticTime: () => number
  ): void {
    let oldestOwnedSha = node.headSha
    let currentSha: string | null = node.headSha
    while (currentSha) {
      const c = commits.get(currentSha)
      if (!c) break
      if (c.parentSha === node.baseSha) {
        oldestOwnedSha = currentSha
        break
      }
      currentSha = c.parentSha ?? null
    }

    const oldestCommit = commits.get(oldestOwnedSha)
    if (!oldestCommit) {
      return
    }

    if (oldestCommit.parentSha) {
      const previousParent = commits.get(oldestCommit.parentSha)
      if (previousParent) {
        previousParent.childrenSha = previousParent.childrenSha.filter(
          (sha) => sha !== oldestOwnedSha
        )
      }
    }

    oldestCommit.parentSha = targetBaseSha
    const newParent = commits.get(targetBaseSha)
    if (newParent && !newParent.childrenSha.includes(oldestOwnedSha)) {
      newParent.childrenSha = [...newParent.childrenSha, oldestOwnedSha]
    }

    const parentTime = newParent?.timeMs ?? 0
    let chainSha: string | null = oldestOwnedSha
    let lastTime = parentTime
    while (chainSha) {
      const chainCommit = commits.get(chainSha)
      if (!chainCommit) break
      const syntheticTime = Math.max(allocateSyntheticTime(), lastTime + 1, chainCommit.timeMs ?? 0)
      chainCommit.timeMs = syntheticTime
      lastTime = syntheticTime
      if (chainSha === node.headSha) break
      const nextSha = chainCommit.childrenSha.find((childSha) => {
        let sha: string | null = node.headSha
        while (sha) {
          if (sha === childSha) return true
          const cc = commits.get(sha)
          if (!cc) break
          sha = cc.parentSha ?? null
        }
        return false
      })
      chainSha = nextSha ?? null
    }

    const headCommit = commits.get(node.headSha)
    node.children.forEach((child) =>
      UiStateBuilder.applyIntentTarget(
        commits,
        child,
        headCommit?.sha ?? node.headSha,
        allocateSyntheticTime
      )
    )
  }
}
