/**
 * RepoModelService - I/O operations for building and loading repository models.
 *
 * This service handles all git I/O needed to construct the Repo model:
 * - Loading branches (local and remote)
 * - Loading commits with depth limiting for large repos
 * - Detecting merged branches
 * - Building the full repo model
 */

import { log } from '@shared/logger'
import type { Branch, Commit, Configuration, Repo, Worktree } from '@shared/types'
import { isTrunk as isTrunkBranchName } from '@shared/types'
import type { GitAdapter, LogOptions } from '../adapters/git'
import { getGitAdapter, resolveTrunkRef } from '../adapters/git'
import { TRUNK_BRANCHES } from '../shared/constants'
import * as CacheService from './CacheService'

type BranchDescriptor = {
  ref: string
  fullRef: string
  isRemote: boolean
}

export type BuildRepoOptions = {
  /**
   * Maximum commits to load for trunk branch.
   * This prevents crashes with large repositories by limiting trunk history depth.
   * Feature branches are always loaded completely (they're typically small).
   * Default: 200
   */
  trunkDepth?: number
  /**
   * Whether to load remote branches.
   * Remote branches are expensive to load and often not needed for stacked diff workflows.
   * Use loadRemoteBranches to load them separately if needed.
   * Default: false
   */
  loadRemotes?: boolean
  /**
   * Skip dirty checking for worktrees.
   * Dirty status is used for UI badges (yellow worktree indicator).
   * Default: false
   */
  skipWorktreeDirtyCheck?: boolean
  /**
   * Maximum commits to load for any single branch (safety limit).
   * Prevents crashes from pathological cases like circular history.
   * Default: 1000
   */
  maxCommitsPerBranch?: number
  /**
   * Active worktree path. If set, workingTreeStatus will reflect this worktree.
   * If null/undefined, uses the main worktree (repoPath).
   */
  activeWorktreePath?: string | null
}

const DEFAULT_OPTIONS: BuildRepoOptions = {
  trunkDepth: 200,
  loadRemotes: false,
  maxCommitsPerBranch: 1000,
  skipWorktreeDirtyCheck: false
}

/**
 * Builds the complete repository model from git state.
 *
 * @param config - Repository configuration with repoPath
 * @param options - Build options for controlling depth and remote loading
 * @returns The complete Repo model
 */
export async function buildRepoModel(
  config: Configuration,
  options: BuildRepoOptions = {}
): Promise<Repo> {
  const buildStart = log.trace('[RepoModelService] buildRepoModel START')

  const {
    trunkDepth,
    loadRemotes,
    maxCommitsPerBranch,
    activeWorktreePath,
    skipWorktreeDirtyCheck
  } = {
    ...DEFAULT_OPTIONS,
    ...options
  }

  const dir = config.repoPath
  // Use active worktree for working tree status, or main repo path if not set
  const effectiveWorktreePath = activeWorktreePath ?? dir
  const git = getGitAdapter()

  const listBranchesStart = log.trace('[RepoModelService] listBranches START')
  const localBranches = await git.listBranches(dir)
  log.trace('[RepoModelService] listBranches END', {
    startMs: listBranchesStart,
    count: localBranches.length
  })

  const collectDescStart = log.trace('[RepoModelService] collectBranchDescriptors START')
  const branchDescriptors = await collectBranchDescriptors(dir, localBranches, loadRemotes!)
  log.trace('[RepoModelService] collectBranchDescriptors END', {
    startMs: collectDescStart,
    count: branchDescriptors.length
  })

  const branchNameSet = new Set<string>(localBranches)
  branchDescriptors.forEach((descriptor) => {
    branchNameSet.add(getBranchName(descriptor))
  })

  const trunkRefStart = log.trace('[RepoModelService] resolveTrunkRef START')
  const trunkBranch = await resolveTrunkRef(dir, Array.from(branchNameSet))
  log.trace('[RepoModelService] resolveTrunkRef END', { startMs: trunkRefStart, trunkBranch })

  const buildBranchesStart = log.trace('[RepoModelService] buildBranchesFromDescriptors START')
  const branches = await buildBranchesFromDescriptors(dir, branchDescriptors, trunkBranch)
  log.trace('[RepoModelService] buildBranchesFromDescriptors END', {
    startMs: buildBranchesStart,
    count: branches.length
  })

  const collectCommitsStart = log.trace('[RepoModelService] collectCommitsFromDescriptors START')
  const commits = await collectCommitsFromDescriptors(
    dir,
    branchDescriptors,
    branches,
    trunkBranch,
    {
      trunkDepth: trunkDepth!,
      maxCommitsPerBranch: maxCommitsPerBranch!
    }
  )
  log.trace('[RepoModelService] collectCommitsFromDescriptors END', {
    startMs: collectCommitsStart,
    count: commits.length
  })

  // Get working tree status from the active worktree
  const statusStart = log.trace('[RepoModelService] getWorkingTreeStatus START')
  const workingTreeStatus = await git.getWorkingTreeStatus(effectiveWorktreePath)
  log.trace('[RepoModelService] getWorkingTreeStatus END', { startMs: statusStart })

  // Load worktrees
  const worktreesStart = log.trace('[RepoModelService] loadWorktrees START')
  const worktrees = await loadWorktrees(dir, { skipDirtyCheck: skipWorktreeDirtyCheck })
  log.trace('[RepoModelService] loadWorktrees END', {
    startMs: worktreesStart,
    count: worktrees.length
  })

  log.trace('[RepoModelService] buildRepoModel END', {
    startMs: buildStart,
    branches: branches.length,
    commits: commits.length,
    worktrees: worktrees.length
  })

  return {
    path: dir,
    activeWorktreePath: activeWorktreePath ?? null,
    commits,
    branches,
    workingTreeStatus,
    worktrees
  }
}

/**
 * Loads all worktrees for the repository.
 *
 * @param dir - Repository directory path (any worktree path works)
 * @param options - Optional settings for worktree loading
 * @returns Array of worktree information
 */
async function loadWorktrees(
  dir: string,
  options?: { skipDirtyCheck?: boolean }
): Promise<Worktree[]> {
  const git = getGitAdapter()

  try {
    const worktreeInfos = await git.listWorktrees(dir, {
      skipDirtyCheck: options?.skipDirtyCheck
    })
    return worktreeInfos.map((info) => ({
      path: info.path,
      headSha: info.headSha,
      branch: info.branch,
      isMain: info.isMain,
      isStale: info.isStale,
      isDirty: info.isDirty
    }))
  } catch {
    // If worktree listing fails (e.g., old git version), return empty array
    return []
  }
}

/**
 * Loads remote branches from all remotes in the repository.
 *
 * @param dir - Repository directory path
 * @returns Array of remote branch descriptors
 */
export async function loadRemoteBranches(dir: string): Promise<BranchDescriptor[]> {
  const git = getGitAdapter()
  const remoteBranches: BranchDescriptor[] = []

  try {
    const branches = await git.listBranches(dir, { remote: 'all' })

    branches.forEach((remoteBranch) => {
      if (isSymbolicBranch(remoteBranch)) {
        return
      }
      remoteBranches.push({
        ref: remoteBranch,
        fullRef: `refs/remotes/${remoteBranch}`,
        isRemote: true
      })
    })
  } catch {
    // Ignore if we cannot read remote branches
  }

  return remoteBranches
}

/**
 * Resolves remote branch descriptors to full Branch objects with head SHAs.
 *
 * @param dir - Repository directory path
 * @param descriptors - Remote branch descriptors
 * @param trunkBranch - Name of the trunk branch (for marking trunk remotes)
 * @returns Array of Branch objects
 */
export async function buildBranchesFromRemoteDescriptors(
  dir: string,
  descriptors: BranchDescriptor[],
  trunkBranch: string | null
): Promise<Branch[]> {
  const git = getGitAdapter()
  const branches: Branch[] = []

  for (const descriptor of descriptors) {
    const headSha = await git.resolveRef(dir, descriptor.fullRef)
    const normalizedRef = getBranchName(descriptor)
    const isTrunk =
      (trunkBranch && normalizedRef === trunkBranch) || isTrunkBranchName(normalizedRef)
    branches.push({
      ref: descriptor.ref,
      isTrunk,
      isRemote: descriptor.isRemote,
      headSha
    })
  }

  return branches
}

/**
 * Detects which branches have been merged into trunk.
 *
 * A branch is considered "merged" if its head commit is an ancestor of
 * (or equal to) the trunk head commit. This handles:
 * - Fast-forward merges: branch head is now on trunk
 * - Squash merges: NOT detected (commits are different) - rely on PR state
 * - Rebase merges: NOT detected (commits are rebased) - rely on PR state
 *
 * @param repoPath - Path to the repository
 * @param branches - Array of branches to check
 * @param trunkRef - Reference to trunk (e.g., 'main', 'origin/main')
 * @param adapter - Git adapter for repository operations
 * @returns Array of branch names that are merged into trunk
 */
export async function detectMergedBranches(
  repoPath: string,
  branches: Branch[],
  trunkRef: string,
  adapter: GitAdapter
): Promise<string[]> {
  if (branches.length === 0) {
    return []
  }

  // Filter out branches that shouldn't be checked:
  // - Trunk branches (main/master shouldn't be marked as "merged into itself")
  // - Branches with empty headSha (invalid/ghost branches)
  const candidateBranches = branches.filter((branch) => !branch.isTrunk && branch.headSha)

  if (candidateBranches.length === 0) {
    return []
  }

  // Check each candidate branch in parallel for better performance
  const results = await Promise.all(
    candidateBranches.map(async (branch) => {
      try {
        const isMerged = await adapter.isAncestor(repoPath, branch.headSha, trunkRef)
        return { name: branch.ref, isMerged }
      } catch {
        return { name: branch.ref, isMerged: false }
      }
    })
  )

  return results.filter((r) => r.isMerged).map((r) => r.name)
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Loads the remote trunk branch (origin/main or origin/master) if it exists.
 */
async function loadRemoteTrunkBranch(
  dir: string,
  localBranches: string[]
): Promise<BranchDescriptor | null> {
  const git = getGitAdapter()

  const trunkName = TRUNK_BRANCHES.find((candidate) => localBranches.includes(candidate))
  if (!trunkName) {
    return null
  }

  const remotes = await git.listRemotes(dir)
  const originRemote = remotes.find((remote) => remote.name === 'origin')
  if (!originRemote) {
    return null
  }

  try {
    const remoteBranches = await git.listBranches(dir, { remote: 'origin' })
    if (remoteBranches.includes(`origin/${trunkName}`)) {
      return {
        ref: `origin/${trunkName}`,
        fullRef: `refs/remotes/origin/${trunkName}`,
        isRemote: true
      }
    }
  } catch {
    // Remote branch lookup failed
  }

  return null
}

async function collectBranchDescriptors(
  dir: string,
  localBranches: string[],
  loadRemotes: boolean
): Promise<BranchDescriptor[]> {
  const git = getGitAdapter()

  const branchDescriptors: BranchDescriptor[] = localBranches
    .filter((ref) => !isSymbolicBranch(ref) && !isRemoteBranchRef(ref))
    .map((ref) => ({
      ref,
      fullRef: `refs/heads/${ref}`,
      isRemote: false
    }))

  // Always load remote trunk to show sync state
  const remoteTrunkDescriptor = await loadRemoteTrunkBranch(dir, localBranches)
  if (remoteTrunkDescriptor) {
    branchDescriptors.push(remoteTrunkDescriptor)
  }

  if (!loadRemotes) {
    return branchDescriptors
  }

  try {
    const remoteBranches = await git.listBranches(dir, { remote: 'all' })

    remoteBranches.forEach((remoteBranch) => {
      if (isSymbolicBranch(remoteBranch)) {
        return
      }
      branchDescriptors.push({
        ref: remoteBranch,
        fullRef: `refs/remotes/${remoteBranch}`,
        isRemote: true
      })
    })
  } catch {
    // Ignore if we cannot read remote branches
  }

  return branchDescriptors
}

async function buildBranchesFromDescriptors(
  dir: string,
  branchDescriptors: BranchDescriptor[],
  trunkBranch: string | null
): Promise<Branch[]> {
  const git = getGitAdapter()

  // Batch resolve all refs in a single git call (much faster than 86 individual calls)
  const refs = branchDescriptors.map((d) => d.fullRef)
  const shaMap = await git.resolveRefs(dir, refs)

  // Build branch objects using the resolved SHAs
  const branches = branchDescriptors.map((descriptor) => {
    const headSha = shaMap.get(descriptor.fullRef) ?? ''
    const normalizedRef = getBranchName(descriptor)
    const isTrunk =
      (trunkBranch && normalizedRef === trunkBranch) || isTrunkBranchName(normalizedRef)
    return {
      ref: descriptor.ref,
      isTrunk,
      isRemote: descriptor.isRemote,
      headSha
    }
  })

  return branches
}

async function collectCommitsFromDescriptors(
  dir: string,
  branchDescriptors: BranchDescriptor[],
  branches: Branch[],
  trunkBranchName: string | null,
  options: {
    trunkDepth: number
    maxCommitsPerBranch: number
  }
): Promise<Commit[]> {
  const commitsMap = new Map<string, Commit>()
  const { trunkDepth, maxCommitsPerBranch } = options

  // Step 1: Load local trunk with depth limit
  const trunkBranch = branches.find((b) => b.ref === trunkBranchName && !b.isRemote)
  const remoteTrunkBranch = branches.find((b) => b.isTrunk && b.isRemote)

  if (trunkBranch?.headSha) {
    const trunkDescriptor = branchDescriptors.find((d) => d.ref === trunkBranch.ref)
    if (trunkDescriptor) {
      const trunkStart = log.trace('[collectCommits] trunk START')
      await collectCommitsForRef(dir, trunkDescriptor.fullRef, commitsMap, {
        depth: trunkDepth,
        maxCommits: maxCommitsPerBranch
      })
      log.trace('[collectCommits] trunk END', { startMs: trunkStart, commits: commitsMap.size })
    }
  }

  // Step 1.5: Load remote trunk commits
  if (remoteTrunkBranch?.headSha) {
    const remoteTrunkDescriptor = branchDescriptors.find((d) => d.ref === remoteTrunkBranch.ref)
    if (remoteTrunkDescriptor) {
      const remoteTrunkStart = log.trace('[collectCommits] remoteTrunk START')
      await collectCommitsUntilKnown(dir, remoteTrunkDescriptor.fullRef, commitsMap, {
        maxCommits: maxCommitsPerBranch
      })
      log.trace('[collectCommits] remoteTrunk END', {
        startMs: remoteTrunkStart,
        commits: commitsMap.size
      })
    }
  }

  // Step 2: Load all non-trunk branches until they meet known commits
  // Parallelize git log calls for better performance (commits may be fetched redundantly
  // for overlapping branches, but wall-clock time is much better than sequential)
  const featureBranchesStart = log.trace('[collectCommits] featureBranches START')

  // Collect all feature branch headShas
  const featureBranchShas: string[] = []
  for (let i = 0; i < branchDescriptors.length; i += 1) {
    const descriptor = branchDescriptors[i]
    if (!descriptor) continue
    const branch = branches[i]
    if (!branch?.headSha || branch.isTrunk) continue
    featureBranchShas.push(branch.headSha)
  }

  // Load all feature branches in parallel
  await Promise.all(
    featureBranchShas.map((headSha) =>
      collectCommitsFromSha(dir, headSha, commitsMap, {
        maxCommits: maxCommitsPerBranch
      })
    )
  )

  log.trace('[collectCommits] featureBranches END', {
    startMs: featureBranchesStart,
    branches: featureBranchShas.length,
    commits: commitsMap.size
  })

  return Array.from(commitsMap.values()).sort((a, b) => b.timeMs - a.timeMs)
}

async function collectCommitsUntilKnown(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: {
    maxCommits?: number
  } = {}
): Promise<void> {
  const git = getGitAdapter()
  const headSha = await git.resolveRef(dir, ref)
  if (!headSha) {
    return
  }
  await collectCommitsFromSha(dir, headSha, commitsMap, options)
}

/**
 * Collect commits starting from a known SHA (avoids ref resolution).
 * More efficient when the head SHA is already known.
 */
async function collectCommitsFromSha(
  dir: string,
  headSha: string,
  commitsMap: Map<string, Commit>,
  options: {
    maxCommits?: number
  } = {}
): Promise<void> {
  if (!headSha) {
    return
  }

  const git = getGitAdapter()
  const cache = CacheService.getRepoCache(dir)
  const { maxCommits = 1000 } = options

  // Phase 1: Walk the cache
  let currentSha: string | null = headSha
  let processedCount = 0
  let needsGitFetch = false
  let fetchFromSha: string | null = null

  while (currentSha && processedCount < maxCommits) {
    const existingCommit = commitsMap.get(currentSha)
    if (existingCommit && existingCommit.message) {
      break
    }

    const cached = cache.getCommit(currentSha)
    if (cached) {
      const commit = ensureCommit(commitsMap, cached.sha)
      commit.message = cached.message
      commit.timeMs = cached.timeMs
      commit.parentSha = cached.parentSha

      if (cached.parentSha) {
        const parentCommit = ensureCommit(commitsMap, cached.parentSha)
        if (!parentCommit.childrenSha.includes(cached.sha)) {
          parentCommit.childrenSha.push(cached.sha)
        }
      }

      currentSha = cached.parentSha || null
      processedCount++
    } else {
      needsGitFetch = true
      fetchFromSha = currentSha
      break
    }
  }

  // Phase 2: Fetch from git if needed
  if (needsGitFetch && fetchFromSha && processedCount < maxCommits) {
    const remaining = maxCommits - processedCount
    const logEntries = await git.log(dir, fetchFromSha, { maxCommits: remaining })

    for (const entry of logEntries) {
      const sha = entry.sha
      const existingCommit = commitsMap.get(sha)

      if (existingCommit && existingCommit.message) {
        break
      }

      cache.setCommit({
        sha: entry.sha,
        message: entry.message,
        timeMs: entry.timeMs,
        parentSha: entry.parentSha
      })

      const commit = ensureCommit(commitsMap, sha)
      commit.message = entry.message
      commit.timeMs = entry.timeMs
      commit.parentSha = entry.parentSha

      if (entry.parentSha) {
        const parentCommit = ensureCommit(commitsMap, entry.parentSha)
        if (!parentCommit.childrenSha.includes(sha)) {
          parentCommit.childrenSha.push(sha)
        }
      }

      processedCount++
    }
  }
}

async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: LogOptions = {}
): Promise<void> {
  const git = getGitAdapter()
  const cache = CacheService.getRepoCache(dir)

  const logEntries = await git.log(dir, ref, options)

  for (const entry of logEntries) {
    const sha = entry.sha

    cache.setCommit({
      sha: entry.sha,
      message: entry.message,
      timeMs: entry.timeMs,
      parentSha: entry.parentSha
    })

    const commit = ensureCommit(commitsMap, sha)
    commit.message = entry.message
    commit.timeMs = entry.timeMs

    const parentSha = entry.parentSha
    commit.parentSha = parentSha

    if (parentSha) {
      const parentCommit = ensureCommit(commitsMap, parentSha)
      if (!parentCommit.childrenSha.includes(sha)) {
        parentCommit.childrenSha.push(sha)
      }
    }
  }
}

function ensureCommit(commitsMap: Map<string, Commit>, sha: string): Commit {
  let commit = commitsMap.get(sha)
  if (!commit) {
    commit = {
      sha,
      message: '',
      timeMs: 0,
      parentSha: '',
      childrenSha: []
    }
    commitsMap.set(sha, commit)
  }
  return commit
}

function getBranchName(descriptor: BranchDescriptor): string {
  if (!descriptor.isRemote) {
    return descriptor.ref
  }

  const slashIndex = descriptor.ref.indexOf('/')
  return slashIndex >= 0 ? descriptor.ref.slice(slashIndex + 1) : descriptor.ref
}

function isSymbolicBranch(ref: string): boolean {
  return ref === 'HEAD' || ref.endsWith('/HEAD')
}

function isRemoteBranchRef(ref: string): boolean {
  const commonRemotes = ['origin', 'upstream', 'fork']
  const slashIndex = ref.indexOf('/')
  if (slashIndex <= 0) {
    return false
  }
  const prefix = ref.slice(0, slashIndex)
  return commonRemotes.includes(prefix)
}
