/**
 * BranchOperation - Orchestrates branch-related operations
 *
 * This module handles all branch operations including:
 * - Checkout (simple git checkout - no smart routing or fast-forwarding)
 * - Branch deletion (local only, or local + remote cleanup)
 * - Sync trunk with remote (fast-forward only)
 */

import { log } from '@shared/logger'
import { getDeleteBranchPermission } from '@shared/permissions'
import { findOpenPr } from '@shared/types/git-forge'
import { isTrunkRef, type CheckoutResult } from '@shared/types/repo'
import {
  branchExists,
  canFastForward,
  getGitAdapter,
  resolveTrunkRef,
  supportsMerge,
  type GitAdapter
} from '../adapters/git'
import { ExecutionContextService } from '../services/ExecutionContextService'
import { gitForgeService } from '../services/ForgeService'
import {
  BranchError,
  TrunkProtectionError,
  WorktreeConflictError,
  type TrunkProtectedOperation
} from '../shared/errors'
import { configStore } from '../store'
import { WorktreeOperation } from './WorktreeOperation'
import { isWorktreeDirty, normalizePath, pruneIfStale } from './WorktreeUtils'

/**
 * Options for trunk protection validation.
 */
type TrunkValidationOptions = {
  /** The operation being attempted (for error message) */
  operation: TrunkProtectedOperation
  /** Whether this is a remote ref (will strip remote prefix). Default: false */
  isRemote?: boolean
}

/**
 * Validates that a branch is not a protected trunk branch.
 *
 * This is a fail-fast guard that should be called at the start of any
 * operation that modifies a branch. It ensures we never proceed with
 * operations that would corrupt trunk branch state.
 *
 * Handles both local and remote refs:
 * - Local: "main", "MAIN", "Main" (case-insensitive)
 * - Remote: "origin/main", "upstream/master" (strips prefix, case-insensitive)
 *
 * @param branchRef - The branch reference to validate
 * @param options - Validation options including operation type and isRemote flag
 * @throws TrunkProtectionError if branchRef refers to a trunk branch
 *
 * @example
 * // Local branch validation (most common)
 * assertNotTrunk('main', { operation: 'delete' })
 *
 * // Remote branch validation
 * assertNotTrunk('origin/main', { operation: 'cleanup', isRemote: true })
 */
function assertNotTrunk(branchRef: string, options: TrunkValidationOptions): void {
  const { operation, isRemote = false } = options
  if (isTrunkRef(branchRef, isRemote)) {
    throw new TrunkProtectionError(branchRef, operation)
  }
}

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
   * If the branch is checked out in a worktree, the worktree is removed first.
   * Trunk branches (main, master, develop, trunk) cannot be cleaned up.
   *
   * Uses git as the source of truth for worktree detection - if git reports
   * that a branch is used by a worktree (including during rebase, cherry-pick, etc.),
   * we handle it by removing the worktree and retrying.
   */
  static async cleanup(repoPath: string, branchName: string): Promise<void> {
    assertNotTrunk(branchName, { operation: 'cleanup' })

    const git = getGitAdapter()

    // Check if this is the current branch in the main worktree (fail fast)
    const currentBranch = await git.currentBranch(repoPath)
    if (currentBranch === branchName) {
      throw new Error('Cannot delete the currently checked out branch')
    }

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
      log.info(`[BranchOperation.cleanup] Deleted remote-tracking ref: origin/${branchName}`)
    } catch {
      // Ignore - the remote-tracking ref may not exist
    }

    // Delete local branch with automatic worktree handling
    await this.deleteBranchWithWorktreeHandling(repoPath, branchName, 'cleanup')
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
   * If the branch has an open PR, the PR is closed first.
   * Trunk branches (main, master, develop, trunk) cannot be deleted.
   *
   * Uses git as the source of truth for worktree detection - if git reports
   * that a branch is used by a worktree (including during rebase, cherry-pick, etc.),
   * we handle it by removing the worktree and retrying.
   */
  static async delete(repoPath: string, branchName: string): Promise<void> {
    const git = getGitAdapter()

    // Check permission using shared permission logic (fail fast)
    const isTrunk = isTrunkRef(branchName, false)
    const currentBranch = await git.currentBranch(repoPath)
    const isCurrent = currentBranch === branchName

    const permission = getDeleteBranchPermission({ isTrunk, isCurrent })
    if (!permission.allowed) {
      if (permission.reason === 'is-trunk') {
        throw new TrunkProtectionError(branchName, 'delete')
      }
      throw new BranchError(permission.deniedReason, branchName, 'delete')
    }

    await this.closePullRequestForBranch(repoPath, branchName)

    // Delete remote branch if it exists
    try {
      await gitForgeService.deleteRemoteBranch(repoPath, branchName)
      log.info(`[BranchOperation.delete] Deleted remote branch: ${branchName}`)
    } catch (error) {
      log.warn(
        `[BranchOperation.delete] Failed to delete remote branch (continuing with local): ${branchName}`,
        error
      )
    }

    // Delete remote-tracking reference
    try {
      await git.deleteRemoteTrackingBranch(repoPath, 'origin', branchName)
      log.info(`[BranchOperation.delete] Deleted remote-tracking ref: origin/${branchName}`)
    } catch {
      // Ignore - the remote-tracking ref may not exist
    }

    // Delete local branch with automatic worktree handling
    await this.deleteBranchWithWorktreeHandling(repoPath, branchName, 'delete')
    log.info(`[BranchOperation.delete] Deleted local branch: ${branchName}`)
  }

  /**
   * Renames a local branch.
   * Trunk branches (main, master, develop, trunk) cannot be renamed.
   * Cannot rename a branch TO a trunk name (e.g., renaming "feature" to "main").
   */
  static async rename(
    repoPath: string,
    oldBranchName: string,
    newBranchName: string
  ): Promise<void> {
    // Protect against renaming FROM a trunk branch
    assertNotTrunk(oldBranchName, { operation: 'rename' })
    // Protect against renaming TO a trunk name
    assertNotTrunk(newBranchName, { operation: 'rename' })

    const git = getGitAdapter()
    await git.renameBranch(repoPath, oldBranchName, newBranchName)
  }

  /**
   * Syncs the trunk branch with origin by fetching and fast-forwarding.
   * Detects the trunk branch automatically (main, master, etc.).
   * This is the ONLY operation that does fast-forwarding.
   * Automatically uses a clean worktree if the active worktree is dirty.
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
      // Fetch from origin first (doesn't require clean worktree)
      await git.fetch(repoPath, 'origin')

      // Check if local trunk exists
      const localExists = await branchExists(repoPath, trunkName)

      if (!localExists) {
        // Create local trunk from remote (doesn't require checkout)
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

      // Acquire execution context for checkout/merge operations
      const context = await ExecutionContextService.acquire(repoPath, 'sync-trunk')
      try {
        // Perform fast-forward using the execution path
        const ffResult = await this.fastForwardTrunk(
          context.executionPath,
          trunkName,
          remoteRef,
          git
        )
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
      } finally {
        await ExecutionContextService.release(context)
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
   * Closes the PR associated with a branch if one exists.
   */
  private static async closePullRequestForBranch(
    repoPath: string,
    branchName: string
  ): Promise<void> {
    try {
      const { state: forgeState } = await gitForgeService.getStateWithStatus(repoPath)
      const pr = findOpenPr(branchName, forgeState.pullRequests)
      if (pr) {
        log.info(
          `[BranchOperation.delete] Closing associated PR #${pr.number} for branch ${branchName}`
        )
        await gitForgeService.closePullRequest(repoPath, pr.number)
      }
    } catch (e) {
      log.warn('[BranchOperation.delete] Failed to close PR during branch deletion:', e)
    }
  }

  /**
   * Deletes a local branch, automatically handling the case where the branch
   * is checked out in a worktree.
   *
   * Lets git be the source of truth: attempts deletion first, and if git reports
   * the branch is used by a worktree, removes the worktree and retries.
   *
   * This handles ALL cases where git considers a branch locked:
   * - Normal checkout
   * - Rebase in progress (detached HEAD but branch still locked)
   * - Cherry-pick, bisect, or merge in progress
   */
  private static async deleteBranchWithWorktreeHandling(
    repoPath: string,
    branchName: string,
    operation: 'cleanup' | 'delete'
  ): Promise<void> {
    const git = getGitAdapter()

    try {
      await git.deleteBranch(repoPath, branchName)
    } catch (error) {
      if (error instanceof WorktreeConflictError) {
        log.info(
          `[BranchOperation.${operation}] Branch ${branchName} is used by worktree ${error.worktreePath}, removing worktree first`
        )
        await this.removeBlockingWorktreeAndRetry(
          repoPath,
          branchName,
          error.worktreePath,
          operation
        )
        return
      }
      throw error
    }
  }

  /**
   * Removes a worktree that is blocking branch deletion, then retries the deletion.
   *
   * This method performs validation before removing the worktree:
   * - Checks if the worktree is stale (directory doesn't exist) and just prunes if so
   * - Checks if the worktree has uncommitted changes (prevents accidental data loss)
   * - Updates the active worktree config if the removed worktree was active
   *
   * @param repoPath - Path to the repository
   * @param branchName - Name of the branch to delete
   * @param worktreePath - Path to the blocking worktree (from git's error message)
   * @param operation - The operation context for logging
   */
  private static async removeBlockingWorktreeAndRetry(
    repoPath: string,
    branchName: string,
    worktreePath: string,
    operation: 'cleanup' | 'delete'
  ): Promise<void> {
    const git = getGitAdapter()

    // Check if worktree is stale and prune if needed (handles race conditions gracefully)
    const staleResult = await pruneIfStale(repoPath, worktreePath)
    if (staleResult.wasStale) {
      log.info(
        `[BranchOperation.${operation}] Worktree ${worktreePath} was stale (${staleResult.reason}), pruned`
      )
      // Worktree is gone, retry branch deletion
      await git.deleteBranch(repoPath, branchName)
      return
    }

    // Check if worktree has uncommitted changes (prevent data loss)
    const isDirty = await isWorktreeDirty(worktreePath)
    if (isDirty) {
      throw new Error(
        `Cannot ${operation} branch: worktree at ${worktreePath} has uncommitted changes`
      )
    }

    // Remove the worktree
    const result = await WorktreeOperation.remove(repoPath, worktreePath)
    if (!result.success) {
      throw new Error(`Failed to remove worktree: ${result.error}`)
    }
    log.info(`[BranchOperation.${operation}] Removed worktree ${worktreePath}`)

    // If the removed worktree was the active one, clear the active worktree setting
    await this.clearActiveWorktreeIfRemoved(repoPath, worktreePath)

    // Retry the branch deletion - should succeed now
    await git.deleteBranch(repoPath, branchName)
  }

  /**
   * Clears the active worktree setting if the removed worktree was the active one.
   */
  private static async clearActiveWorktreeIfRemoved(
    repoPath: string,
    removedWorktreePath: string
  ): Promise<void> {
    const activeWorktree = configStore.getActiveWorktree(repoPath)
    if (!activeWorktree) {
      return
    }

    // Use normalizePath for consistent symlink handling (e.g., /var -> /private/var on macOS)
    const [removedReal, activeReal] = await Promise.all([
      normalizePath(removedWorktreePath),
      normalizePath(activeWorktree)
    ])

    if (removedReal === activeReal) {
      configStore.setActiveWorktree(repoPath, null)
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
