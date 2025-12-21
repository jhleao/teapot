/**
 * RepoModelService - I/O operations for building and loading repository models.
 *
 * This service handles all git I/O needed to construct the Repo model:
 * - Loading branches (local and remote)
 * - Loading commits with depth limiting for large repos
 * - Detecting merged branches
 * - Building the full repo model
 */

import type { Branch, Commit, Configuration, Repo } from '@shared/types'
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
   * Maximum commits to load for any single branch (safety limit).
   * Prevents crashes from pathological cases like circular history.
   * Default: 1000
   */
  maxCommitsPerBranch?: number
}

const DEFAULT_OPTIONS: BuildRepoOptions = {
  trunkDepth: 200,
  loadRemotes: false,
  maxCommitsPerBranch: 1000
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
  const { trunkDepth, loadRemotes, maxCommitsPerBranch } = {
    ...DEFAULT_OPTIONS,
    ...options
  }

  const dir = config.repoPath
  const git = getGitAdapter()

  const localBranches = await git.listBranches(dir)

  const branchDescriptors = await collectBranchDescriptors(dir, localBranches, loadRemotes!)
  const branchNameSet = new Set<string>(localBranches)
  branchDescriptors.forEach((descriptor) => {
    branchNameSet.add(getBranchName(descriptor))
  })
  const trunkBranch = await resolveTrunkRef(dir, Array.from(branchNameSet))
  const branches = await buildBranchesFromDescriptors(dir, branchDescriptors, trunkBranch)
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
  const workingTreeStatus = await git.getWorkingTreeStatus(dir)

  return {
    path: dir,
    commits,
    branches,
    workingTreeStatus
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
  const branches: Branch[] = []

  for (const descriptor of branchDescriptors) {
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
      await collectCommitsForRef(dir, trunkDescriptor.fullRef, commitsMap, {
        depth: trunkDepth,
        maxCommits: maxCommitsPerBranch
      })
    }
  }

  // Step 1.5: Load remote trunk commits
  if (remoteTrunkBranch?.headSha) {
    const remoteTrunkDescriptor = branchDescriptors.find((d) => d.ref === remoteTrunkBranch.ref)
    if (remoteTrunkDescriptor) {
      await collectCommitsUntilKnown(dir, remoteTrunkDescriptor.fullRef, commitsMap, {
        maxCommits: maxCommitsPerBranch
      })
    }
  }

  // Step 2: Load all non-trunk branches until they meet known commits
  for (let i = 0; i < branchDescriptors.length; i += 1) {
    const descriptor = branchDescriptors[i]
    if (!descriptor) {
      continue
    }
    const branch = branches[i]
    if (!branch?.headSha) {
      continue
    }

    if (branch.isTrunk) {
      continue
    }

    await collectCommitsUntilKnown(dir, descriptor.fullRef, commitsMap, {
      maxCommits: maxCommitsPerBranch
    })
  }

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
  const cache = CacheService.getRepoCache(dir)
  const { maxCommits = 1000 } = options

  const headSha = await git.resolveRef(dir, ref)
  if (!headSha) {
    return
  }

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
