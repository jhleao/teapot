/**
 * Smart Checkout Utility
 *
 * Handles intelligent checkout behavior for both local and remote branches:
 * - Local branches: Direct checkout
 * - Remote branches: Fetch, fast-forward/create local tracking branch, then checkout
 *
 * The goal is to provide a seamless UX when checking out remote branches
 * without leaving the user on a potentially stale local branch.
 */

import { log } from '@shared/logger'
import type { RemoteBranchCheckoutResult } from '@shared/types/repo'
import { getGitAdapter } from '../git-adapter'
import { supportsMerge } from '../git-adapter/interface'
import { branchExists, canFastForward, parseRemoteBranch } from './branch-utils'

/**
 * Smart checkout that handles both local and remote branches intelligently.
 *
 * For local branches:
 * - Simple checkout
 *
 * For remote branches (e.g., origin/feature):
 * - First pulls (fast-forwards or creates) the local branch from remote
 * - Then checks out the local branch
 *
 * @param repoPath - Repository path
 * @param ref - Branch reference (local or remote)
 * @returns Result of the checkout operation
 */
export async function smartCheckout(
  repoPath: string,
  ref: string
): Promise<RemoteBranchCheckoutResult> {
  // Parse to see if this is a remote branch ref
  const parsed = parseRemoteBranch(ref)

  if (parsed) {
    // This is a remote branch (e.g., origin/main)
    // First pull (ff or create) the local branch, then checkout
    const pullResult = await pullRemoteBranch(repoPath, ref, parsed.remote, parsed.localBranch)

    if (pullResult.status !== 'success') {
      return {
        success: false,
        error: pullResult.error ?? `Pull failed with status: ${pullResult.status}`
      }
    }

    // Now checkout the local branch
    return checkoutLocalBranch(repoPath, parsed.localBranch)
  }

  // Local branch checkout
  return checkoutLocalBranch(repoPath, ref)
}

/**
 * Checkout a local branch.
 *
 * @param repoPath - Repository path
 * @param branchName - Name of the local branch to checkout
 * @returns Result of the checkout operation
 */
export async function checkoutLocalBranch(
  repoPath: string,
  branchName: string
): Promise<RemoteBranchCheckoutResult> {
  const git = getGitAdapter()

  try {
    // First verify the branch exists
    const exists = await branchExists(repoPath, branchName)

    if (!exists) {
      // Check if it could be a valid ref (commit SHA, tag, etc.)
      try {
        await git.resolveRef(repoPath, branchName)
        // It's a valid ref but not a branch - still try checkout
      } catch {
        return {
          success: false,
          error: `Branch '${branchName}' not found`
        }
      }
    }

    await git.checkout(repoPath, branchName)

    return {
      success: true,
      localBranch: branchName
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(`[checkoutLocalBranch] Failed to checkout ${branchName}:`, error)

    return {
      success: false,
      error: `Checkout failed: ${message}`
    }
  }
}

export type PullRemoteBranchResult = {
  status: 'success' | 'conflict' | 'error'
  error?: string
}

/**
 * Pull a remote branch by fast-forwarding or creating the corresponding local branch.
 *
 * This function fetches from the remote and then either:
 * - Creates the local branch if it doesn't exist
 * - Fast-forwards the local branch if it can be safely updated
 *
 * If the local branch has diverged from the remote (cannot fast-forward), this is a no-op
 * and returns a 'conflict' status. The caller can then decide how to handle it.
 */
export async function pullRemoteBranch(
  repoPath: string,
  remoteRef: string,
  remote: string,
  localBranch: string
): Promise<PullRemoteBranchResult> {
  const git = getGitAdapter()

  try {
    // 1. Fetch from remote to ensure we have latest state
    try {
      await git.fetch(repoPath, remote)
    } catch (fetchError) {
      const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError)
      return {
        status: 'error',
        error: `Failed to fetch from ${remote}: ${fetchMessage}`
      }
    }

    // 2. Check if local branch already exists
    const localExists = await branchExists(repoPath, localBranch)

    if (!localExists) {
      // Local branch doesn't exist - create it from remote
      await git.branch(repoPath, localBranch, {
        checkout: false,
        startPoint: remoteRef
      })
      return { status: 'success' }
    }

    // 3. Local branch exists - check if we can fast-forward
    const canFF = await canFastForward(repoPath, localBranch, remoteRef)

    if (!canFF) {
      // Cannot fast-forward - this is a conflict (diverged branches)
      return {
        status: 'conflict',
        error: `Cannot sync: ${localBranch} has diverged from ${remoteRef}`
      }
    }

    // 4. Fast-forward the local branch to match remote
    // We need to be on the branch to ff, or use update-ref
    const currentBranch = await git.currentBranch(repoPath)
    const wasOnTargetBranch = currentBranch === localBranch

    if (wasOnTargetBranch) {
      // Already on target branch - can merge directly
      if (supportsMerge(git)) {
        const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
        if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
          return {
            status: 'error',
            error: `Fast-forward failed: ${mergeResult.error}`
          }
        }
      }
    } else {
      // Not on target branch - checkout, ff, then go back
      const originalHead = await git.resolveRef(repoPath, 'HEAD')

      try {
        await git.checkout(repoPath, localBranch)

        if (supportsMerge(git)) {
          const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
          if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
            // Rollback and return error
            if (currentBranch) {
              await git.checkout(repoPath, currentBranch)
            } else {
              await git.checkout(repoPath, originalHead)
            }
            return {
              status: 'error',
              error: `Fast-forward failed: ${mergeResult.error}`
            }
          }
        }

        // Go back to original branch
        if (currentBranch) {
          await git.checkout(repoPath, currentBranch)
        } else {
          await git.checkout(repoPath, originalHead)
        }
      } catch (error) {
        // Try to rollback on any error
        try {
          if (currentBranch) {
            await git.checkout(repoPath, currentBranch)
          } else {
            await git.checkout(repoPath, originalHead)
          }
        } catch {
          log.error('[pullRemoteBranch] Rollback failed')
        }
        throw error
      }
    }

    return { status: 'success' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(`[pullRemoteBranch] Failed to pull ${remoteRef}:`, error)

    return {
      status: 'error',
      error: `Pull failed: ${message}`
    }
  }
}

/**
 * Fetch and checkout a remote branch in one operation.
 * This is the full workflow for clicking on a remote branch in the UI.
 *
 * @param repoPath - Repository path
 * @param remoteRef - Remote branch ref (e.g., origin/main)
 * @param remote - Remote name (defaults to 'origin')
 * @returns Result of the fetch + checkout
 */
export async function fetchAndCheckout(
  repoPath: string,
  remoteRef: string,
  remote: string = 'origin'
): Promise<RemoteBranchCheckoutResult> {
  const git = getGitAdapter()

  try {
    // First fetch to ensure we have latest remote state
    log.info(`[fetchAndCheckout] Fetching from ${remote}...`)
    await git.fetch(repoPath, remote)

    // Then do smart checkout
    return smartCheckout(repoPath, remoteRef)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // If fetch fails, still try checkout (might work with cached remote refs)
    log.warn(`[fetchAndCheckout] Fetch failed, trying checkout anyway:`, message)

    return smartCheckout(repoPath, remoteRef)
  }
}
