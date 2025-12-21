/**
 * BranchOperation - Orchestrates branch-related operations
 *
 * This module handles all branch operations including:
 * - Checkout (handles both local and remote branches)
 * - Branch deletion (local only, or local + remote cleanup)
 * - Fast-forward sync with remote
 */

import { log } from '@shared/logger'
import type { RemoteBranchCheckoutResult } from '@shared/types/repo'
import {
  branchExists,
  canFastForward,
  getGitAdapter,
  resolveTrunkRef,
  supportsMerge,
  type GitAdapter
} from '../adapters/git'
import { BranchUtils } from '../domain'
import { gitForgeService } from '../services/ForgeService'

export type PullRemoteBranchResult = {
  status: 'success' | 'conflict' | 'error'
  error?: string
}

export type SyncTrunkResult = {
  status: 'success' | 'conflict' | 'error'
  message: string
  trunkName?: string
}

export class BranchOperation {
  /**
   * Smart checkout that handles both local and remote branches.
   */
  static async smartCheckout(repoPath: string, ref: string): Promise<RemoteBranchCheckoutResult> {
    const parsed = BranchUtils.parseRemoteBranch(ref)

    if (parsed) {
      const pullResult = await this.pullRemoteBranch(
        repoPath,
        ref,
        parsed.remote,
        parsed.localBranch
      )

      if (pullResult.status !== 'success') {
        return {
          success: false,
          error: pullResult.error ?? `Pull failed with status: ${pullResult.status}`
        }
      }

      return this.checkoutLocal(repoPath, parsed.localBranch)
    }

    return this.checkoutLocal(repoPath, ref)
  }

  /**
   * Checkout a local branch.
   */
  static async checkoutLocal(
    repoPath: string,
    branchName: string
  ): Promise<RemoteBranchCheckoutResult> {
    const git = getGitAdapter()

    try {
      const exists = await this.verifyBranchExists(repoPath, branchName, git)
      if (!exists) {
        return { success: false, error: `Branch '${branchName}' not found` }
      }

      await git.checkout(repoPath, branchName)
      return { success: true, localBranch: branchName }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[BranchOperation.checkoutLocal] Failed to checkout ${branchName}:`, error)
      return { success: false, error: `Checkout failed: ${message}` }
    }
  }

  /**
   * Pull a remote branch by fast-forwarding or creating the corresponding local branch.
   */
  static async pullRemoteBranch(
    repoPath: string,
    remoteRef: string,
    remote: string,
    localBranch: string
  ): Promise<PullRemoteBranchResult> {
    const git = getGitAdapter()

    try {
      const fetchError = await this.fetchFromRemote(repoPath, remote, git)
      if (fetchError) {
        return { status: 'error', error: `Failed to fetch from ${remote}: ${fetchError}` }
      }

      const localExists = await branchExists(repoPath, localBranch)

      if (!localExists) {
        await this.createBranchFromRemote(repoPath, localBranch, remoteRef, git)
        return { status: 'success' }
      }

      const canFF = await canFastForward(repoPath, localBranch, remoteRef)
      if (!canFF) {
        return {
          status: 'conflict',
          error: `Cannot sync: ${localBranch} has diverged from ${remoteRef}`
        }
      }

      const ffResult = await this.fastForwardBranch(repoPath, localBranch, remoteRef, git)
      if (!ffResult.success) {
        return { status: 'error', error: `Fast-forward failed: ${ffResult.error}` }
      }

      return { status: 'success' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[BranchOperation.pullRemoteBranch] Failed to pull ${remoteRef}:`, error)
      return { status: 'error', error: `Pull failed: ${message}` }
    }
  }

  /**
   * Fetch and checkout a remote branch in one operation.
   */
  static async fetchAndCheckout(
    repoPath: string,
    remoteRef: string,
    remote: string = 'origin'
  ): Promise<RemoteBranchCheckoutResult> {
    const git = getGitAdapter()

    try {
      log.info(`[BranchOperation.fetchAndCheckout] Fetching from ${remote}...`)
      await git.fetch(repoPath, remote)
      return this.smartCheckout(repoPath, remoteRef)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[BranchOperation.fetchAndCheckout] Fetch failed, trying checkout anyway:`, message)
      return this.smartCheckout(repoPath, remoteRef)
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
   * Syncs the trunk branch with origin by fast-forwarding.
   * Detects the trunk branch automatically (main, master, etc.).
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

    // Use pullRemoteBranch to sync trunk with origin
    const remoteRef = `origin/${trunkName}`
    const result = await this.pullRemoteBranch(repoPath, remoteRef, 'origin', trunkName)

    if (result.status === 'success') {
      return {
        status: 'success',
        message: `Synced ${trunkName} with origin`,
        trunkName
      }
    }

    if (result.status === 'conflict') {
      return {
        status: 'conflict',
        message: result.error ?? `${trunkName} has diverged from origin`,
        trunkName
      }
    }

    return {
      status: 'error',
      message: result.error ?? 'Sync failed',
      trunkName
    }
  }

  private static async verifyBranchExists(
    repoPath: string,
    branchName: string,
    git: GitAdapter
  ): Promise<boolean> {
    const exists = await branchExists(repoPath, branchName)
    if (exists) return true

    try {
      await git.resolveRef(repoPath, branchName)
      return true
    } catch {
      return false
    }
  }

  private static async fetchFromRemote(
    repoPath: string,
    remote: string,
    git: GitAdapter
  ): Promise<string | null> {
    try {
      await git.fetch(repoPath, remote)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  private static async createBranchFromRemote(
    repoPath: string,
    localBranch: string,
    remoteRef: string,
    git: GitAdapter
  ): Promise<void> {
    await git.branch(repoPath, localBranch, {
      checkout: false,
      startPoint: remoteRef
    })
  }

  private static async fastForwardBranch(
    repoPath: string,
    localBranch: string,
    remoteRef: string,
    git: GitAdapter
  ): Promise<{ success: boolean; error?: string }> {
    const currentBranch = await git.currentBranch(repoPath)
    const wasOnTargetBranch = currentBranch === localBranch

    if (wasOnTargetBranch) {
      return this.fastForwardCurrentBranch(repoPath, remoteRef, git)
    }

    return this.fastForwardOtherBranch(repoPath, localBranch, remoteRef, currentBranch, git)
  }

  private static async fastForwardCurrentBranch(
    repoPath: string,
    remoteRef: string,
    git: GitAdapter
  ): Promise<{ success: boolean; error?: string }> {
    if (!supportsMerge(git)) {
      return { success: true }
    }

    const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
    if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
      return { success: false, error: mergeResult.error }
    }

    return { success: true }
  }

  private static async fastForwardOtherBranch(
    repoPath: string,
    localBranch: string,
    remoteRef: string,
    currentBranch: string | null,
    git: GitAdapter
  ): Promise<{ success: boolean; error?: string }> {
    const originalHead = await git.resolveRef(repoPath, 'HEAD')

    try {
      await git.checkout(repoPath, localBranch)

      if (supportsMerge(git)) {
        const mergeResult = await git.merge(repoPath, remoteRef, { ffOnly: true })
        if (!mergeResult.success && !mergeResult.alreadyUpToDate) {
          await this.restoreOriginalBranch(repoPath, currentBranch, originalHead, git)
          return { success: false, error: mergeResult.error }
        }
      }

      await this.restoreOriginalBranch(repoPath, currentBranch, originalHead, git)
      return { success: true }
    } catch (error) {
      await this.restoreOriginalBranch(repoPath, currentBranch, originalHead, git)
      throw error
    }
  }

  private static async restoreOriginalBranch(
    repoPath: string,
    currentBranch: string | null,
    originalHead: string,
    git: GitAdapter
  ): Promise<void> {
    try {
      if (currentBranch) {
        await git.checkout(repoPath, currentBranch)
      } else {
        await git.checkout(repoPath, originalHead)
      }
    } catch {
      log.error('[BranchOperation] Failed to restore original branch')
    }
  }
}
