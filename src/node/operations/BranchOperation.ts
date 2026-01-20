/**
 * BranchOperation - Orchestrates branch-related operations
 *
 * This module handles all branch operations including:
 * - Checkout (simple git checkout - no smart routing or fast-forwarding)
 * - Branch deletion (local only, or local + remote cleanup)
 * - Sync trunk with remote (fast-forward only)
 */

import { exec } from 'child_process'
import { promisify } from 'util'

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
import { gitForgeService } from '../services/ForgeService'
import { BranchError, TrunkProtectionError, type TrunkProtectedOperation } from '../shared/errors'
import { configStore } from '../store'
import { WorktreeOperation } from './WorktreeOperation'
import { normalizePath, pruneIfStale } from './WorktreeUtils'

const execAsync = promisify(exec)

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

/**
 * Represents where trunk is checked out across all worktrees.
 * Used to determine the optimal sync strategy.
 */
type TrunkWorktreeState =
  | { status: 'not_checked_out' }
  | { status: 'checked_out_clean'; worktreePath: string; isActiveWorktree: boolean }
  | { status: 'checked_out_dirty'; worktreePath: string; isActiveWorktree: boolean }

/**
 * The strategy to use for syncing trunk with origin.
 */
type SyncStrategy =
  | { type: 'direct_ref_update' }
  | { type: 'merge_in_worktree'; worktreePath: string }
  | { type: 'blocked'; reason: string }

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
   */
  static async cleanup(repoPath: string, branchName: string): Promise<void> {
    assertNotTrunk(branchName, { operation: 'cleanup' })

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
      log.info(`[BranchOperation.cleanup] Deleted remote-tracking ref: origin/${branchName}`)
    } catch (error) {
      // Expected if the remote-tracking ref doesn't exist
      log.debug(
        `[BranchOperation.cleanup] Remote-tracking ref cleanup skipped: origin/${branchName}`,
        {
          message: error instanceof Error ? error.message : String(error)
        }
      )
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
   * If the branch has an open PR, the PR is closed first.
   * Trunk branches (main, master, develop, trunk) cannot be deleted.
   */
  static async delete(repoPath: string, branchName: string): Promise<void> {
    const git = getGitAdapter()

    // Check permission using shared permission logic
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

    await this.removeWorktreeForBranch(repoPath, branchName, 'delete')

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
    } catch (error) {
      // Expected if the remote-tracking ref doesn't exist
      log.debug(
        `[BranchOperation.delete] Remote-tracking ref cleanup skipped: origin/${branchName}`,
        {
          message: error instanceof Error ? error.message : String(error)
        }
      )
    }

    await git.deleteBranch(repoPath, branchName)
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
   *
   * Strategy-based approach (never creates temporary worktrees):
   * - If trunk is NOT checked out anywhere: uses `git fetch origin main:main` (direct ref update)
   * - If trunk IS checked out in a clean worktree: uses `git merge --ff-only` in that worktree
   * - If trunk IS checked out in a dirty worktree: blocks with a helpful error message
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

      // Verify remote ref exists after fetch
      const remoteRefSha = await git.resolveRef(repoPath, remoteRef)
      if (!remoteRefSha) {
        return {
          status: 'error',
          message: `Remote branch ${remoteRef} not found`,
          trunkName
        }
      }

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

      // Check if we can fast-forward (early exit if diverged)
      const canFF = await canFastForward(repoPath, trunkName, remoteRef)
      if (!canFF) {
        return {
          status: 'conflict',
          message: `${trunkName} has diverged from origin`,
          trunkName
        }
      }

      // Analyze worktree state to determine sync strategy
      const trunkState = await this.analyzeTrunkWorktreeState(repoPath, trunkName)
      const strategy = this.chooseSyncStrategy(trunkState)

      log.debug(`[BranchOperation.syncTrunk] Strategy: ${strategy.type}`, {
        trunkState,
        strategy
      })

      // Execute the chosen strategy
      switch (strategy.type) {
        case 'blocked':
          return {
            status: 'error',
            message: `Cannot sync ${trunkName}: ${strategy.reason}`,
            trunkName
          }

        case 'direct_ref_update': {
          const result = await this.directRefUpdate(repoPath, trunkName)
          if (!result.success) {
            return {
              status: 'error',
              message: result.error ?? 'Direct ref update failed',
              trunkName
            }
          }
          return {
            status: 'success',
            message: `Synced ${trunkName} with origin`,
            trunkName
          }
        }

        case 'merge_in_worktree': {
          const result = await this.mergeInWorktree(strategy.worktreePath, remoteRef, git)
          if (!result.success) {
            return {
              status: 'error',
              message: result.error ?? 'Fast-forward failed',
              trunkName
            }
          }
          return {
            status: 'success',
            message: `Synced ${trunkName} with origin`,
            trunkName
          }
        }
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
   * Removes a worktree if the branch is checked out in one.
   * Returns the worktree path if one was removed, or null if none existed.
   *
   * This is a private method called from protected operations (cleanup, delete).
   * It includes its own trunk protection as defense-in-depth.
   *
   * Handles stale worktrees by pruning git's worktree registry when the
   * worktree directory no longer exists on disk.
   */
  private static async removeWorktreeForBranch(
    repoPath: string,
    branchName: string,
    operation: 'cleanup' | 'delete'
  ): Promise<string | null> {
    // Defense-in-depth: protect even though callers should already validate
    assertNotTrunk(branchName, { operation })

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

    // Check if worktree is stale and prune if needed (handles race conditions gracefully)
    const staleResult = await pruneIfStale(repoPath, worktreeUsingBranch.path)
    if (staleResult.wasStale) {
      log.info(
        `[BranchOperation.${operation}] Worktree ${worktreeUsingBranch.path} was stale (${staleResult.reason}), pruned`
      )
      return worktreeUsingBranch.path
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
      // Use normalizePath for consistent symlink handling (e.g., /var -> /private/var on macOS)
      const [removedReal, activeReal] = await Promise.all([
        normalizePath(worktreeUsingBranch.path),
        normalizePath(activeWorktree)
      ])
      if (removedReal === activeReal) {
        configStore.setActiveWorktree(repoPath, null)
      }
    }

    return worktreeUsingBranch.path
  }

  /**
   * Analyze all worktrees to find where trunk is checked out.
   * Skips stale worktrees (those whose directories no longer exist).
   */
  private static async analyzeTrunkWorktreeState(
    repoPath: string,
    trunkName: string
  ): Promise<TrunkWorktreeState> {
    const git = getGitAdapter()
    const worktrees = await git.listWorktrees(repoPath)
    const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath

    // Find the worktree that has trunk checked out (skip stale worktrees)
    const trunkWorktree = worktrees.find((wt) => wt.branch === trunkName && !wt.isStale)

    if (!trunkWorktree) {
      return { status: 'not_checked_out' }
    }

    // Normalize paths for comparison (handles symlinks like /var -> /private/var)
    const [trunkWorktreeNormalized, activeWorktreeNormalized] = await Promise.all([
      normalizePath(trunkWorktree.path),
      normalizePath(activeWorktreePath)
    ])
    const isActiveWorktree = trunkWorktreeNormalized === activeWorktreeNormalized

    if (trunkWorktree.isDirty) {
      return {
        status: 'checked_out_dirty',
        worktreePath: trunkWorktree.path,
        isActiveWorktree
      }
    }

    return {
      status: 'checked_out_clean',
      worktreePath: trunkWorktree.path,
      isActiveWorktree
    }
  }

  /**
   * Determine the optimal strategy for syncing trunk based on worktree state.
   */
  private static chooseSyncStrategy(trunkState: TrunkWorktreeState): SyncStrategy {
    switch (trunkState.status) {
      case 'not_checked_out':
        return { type: 'direct_ref_update' }
      case 'checked_out_clean':
        return { type: 'merge_in_worktree', worktreePath: trunkState.worktreePath }
      case 'checked_out_dirty':
        return {
          type: 'blocked',
          reason: trunkState.isActiveWorktree
            ? 'uncommitted changes in working tree. Commit, stash, or discard changes first.'
            : `uncommitted changes in worktree at ${trunkState.worktreePath}`
        }
    }
  }

  /**
   * Update trunk ref directly without checkout (only works when trunk is not checked out).
   * Uses `git fetch origin main:main` which atomically updates the local ref.
   */
  private static async directRefUpdate(
    repoPath: string,
    trunkName: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Prune stale worktrees first - git refuses to fetch into a branch that
      // it thinks is checked out, even if that worktree is stale
      await execAsync(`git -C "${repoPath}" worktree prune`)

      await execAsync(`git -C "${repoPath}" fetch origin ${trunkName}:${trunkName}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message.includes('non-fast-forward')) {
        return {
          success: false,
          error: 'Cannot fast-forward: local branch has diverged from origin'
        }
      }

      return { success: false, error: message }
    }
  }

  /**
   * Merge remote ref into trunk in the specified worktree.
   * Uses --ff-only to ensure we only do fast-forward merges.
   */
  private static async mergeInWorktree(
    worktreePath: string,
    remoteRef: string,
    git: GitAdapter
  ): Promise<{ success: boolean; error?: string }> {
    if (!supportsMerge(git)) {
      // If merge isn't supported, assume success (shouldn't happen in practice)
      return { success: true }
    }

    const mergeResult = await git.merge(worktreePath, remoteRef, { ffOnly: true })
    if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
      return { success: false, error: mergeResult.error }
    }

    return { success: true }
  }
}
