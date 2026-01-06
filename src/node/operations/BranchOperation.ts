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
import fs from 'fs'
import {
  branchExists,
  canFastForward,
  getGitAdapter,
  resolveTrunkRef,
  supportsMerge,
  type GitAdapter
} from '../adapters/git'
import { gitForgeService } from '../services/ForgeService'
import { configStore } from '../store'
import { WorktreeOperation } from './WorktreeOperation'

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
   * Removes a worktree if the branch is checked out in one.
   * Returns the worktree path if one was removed, or null if none existed.
   */
  private static async removeWorktreeForBranch(
    repoPath: string,
    branchName: string,
    operation: 'cleanup' | 'delete'
  ): Promise<string | null> {
    const git = getGitAdapter()

    const currentBranch = await git.currentBranch(repoPath)
    if (currentBranch === branchName) {
      throw new Error('Cannot delete the currently checked out branch')
    }

    const worktrees = await git.listWorktrees(repoPath)
    const worktreeUsingBranch = worktrees.find((wt) => wt.branch === branchName && !wt.isMain)

    if (!worktreeUsingBranch) {
      return null
    }

    if (worktreeUsingBranch.isDirty) {
      throw new Error(
        `Cannot ${operation} branch: worktree at ${worktreeUsingBranch.path} has uncommitted changes`
      )
    }

    log.info(
      `[BranchOperation.${operation}] Branch ${branchName} is used by worktree ${worktreeUsingBranch.path}, removing worktree first`
    )
    const result = await WorktreeOperation.remove(repoPath, worktreeUsingBranch.path)
    if (!result.success) {
      throw new Error(`Failed to remove worktree: ${result.error}`)
    }

    // If the removed worktree was the active one, fall back to main worktree
    const activeWorktree = configStore.getActiveWorktree(repoPath)
    if (activeWorktree) {
      try {
        const [removedReal, activeReal] = await Promise.all([
          fs.promises.realpath(worktreeUsingBranch.path).catch(() => worktreeUsingBranch.path),
          fs.promises.realpath(activeWorktree).catch(() => activeWorktree)
        ])
        if (removedReal === activeReal) {
          configStore.setActiveWorktree(repoPath, null)
        }
      } catch {
        // Best-effort realpath check; ignore resolution errors
      }
    }

    return worktreeUsingBranch.path
  }

  /**
   * Cleans up a merged branch by deleting it both locally and on the remote.
   * If the branch is checked out in a worktree, the worktree is removed first.
   */
  static async cleanup(repoPath: string, branchName: string): Promise<void> {
    const git = getGitAdapter()

    await this.removeWorktreeForBranch(repoPath, branchName, 'cleanup')

    try {
      await gitForgeService.deleteRemoteBranch(repoPath, branchName)
      log.info(`[BranchOperation.cleanup] Deleted remote branch: ${branchName}`)
    } catch (error) {
      log.warn(
        `[BranchOperation.cleanup] Failed to delete remote branch (continuing with local): ${branchName}`,
        error
      )
    }

    // Always delete the local remote-tracking reference to prevent the branch from reappearing.
    // This is done regardless of whether the remote deletion succeeded because:
    // 1. If the branch still exists on remote, `git fetch` will recreate the tracking ref
    // 2. If the branch was already deleted (e.g., GitHub auto-delete after merge), this cleans up the stale ref
    // 3. Network errors shouldn't prevent local cleanup of a merged branch
    try {
      await git.deleteRemoteTrackingBranch(repoPath, 'origin', branchName)
      log.info(
        `[BranchOperation.cleanup] Deleted remote-tracking ref: origin/${branchName}`
      )
    } catch {
      // Ignore - the remote-tracking ref may not exist
    }

    await git.deleteBranch(repoPath, branchName)
    log.info(`[BranchOperation.cleanup] Deleted local branch: ${branchName}`)
  }

  /**
   * Creates a new branch at the specified commit.
   * If branchName is not provided, generates one from the commit SHA.
   */
  static async create(repoPath: string, commitSha: string, branchName?: string): Promise<void> {
    const git = getGitAdapter()
    const name = branchName || `branch-${commitSha.slice(0, 7)}`
    await git.branch(repoPath, name, { startPoint: commitSha, checkout: false })
  }

  /**
   * Deletes a local branch.
   * If the branch is checked out in a worktree, the worktree is removed first.
   */
  static async delete(repoPath: string, branchName: string): Promise<void> {
    const git = getGitAdapter()

    await this.removeWorktreeForBranch(repoPath, branchName, 'delete')

    await git.deleteBranch(repoPath, branchName)
    log.info(`[BranchOperation.delete] Deleted local branch: ${branchName}`)
  }

  /**
   * Renames a local branch.
   */
  static async rename(
    repoPath: string,
    oldBranchName: string,
    newBranchName: string
  ): Promise<void> {
    const git = getGitAdapter()
    await git.renameBranch(repoPath, oldBranchName, newBranchName)
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
