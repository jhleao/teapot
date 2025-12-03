import type { Branch, Commit, Configuration, Repo, WorkingTreeStatus } from '@shared/types'
import fs from 'fs'
import git from 'isomorphic-git'
import path from 'path'
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

  const localBranches = await git.listBranches({
    fs,
    dir
  })

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
  const workingTreeStatus = await collectWorkingTreeStatus(dir, branchDescriptors)

  return {
    path: dir,
    commits,
    branches,
    workingTreeStatus
  }
}

async function collectBranchDescriptors(
  dir: string,
  localBranches: string[],
  loadRemotes: boolean
): Promise<BranchDescriptor[]> {
  const branchDescriptors: BranchDescriptor[] = localBranches
    .filter((ref) => !isSymbolicBranch(ref))
    .map((ref) => ({
      ref,
      fullRef: `refs/heads/${ref}`,
      isRemote: false
    }))

  // Skip remote loading if not requested
  // Remote branches can be loaded separately using the load-remote-branches module
  if (!loadRemotes) {
    return branchDescriptors
  }

  let remotes: { remote: string; url: string }[] = []
  try {
    remotes = await git.listRemotes({ fs, dir })
  } catch {
    remotes = []
  }

  for (const remote of remotes) {
    try {
      const remoteBranches = await git.listBranches({
        fs,
        dir,
        remote: remote.remote
      })

      remoteBranches.forEach((remoteBranch) => {
        if (isSymbolicBranch(remoteBranch)) {
          return
        }
        branchDescriptors.push({
          ref: `${remote.remote}/${remoteBranch}`,
          fullRef: `refs/remotes/${remote.remote}/${remoteBranch}`,
          isRemote: true
        })
      })
    } catch {
      // Ignore remotes we cannot read
    }
  }

  return branchDescriptors
}

async function buildBranchesFromDescriptors(
  dir: string,
  branchDescriptors: BranchDescriptor[],
  trunkBranch: string | null
): Promise<Branch[]> {
  const branches: Branch[] = []

  for (const descriptor of branchDescriptors) {
    const headSha = await resolveBranchHead(dir, descriptor.fullRef)
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

  // Step 1: Load trunk first with depth limit
  // This is crucial for large repos - trunk can have thousands of commits
  const trunkBranch = branches.find((b) => b.ref === trunkBranchName && !b.isRemote)

  if (trunkBranch?.headSha) {
    const trunkDescriptor = branchDescriptors.find((d) => d.ref === trunkBranch.ref)
    if (trunkDescriptor) {
      await collectCommitsForRef(dir, trunkDescriptor.fullRef, commitsMap, {
        depth: trunkDepth,
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

    // Skip trunk (already loaded with depth limit)
    if (branch.isTrunk && !branch.isRemote) {
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

async function resolveBranchHead(dir: string, ref: string): Promise<string> {
  try {
    return await git.resolveRef({
      fs,
      dir,
      ref
    })
  } catch {
    return ''
  }
}

async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: {
    depth?: number
    maxCommits?: number
  } = {}
): Promise<void> {
  const { depth, maxCommits = 1000 } = options

  try {
    const logEntries = await git.log({
      fs,
      dir,
      ref,
      ...(depth !== undefined && { depth }) // Only pass depth if defined
    })

    // Safety: Cap at maxCommits even if git.log returns more
    const entriesToProcess = logEntries.slice(0, maxCommits)

    for (const entry of entriesToProcess) {
      const sha = entry.oid
      const commit = ensureCommit(commitsMap, sha)

      // Always populate commit metadata (message, time, parent)
      // This ensures commits created by ensureCommit() or from other branches get full data
      commit.message = entry.commit.message.trim()
      commit.timeMs = (entry.commit.author?.timestamp ?? 0) * 1000

      const parentSha = entry.commit.parent?.[0] ?? ''
      commit.parentSha = parentSha

      if (parentSha) {
        const parentCommit = ensureCommit(commitsMap, parentSha)
        if (!parentCommit.childrenSha.includes(sha)) {
          parentCommit.childrenSha.push(sha)
        }
      }
    }
  } catch {
    // Ignore branches we cannot traverse (e.g. shallow clones)
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

async function collectWorkingTreeStatus(
  dir: string,
  branchDescriptors: BranchDescriptor[]
): Promise<WorkingTreeStatus> {
  const headSha = await resolveBranchHead(dir, 'HEAD')
  let branchName: string | null = null
  try {
    const resolvedBranch = await git.currentBranch({ fs, dir, fullname: false })
    branchName = resolvedBranch ?? null
  } catch {
    branchName = null
  }

  const detached = !branchName
  const currentBranch = branchName ?? 'HEAD'
  let tracking = branchName ? await resolveTrackingBranch(dir, branchName) : null
  if (!tracking && branchName) {
    const matchingRemote = branchDescriptors.find(
      (descriptor) => descriptor.isRemote && getBranchName(descriptor) === branchName
    )
    if (matchingRemote) {
      tracking = matchingRemote.ref
    }
  }
  const isRebasing = await detectRebase(dir)

  let matrix: Array<[string, number, number, number]> = []
  try {
    matrix = await git.statusMatrix({ fs, dir })
  } catch {
    matrix = []
  }

  const staged = new Set<string>()
  const modified = new Set<string>()
  const created = new Set<string>()
  const deleted = new Set<string>()
  const renamed = new Set<string>()
  const notAdded = new Set<string>()
  const conflicted = new Set<string>()

  const FILE = 0
  const HEAD = 1
  const WORKDIR = 2
  const STAGE = 3

  for (const row of matrix) {
    const filepath = row[FILE]
    const headStatus = row[HEAD]
    const workdirStatus = row[WORKDIR]
    const stageStatus = row[STAGE]

    if (headStatus !== stageStatus) {
      staged.add(filepath)
    }

    const isTracked = headStatus !== 0 || stageStatus !== 0
    if (stageStatus !== workdirStatus && isTracked) {
      modified.add(filepath)
    }

    if (headStatus === 0) {
      if (stageStatus === 0 && workdirStatus === 2) {
        notAdded.add(filepath)
      } else if (stageStatus > 0) {
        created.add(filepath)
      }
    }

    if (headStatus === 1 && (stageStatus === 0 || workdirStatus === 0)) {
      deleted.add(filepath)
    }
  }

  const allChangedFilesSet = new Set<string>()
  const addAll = (values: Set<string>): void => {
    values.forEach((value) => allChangedFilesSet.add(value))
  }
  ;[staged, modified, created, deleted, renamed, notAdded, conflicted].forEach(addAll)

  return {
    currentBranch,
    currentCommitSha: headSha,
    tracking,
    detached,
    isRebasing,
    staged: toSortedArray(staged),
    modified: toSortedArray(modified),
    created: toSortedArray(created),
    deleted: toSortedArray(deleted),
    renamed: toSortedArray(renamed),
    not_added: toSortedArray(notAdded),
    conflicted: toSortedArray(conflicted),
    allChangedFiles: toSortedArray(allChangedFilesSet)
  }
}

function toSortedArray(values: Set<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

async function resolveTrackingBranch(dir: string, branchName: string): Promise<string | null> {
  try {
    const remoteName = await git.getConfig({
      fs,
      dir,
      path: `branch.${branchName}.remote`
    })
    const mergeRef = await git.getConfig({
      fs,
      dir,
      path: `branch.${branchName}.merge`
    })
    if (!remoteName || !mergeRef) {
      return null
    }
    const normalized = mergeRef.replace(/^refs\/heads\//, '')
    return `${remoteName}/${normalized}`
  } catch {
    return null
  }
}

async function detectRebase(dir: string): Promise<boolean> {
  const gitDir = path.join(dir, '.git')
  return (
    (await pathExists(path.join(gitDir, 'rebase-merge'))) ||
    (await pathExists(path.join(gitDir, 'rebase-apply')))
  )
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}
