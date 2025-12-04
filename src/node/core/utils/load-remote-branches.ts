import type { Branch } from '@shared/types'
import { getGitAdapter } from '../git-adapter'

type BranchDescriptor = {
  ref: string
  fullRef: string
  isRemote: boolean
}

/**
 * Loads remote branches from all remotes in the repository.
 * This is extracted as a separate module to allow future configuration
 * and to keep the main build-repo logic focused on local branches.
 *
 * @param dir - Repository directory path
 * @returns Array of remote branch descriptors
 */
export async function loadRemoteBranches(dir: string): Promise<BranchDescriptor[]> {
  const git = getGitAdapter()
  const remoteBranches: BranchDescriptor[] = []

  // listBranches with remote option returns ALL remote branches with prefix (e.g., 'origin/main')
  // so we only need to call it once
  try {
    const branches = await git.listBranches(dir, { remote: 'all' })

    branches.forEach((remoteBranch) => {
      if (isSymbolicBranch(remoteBranch)) {
        return
      }
      // remoteBranch already includes remote prefix (e.g., 'origin/main')
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

    branches.push({
      ref: descriptor.ref,
      isTrunk: Boolean(trunkBranch && normalizedRef === trunkBranch),
      isRemote: descriptor.isRemote,
      headSha
    })
  }

  return branches
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
