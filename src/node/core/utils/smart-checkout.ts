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
 */
async function checkoutRemoteBranch(
  repoPath: string,
  remoteRef: string,
  _remote: string, // Reserved for future fetch operations
  localBranch: string
): Promise<RemoteBranchCheckoutResult> {
  const git = getGitAdapter()

  try {
    // Check if local branch already exists
    const localExists = await branchExists(repoPath, localBranch)

    if (localExists) {
      // Local branch exists - check if we can fast-forward
      const canFF = await canFastForward(repoPath, localBranch, remoteRef)

      if (canFF) {
        // First checkout the local branch
        await git.checkout(repoPath, localBranch)

        // Then fast-forward if we have merge support
        if (supportsMerge(git)) {
          const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })

          if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
            log.warn(`[smartCheckout] Fast-forward failed, but checkout succeeded:`, mergeResult.error)
          }
        }

        return {
          success: true,
          localBranch
        }
      } else {
        // Cannot fast-forward (diverged or local is ahead)
        // Just checkout the local branch, let user handle sync
        await git.checkout(repoPath, localBranch)

        return {
          success: true,
          localBranch
        }
      }
    } else {
      // Local branch doesn't exist - create it from remote
      await git.branch(repoPath, localBranch, {
        checkout: true,
        startPoint: remoteRef
      })

      return {
        success: true,
        localBranch
      }
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
