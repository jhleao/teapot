/**
 * Smart Checkout Utility
 *
 * Handles intelligent checkout behavior for both local and remote branches:
 * - Local branches: Direct checkout
 * - Remote branches: Fetch, create local tracking branch, fast-forward sync
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
 * 1. If local branch exists and can fast-forward to remote → checkout + ff
 * 2. If local branch exists but diverged → just checkout (user decides)
 * 3. If local branch doesn't exist → create from remote and checkout
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
    return checkoutRemoteBranch(repoPath, ref, parsed.remote, parsed.localBranch)
  }

  // Local branch checkout
  return checkoutLocalBranch(repoPath, ref)
}

/**
 * Checkout a local branch.
 */
async function checkoutLocalBranch(
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
    log.error(`[smartCheckout] Failed to checkout ${branchName}:`, error)

    return {
      success: false,
      error: `Checkout failed: ${message}`
    }
  }
}

/**
 * Checkout a remote branch, optionally creating/updating local tracking branch.
 * Implements all-or-nothing: checks ff-ability BEFORE checkout and rolls back on failure.
 */
async function checkoutRemoteBranch(
  repoPath: string,
  remoteRef: string,
  remote: string,
  localBranch: string
): Promise<RemoteBranchCheckoutResult> {
  const git = getGitAdapter()

  try {
    // 1. Fetch from remote to ensure we have latest state
    try {
      await git.fetch(repoPath, remote)
    } catch (fetchError) {
      const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError)
      return {
        success: false,
        error: `Failed to fetch from ${remote}: ${fetchMessage}`
      }
    }

    // 2. Check if local branch already exists
    const localExists = await branchExists(repoPath, localBranch)

    // 3. If local exists, check ff-ability BEFORE checkout (all-or-nothing)
    if (localExists) {
      const canFF = await canFastForward(repoPath, localBranch, remoteRef)
      if (!canFF) {
        // Cannot fast-forward - abort entirely, don't leave user in partial state
        return {
          success: false,
          error: `Cannot sync: ${localBranch} has local changes or has diverged from ${remoteRef}`
        }
      }
    }

    // 4. Save state for rollback
    const originalBranch = await git.currentBranch(repoPath)
    const originalHead = await git.resolveRef(repoPath, 'HEAD')

    // 5. Now safe to checkout
    if (localExists) {
      await git.checkout(repoPath, localBranch)

      // 6. Fast-forward (should always succeed given our pre-check)
      if (supportsMerge(git)) {
        const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
        if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
          // This shouldn't happen given our pre-check, but rollback
          log.warn(`[smartCheckout] FF failed despite pre-check:`, mergeResult.error)
          await rollbackCheckout(repoPath, originalBranch, originalHead)
          return {
            success: false,
            error: `Fast-forward failed unexpectedly: ${mergeResult.error}`
          }
        }
      }
    } else {
      // Local branch doesn't exist - create it from remote
      await git.branch(repoPath, localBranch, {
        checkout: true,
        startPoint: remoteRef
      })
    }

    return {
      success: true,
      localBranch
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(`[smartCheckout] Failed to checkout remote ${remoteRef}:`, error)

    return {
      success: false,
      error: `Remote checkout failed: ${message}`
    }
  }
}

/**
 * Rollback to original state on failure.
 */
async function rollbackCheckout(
  repoPath: string,
  originalBranch: string | null,
  originalHead: string
): Promise<void> {
  const git = getGitAdapter()

  try {
    if (originalBranch) {
      await git.checkout(repoPath, originalBranch)
    } else {
      // Was in detached HEAD, restore to original commit
      await git.checkout(repoPath, originalHead)
    }
  } catch (rollbackError) {
    log.error('[smartCheckout] Rollback failed:', rollbackError)
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
