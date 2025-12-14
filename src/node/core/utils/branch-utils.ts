/**
 * Branch Utilities
 *
 * Shared utilities for branch operations used by smart checkout and ship-it navigation.
 */

import type { RemoteBranchRef } from '@shared/types/repo'
import { TRUNK_BRANCHES } from '@shared/types/repo'
import { getGitAdapter } from '../git-adapter'

/**
 * Parses a remote branch ref into remote name and local branch name.
 * Handles both 'origin/main' and 'refs/remotes/origin/main' formats,
 * as well as branches with slashes like 'origin/feature/foo/bar'.
 *
 * @param ref - The remote branch reference (e.g., 'origin/main', 'origin/feature/foo')
 * @returns Parsed remote and local branch, or null if invalid format
 *
 * @example
 * parseRemoteBranch('origin/main')
 * // => { remote: 'origin', localBranch: 'main' }
 *
 * @example
 * parseRemoteBranch('origin/feature/foo')
 * // => { remote: 'origin', localBranch: 'feature/foo' }
 *
 * @example
 * parseRemoteBranch('main')
 * // => null (local branch, no remote prefix)
 */
export function parseRemoteBranch(ref: string): RemoteBranchRef | null {
  if (!ref) return null

  // Handle 'refs/remotes/origin/main' format
  const normalized = ref.replace(/^refs\/remotes\//, '')

  // Match remote/branch where remote is the first segment and branch is everything after
  const match = normalized.match(/^([^/]+)\/(.+)$/)
  if (!match) return null

  return {
    remote: match[1],
    localBranch: match[2]
  }
}

/**
 * Checks if a branch exists in the repository.
 * Uses the branch listing to ensure we're checking for an actual branch,
 * not just any resolvable ref.
 *
 * @param repoPath - Repository directory path
 * @param branchName - Branch name to check
 * @returns True if the branch exists
 */
export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  const git = getGitAdapter()
  try {
    const branches = await git.listBranches(repoPath)
    return branches.includes(branchName)
  } catch {
    return false
  }
}

/**
 * Checks if localBranch can fast-forward to remoteBranch.
 * Returns true if localBranch is an ancestor of remoteBranch (or they are equal).
 *
 * This is used to verify a safe sync operation before checkout.
 *
 * @param repoPath - Repository directory path
 * @param localBranch - The local branch to check
 * @param remoteBranch - The remote branch to check against
 * @returns True if fast-forward is possible
 *
 * @example
 * // main is behind origin/main - can fast-forward
 * await canFastForward(repoPath, 'main', 'origin/main')
 * // => true
 *
 * @example
 * // main has local commits - cannot fast-forward
 * await canFastForward(repoPath, 'main', 'origin/main')
 * // => false
 */
export async function canFastForward(
  repoPath: string,
  localBranch: string,
  remoteBranch: string
): Promise<boolean> {
  const git = getGitAdapter()

  try {
    // Local is ancestor of remote = can fast-forward
    return await git.isAncestor(repoPath, localBranch, remoteBranch)
  } catch {
    // If check fails (e.g., branch doesn't exist), assume can't ff
    return false
  }
}

/**
 * Finds the local trunk branch name (main or master).
 *
 * @param repoPath - Repository directory path
 * @returns The trunk branch name, or null if neither exists
 */
export async function findLocalTrunk(repoPath: string): Promise<string | null> {
  for (const name of TRUNK_BRANCHES) {
    if (await branchExists(repoPath, name)) {
      return name
    }
  }

  return null
}
