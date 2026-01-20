/**
 * UiStateBuilder - Pure domain logic for building UI state representations.
 *
 * Transforms repository data (Repo) into UI-friendly structures (UiStack, UiWorkingTreeFile).
 * All functions are pure and synchronous.
 */

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
  UiWorkingTreeFile,
  UiWorktreeBadge,
  WorkingTreeStatus,
  Worktree
} from '@shared/types'
import type { GitForgeState } from '../../shared/types/git-forge'
import { calculateCommitOwnership } from './CommitOwnership'
import { RebaseStateMachine } from './RebaseStateMachine'
import { TrunkResolver } from './TrunkResolver'

type UiCommit = UiStack['commits'][number]

type BuildState = {
  commitMap: Map<string, DomainCommit>
  commitNodes: Map<string, UiCommit>
  currentBranch: string
  currentCommitSha: string
  trunkShas: Set<string>
  UiStackMembership: Map<string, UiStack>
  /** Map from branch name to worktree info (for branches checked out in worktrees) */
  worktreeByBranch: Map<string, Worktree>
  /** The path of the current/active worktree */
  currentWorktreePath: string
  /** Map from commit SHA to branch names at that SHA (for determining commit ownership boundaries) */
  branchHeadIndex: Map<string, string[]>
  /** The SHA of the current trunk head commit (used for computing canRebaseToTrunk) */
  trunkHeadSha: string
}

type TrunkBuildResult = {
  UiStack: UiStack
  trunkSet: Set<string>
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

export class UiStateBuilder {
  // Prevent instantiation - use static methods
  private constructor() {}

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

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

    // Build worktree lookup: branch name -> worktree
    const worktreeByBranch = new Map<string, Worktree>()
    for (const worktree of repo.worktrees) {
      if (worktree.branch) {
        worktreeByBranch.set(worktree.branch, worktree)
      }
    }

    // Determine the current worktree path for badge status comparison
    const currentWorktreePath = repo.activeWorktreePath ?? repo.path

    // Build index mapping commit SHA to branch names for commit ownership calculation
    // Only include local branches (remote branches don't affect local ownership)
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

    // Find remote trunk to extend lineage if it's ahead
    const remoteTrunk = repo.branches.find((b) => b.isTrunk && b.isRemote)

    // Build trunk stack from local trunk, extending to include remote trunk commits if ahead
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

    // For annotations, include ALL branches (including remote trunk)
    const allBranchesForAnnotation = [...repo.branches]
    const annotationBranches = allBranchesForAnnotation.sort((a, b) => {
      if (a.ref === trunk.ref && b.ref !== trunk.ref) return -1
      if (b.ref === trunk.ref && a.ref !== trunk.ref) return 1
      if (a.isRemote && !b.isRemote) return 1
      if (!a.isRemote && b.isRemote) return -1
      return a.ref.localeCompare(b.ref)
    })

    UiStateBuilder.annotateBranchHeads(annotationBranches, state, gitForgeState)

    // Trim trunk commits that have no useful information
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

    // Handle conflicted files - these take priority over other statuses
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
      // Check if this commit belongs to the branch being rebased
      if (commit.branches.some((b) => b.name === branchName)) {
        commit.rebaseStatus = status
      }

      // Recurse into spinoffs
      for (const spinoff of commit.spinoffs) {
        UiStateBuilder.applyRebaseStatusToCommits(spinoff, branchName, status)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Branch selection
  // ─────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Trunk stack building
  // ─────────────────────────────────────────────────────────────────────────

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

    // Trunk stack itself cannot be rebased to trunk
    const stack: UiStack = { commits, isTrunk: true, canRebaseToTrunk: false }
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

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Spinoff stack building
  // ─────────────────────────────────────────────────────────────────────────

  private static createSpinoffUiStacks(parentCommit: UiCommit, state: BuildState): void {
    const domainCommit = state.commitMap.get(parentCommit.sha)
    if (!domainCommit) {
      return
    }
    // These spinoffs are directly off trunk (called from trunk commit iteration)
    // parentCommit.sha is the trunk commit SHA that these spinoffs branch from
    const childShas = UiStateBuilder.getOrderedChildren(domainCommit, state, { excludeTrunk: true })
    childShas.forEach((childSha) => {
      if (state.UiStackMembership.has(childSha)) {
        return
      }
      // Pass the parent (trunk) commit SHA as baseSha for canRebaseToTrunk computation
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
    // Compute canRebaseToTrunk: true only if directly off trunk AND base is behind trunk head
    // If baseSha is a trunk commit and it's not the current trunk head, we can rebase
    const isDirectlyOffTrunk = state.trunkShas.has(baseSha)
    const canRebaseToTrunk =
      isDirectlyOffTrunk && baseSha !== state.trunkHeadSha && state.trunkHeadSha !== ''

    const stack: UiStack = { commits: [], isTrunk: false, canRebaseToTrunk }
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
      // Nested spinoffs branch from this non-trunk commit, so pass currentSha as their baseSha
      // This ensures canRebaseToTrunk will be false for nested spinoffs
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

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Branch annotation
  // ─────────────────────────────────────────────────────────────────────────

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

      if (gitForgeState) {
        const normalizedRef = UiStateBuilder.normalizeBranchRef(branch)
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

      // Check if this branch is checked out in a worktree
      let worktree: UiWorktreeBadge | undefined
      const worktreeInfo = state.worktreeByBranch.get(branch.ref)
      if (worktreeInfo) {
        // Determine worktree status
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

        // Only show worktree badge for non-active worktrees
        // (the current worktree's branch uses the regular blue highlight)
        if (status !== 'active') {
          worktree = {
            path: worktreeInfo.path,
            status,
            isMain: worktreeInfo.isMain
          }
        }
      }

      // Calculate owned commits for local, non-trunk branches
      // (only these branches can be dragged, and this info is used for drag operations)
      let ownedCommitShas: string[] | undefined
      if (!branch.isRemote && !branch.isTrunk) {
        ownedCommitShas = UiStateBuilder.collectOwnedCommitShas(branch.headSha, branch.ref, state)
      }

      // Compute permissions based on branch state
      // This keeps all business logic in the backend, making the UI dumb
      const isCurrent = branch.ref === state.currentBranch
      const canRename = !branch.isRemote && !branch.isTrunk
      const canDelete = !isCurrent && !branch.isTrunk

      // For squash: check if parent commit is on trunk (can't squash into trunk)
      const branchCommit = state.commitMap.get(branch.headSha)
      const parentSha = branchCommit?.parentSha
      const parentIsOnTrunk = parentSha ? state.trunkShas.has(parentSha) : true
      const canSquash = !branch.isRemote && !branch.isTrunk && !parentIsOnTrunk

      // Compute the reason why squash is disabled (for tooltip)
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
        canRename,
        canDelete,
        canSquash,
        squashDisabledReason,
        canCreateWorktree
      })
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Commit node helpers
  // ─────────────────────────────────────────────────────────────────────────

  private static getOrCreateUiCommit(sha: string, state: BuildState): UiCommit | null {
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
      name: UiStateBuilder.formatCommitName(commit),
      timestampMs: commit.timeMs ?? 0,
      isCurrent: commit.sha === state.currentCommitSha,
      rebaseStatus: null,
      spinoffs: [],
      branches: []
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

    let deepestUsefulIndex = trunkStack.commits.length - 1

    for (let i = 0; i < trunkStack.commits.length; i++) {
      const commit = trunkStack.commits[i]
      if (!commit) continue

      const hasSpinoffs = commit.spinoffs.length > 0
      const hasBranches = commit.branches.length > 0

      if (hasSpinoffs || hasBranches) {
        deepestUsefulIndex = i
        break
      }
    }

    trunkStack.commits = trunkStack.commits.slice(deepestUsefulIndex)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Rebase projection
  // ─────────────────────────────────────────────────────────────────────────

  private static deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
    if (options.rebaseSession) {
      // Check if we're still in the planning phase:
      // - No active job (nothing has started executing yet)
      // - Git is not currently rebasing
      // In this case, we should show the planning/prompting UI, not the rebasing UI.
      const session = options.rebaseSession
      const isStillPlanning =
        !session.queue.activeJobId && !repo.workingTreeStatus.isRebasing && options.rebaseIntent

      if (isStillPlanning && options.rebaseIntent) {
        // Treat as planning phase - show prompting UI
        const generateJobId =
          options.generateJobId ?? UiStateBuilder.createDefaultPreviewJobIdGenerator()
        const plan = RebaseStateMachine.createRebasePlan({
          repo,
          intent: options.rebaseIntent,
          generateJobId
        })
        return {
          kind: 'planning',
          plan
        }
      }

      return {
        kind: 'rebasing',
        session: options.rebaseSession
      }
    }

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
      promptingShas.add(target.node.headSha)
      UiStateBuilder.collectChildShas(target.node.children, idleShas)
    }

    UiStateBuilder.applyStatusToStackRecursive(stack, promptingShas, idleShas)
  }

  private static collectChildShas(children: StackNodeState[], result: Set<string>): void {
    for (const child of children) {
      result.add(child.headSha)
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
    // Find the oldest owned commit (the one whose parent is node.baseSha)
    // We need to move this commit's parent to targetBaseSha, keeping the chain intact
    // This ensures all owned commits (branchless ancestors) move together with the branch
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

    // Remove oldest commit from old parent's children
    if (oldestCommit.parentSha) {
      const previousParent = commits.get(oldestCommit.parentSha)
      if (previousParent) {
        previousParent.childrenSha = previousParent.childrenSha.filter(
          (sha) => sha !== oldestOwnedSha
        )
      }
    }

    // Update parent of oldest owned commit to new target
    oldestCommit.parentSha = targetBaseSha
    const newParent = commits.get(targetBaseSha)
    if (newParent && !newParent.childrenSha.includes(oldestOwnedSha)) {
      newParent.childrenSha = [...newParent.childrenSha, oldestOwnedSha]
    }

    // Update timestamps for all commits in the owned chain (from oldest to head)
    const parentTime = newParent?.timeMs ?? 0
    let chainSha: string | null = oldestOwnedSha
    let lastTime = parentTime
    while (chainSha) {
      const chainCommit = commits.get(chainSha)
      if (!chainCommit) break
      const syntheticTime = Math.max(allocateSyntheticTime(), lastTime + 1, chainCommit.timeMs ?? 0)
      chainCommit.timeMs = syntheticTime
      lastTime = syntheticTime
      // Stop when we reach the head
      if (chainSha === node.headSha) break
      // Find the child in this chain (the one that eventually leads to head)
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

    // Process children recursively - they're based on the head commit
    const headCommit = commits.get(node.headSha)
    node.children.forEach((child) =>
      UiStateBuilder.applyIntentTarget(commits, child, headCommit?.sha ?? node.headSha, allocateSyntheticTime)
    )
  }
}
