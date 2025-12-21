import type { Branch, Repo } from '@shared/types'
import type { GitAdapter } from '../adapters/git'
import * as CacheService from './CacheService'
import { detectMergedBranches } from './RepoModelService'

/**
 * Centralized merged-branch detection with caching keyed by trunk HEAD.
 *
 * Used by UI state and PR targeting to avoid duplicated policy and computation.
 */
export async function getMergedBranchNames(
  repoPath: string,
  repo: Repo,
  git: GitAdapter
): Promise<string[]> {
  const cache = CacheService.getRepoCache(repoPath)
  const trunk = findTrunkBranch(repo.branches)
  const trunkRef = trunk?.ref ?? 'main'
  const trunkHeadSha = trunk?.headSha ?? ''

  const cached = cache.getMergedBranches(trunkHeadSha)
  if (cached) {
    return cached
  }

  const mergedBranchNames = await detectMergedBranches(repoPath, repo.branches, trunkRef, git)

  cache.setMergedBranches(trunkHeadSha, mergedBranchNames)
  return mergedBranchNames
}

function findTrunkBranch(branches: Branch[]): Branch | undefined {
  return branches.find((b) => b.isTrunk && !b.isRemote) ?? branches.find((b) => b.isTrunk)
}
