/**
 * BranchOperation - Orchestrates branch-related operations
 *
 * This module handles all branch operations including:
 * - Checkout (simple git checkout - no smart routing or fast-forwarding)
 * - Branch deletion (local only, or local + remote cleanup)
 * - Sync trunk with remote (fast-forward only)
 */

import { log } from '@shared/logger'
import type { CheckoutResult } from '@shared/types/repo'
import {
  branchExists,
  canFastForward,
  getGitAdapter,
  resolveTrunkRef,
  supportsMerge,
  type GitAdapter
} from '../adapters/git'
import { gitForgeService } from '../services/ForgeService'

export type SyncTrunkResult = {
  status: 'success' | 'conflict' | 'error'
  message: string
  trunkName?: string
}

export class BranchOperation {
  /**
   * Simple checkout - just checks out the given ref directly.
   * Does not do any smart routing, fetching, or fast-forwarding.
   */
  static async checkout(repoPath: string, ref: string): Promise<CheckoutResult> {
    const git = getGitAdapter()

    try {
      await git.checkout(repoPath, ref)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[BranchOperation.checkout] Failed to checkout ${ref}:`, error)
      return { success: false, error: `Checkout failed: ${message}` }
    }
  }

  /**
   * Cleans up a merged branch by deleting it both locally and on the remote.
   */
  static async cleanup(repoPath: string, branchName: string): Promise<void> {
    const git = getGitAdapter()

    const currentBranch = await git.currentBranch(repoPath)
    if (currentBranch === branchName) {
      throw new Error('Cannot delete the currently checked out branch')
    }

    try {
      await gitForgeService.deleteRemoteBranch(repoPath, branchName)
      log.info(`Deleted remote branch: ${branchName}`)
    } catch (error) {
      log.warn(`Failed to delete remote branch (continuing with local): ${branchName}`, error)
    }

    await git.deleteBranch(repoPath, branchName)
    log.info(`Deleted local branch: ${branchName}`)
  }

  /**
   * Deletes a local branch.
   */
  static async delete(repoPath: string, branchName: string): Promise<void> {
    const git = getGitAdapter()
    await git.deleteBranch(repoPath, branchName)
  }

  /**
   * Syncs the trunk branch with origin by fetching and fast-forwarding.
   * Detects the trunk branch automatically (main, master, etc.).
   * This is the ONLY operation that does fast-forwarding.
   */
  static async syncTrunk(repoPath: string): Promise<SyncTrunkResult> {
    const git = getGitAdapter()

    // Get the list of branches to find trunk
    const branches = await git.listBranches(repoPath)
    const trunkName = await resolveTrunkRef(repoPath, branches)

    if (!trunkName) {
      return {
        status: 'error',
        message: 'Could not determine trunk branch'
      }
    }

    const remoteRef = `origin/${trunkName}`

    try {
      // Fetch from origin first
      await git.fetch(repoPath, 'origin')

      // Check if local trunk exists
      const localExists = await branchExists(repoPath, trunkName)

      if (!localExists) {
        // Create local trunk from remote
        await git.branch(repoPath, trunkName, {
          checkout: false,
          startPoint: remoteRef
        })
        return {
          status: 'success',
          message: `Created ${trunkName} from origin`,
          trunkName
        }
      }

      // Check if we can fast-forward
      const canFF = await canFastForward(repoPath, trunkName, remoteRef)
      if (!canFF) {
        return {
          status: 'conflict',
          message: `${trunkName} has diverged from origin`,
          trunkName
        }
      }

      // Perform fast-forward
      const ffResult = await this.fastForwardTrunk(repoPath, trunkName, remoteRef, git)
      if (!ffResult.success) {
        return {
          status: 'error',
          message: ffResult.error ?? 'Fast-forward failed',
          trunkName
        }
      }

      return {
        status: 'success',
        message: `Synced ${trunkName} with origin`,
        trunkName
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[BranchOperation.syncTrunk] Failed to sync trunk:`, error)
      return {
        status: 'error',
        message: `Sync failed: ${message}`,
        trunkName
      }
    }
  }

  /**
   * Fast-forwards the trunk branch to match the remote ref.
   * Handles both the case where we're on trunk and where we're on another branch.
   */
  private static async fastForwardTrunk(
    repoPath: string,
    trunkName: string,
    remoteRef: string,
    git: GitAdapter
  ): Promise<{ success: boolean; error?: string }> {
    const currentBranch = await git.currentBranch(repoPath)
    const isOnTrunk = currentBranch === trunkName

    if (isOnTrunk) {
      // Simple case: we're on trunk, just merge --ff-only
      if (!supportsMerge(git)) {
        return { success: true }
      }
      const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
      if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
        return { success: false, error: mergeResult.error }
      }
      return { success: true }
    }

    // We're on a different branch - need to checkout trunk, FF, then return
    const originalHead = await git.resolveRef(repoPath, 'HEAD')

    try {
      await git.checkout(repoPath, trunkName)

      if (supportsMerge(git)) {
        const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
        if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
          await this.restoreBranch(repoPath, currentBranch, originalHead, git)
          return { success: false, error: mergeResult.error }
        }
      }

      await this.restoreBranch(repoPath, currentBranch, originalHead, git)
      return { success: true }
    } catch (error) {
      await this.restoreBranch(repoPath, currentBranch, originalHead, git)
      throw error
    }
  }

  private static async restoreBranch(
    repoPath: string,
    branchName: string | null,
    fallbackRef: string,
    git: GitAdapter
  ): Promise<void> {
    try {
      await git.checkout(repoPath, branchName ?? fallbackRef)
    } catch {
      log.error('[BranchOperation] Failed to restore original branch')
    }
  }
}
