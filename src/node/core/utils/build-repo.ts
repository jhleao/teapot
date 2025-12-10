import type { Branch, Commit, Configuration, Repo } from '@shared/types'
import type { LogOptions } from '../git-adapter'
import { getGitAdapter } from '../git-adapter'
import { getTrunkBranchRef } from './get-trunk.js'

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
   * Use the load-remote-branches module to load them separately if needed.
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
  const trunkBranch = await getTrunkBranchRef(config, Array.from(branchNameSet))
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
 * Loads the remote trunk branch (origin/main or origin/master) if it exists.
 * This ensures we always show the sync state with remote, even when loadRemotes is false.
 * Returns null if no origin remote exists or no trunk branch is found.
 */
async function loadRemoteTrunkBranch(
  dir: string,
  localBranches: string[]
): Promise<BranchDescriptor | null> {
  const git = getGitAdapter()

  // Step 1: Determine trunk name from local branches
  const trunkCandidates = ['main', 'master', 'develop', 'trunk']
  const trunkName = trunkCandidates.find((candidate) => localBranches.includes(candidate))

  if (!trunkName) {
    // No recognizable trunk branch locally
    return null
  }

  // Step 2: Check if origin remote exists
  let remotes = await git.listRemotes(dir)

  const originRemote = remotes.find((remote) => remote.name === 'origin')
  if (!originRemote) {
    // No origin remote configured
    return null
  }

  // Step 3: Check if origin/{trunk} exists
  try {
    const remoteBranches = await git.listBranches(dir, { remote: 'origin' })

    // Note: listBranches with remote option returns full refs like 'origin/main'
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
    .filter((ref) => !isSymbolicBranch(ref))
    .map((ref) => ({
      ref,
      fullRef: `refs/heads/${ref}`,
      isRemote: false
    }))

  // Always load remote trunk to show sync state, even when loadRemotes is false
  const remoteTrunkDescriptor = await loadRemoteTrunkBranch(dir, localBranches)
  if (remoteTrunkDescriptor) {
    branchDescriptors.push(remoteTrunkDescriptor)
  }

  // Skip remote loading if not requested
  // Remote branches can be loaded separately using the load-remote-branches module
  if (!loadRemotes) {
    return branchDescriptors
  }

  // listBranches with remote option returns ALL remote branches with prefix (e.g., 'origin/main')
  // so we only need to call it once, not once per remote
  try {
    const remoteBranches = await git.listBranches(dir, { remote: 'all' })

    remoteBranches.forEach((remoteBranch) => {
      if (isSymbolicBranch(remoteBranch)) {
        return
      }
      // remoteBranch already includes remote prefix (e.g., 'origin/main')
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
    branches.push({
      ref: descriptor.ref,
      isTrunk: Boolean(trunkBranch && normalizedRef === trunkBranch),
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
  // This is crucial for large repos - trunk can have thousands of commits
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
  // Load from remote trunk HEAD until we find a commit already in commitsMap
  // This ensures we capture the gap between local and remote trunk
  if (remoteTrunkBranch?.headSha) {
    const remoteTrunkDescriptor = branchDescriptors.find((d) => d.ref === remoteTrunkBranch.ref)
    if (remoteTrunkDescriptor) {
      await collectCommitsUntilKnown(dir, remoteTrunkDescriptor.fullRef, commitsMap, {
        maxCommits: maxCommitsPerBranch
      })
    }
  }

  // Step 2: Load all non-trunk branches WITHOUT depth limit
  // Feature branches are typically small (1-20 commits), so we load them completely
  // This ensures the full changeset is visible in the stacked diff UI
  for (let i = 0; i < branchDescriptors.length; i += 1) {
    const descriptor = branchDescriptors[i]
    if (!descriptor) {
      continue
    }
    const branch = branches[i]
    if (!branch?.headSha) {
      continue
    }

    // Skip trunks (already loaded in steps 1 and 1.5)
    if (branch.isTrunk) {
      continue
    }

    // Load feature branch completely (no depth limit)
    await collectCommitsForRef(dir, descriptor.fullRef, commitsMap, {
      depth: undefined, // No depth limit for feature branches
      maxCommits: maxCommitsPerBranch // Safety limit only
    })
  }

  return Array.from(commitsMap.values()).sort((a, b) => b.timeMs - a.timeMs)
}

/**
 * Loads commits from a ref until we find a commit already in the map.
 * This is used for remote trunk to fill the gap between local and remote.
 */
async function collectCommitsUntilKnown(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: {
    maxCommits?: number
  } = {}
): Promise<void> {
  const git = getGitAdapter()
  const { maxCommits = 1000 } = options

  const logEntries = await git.log(dir, ref)

  let processedCount = 0
  for (const entry of logEntries) {
    if (processedCount >= maxCommits) {
      break
    }

    const sha = entry.sha
    const existingCommit = commitsMap.get(sha)

    // If we've already seen this commit AND it's fully populated, stop loading
    // A commit is fully populated if it has a message
    // Commits created as placeholders by ensureCommit have empty messages
    if (existingCommit && existingCommit.message) {
      break
    }

    const commit = ensureCommit(commitsMap, sha)

    // Populate commit metadata
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

    processedCount++
  }
}

async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: LogOptions = {}
): Promise<void> {
  const git = getGitAdapter()

  const logEntries = await git.log(dir, ref, options)

  for (const entry of logEntries) {
    const sha = entry.sha
    const commit = ensureCommit(commitsMap, sha)

    // Always populate commit metadata (message, time, parent)
    // This ensures commits created by ensureCommit() or from other branches get full data
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
