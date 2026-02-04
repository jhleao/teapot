/**
 * StackPullOperation - Handles force-pulling multiple branches in a stack
 *
 * This module provides functionality to pull multiple branches sequentially,
 * handling partial failures gracefully and skipping branches that are checked
 * out in dirty worktrees.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

import { log } from '@shared/logger'
import { getGitAdapter } from '../adapters/git'

const execAsync = promisify(exec)

/**
 * Result of pulling a single branch
 */
export type BranchPullResult = {
  branchName: string
  status: 'success' | 'skipped' | 'error'
  message?: string
}

/**
 * Result of pulling an entire stack
 */
export type StackPullResult = {
  status: 'success' | 'partial' | 'error'
  message: string
  branchResults: BranchPullResult[]
  failedBranches: string[]
}

export class StackPullOperation {
  /**
   * Pull multiple branches in a stack sequentially.
   *
   * Strategy:
   * 1. Single upfront `git fetch origin` to update remote refs
   * 2. For each branch, use `git fetch origin {branch}:{branch}` to update local ref
   * 3. Skip branches that are checked out in dirty worktrees
   * 4. Continue on individual branch errors (partial failure handling)
   *
   * @param repoPath - Path to the repository
   * @param branchNames - Array of branch names to pull
   * @returns Result with overall status and per-branch results
   */
  static async pullStack(repoPath: string, branchNames: string[]): Promise<StackPullResult> {
    const git = getGitAdapter()
    const branchResults: BranchPullResult[] = []
    const failedBranches: string[] = []

    if (branchNames.length === 0) {
      return {
        status: 'success',
        message: 'No branches to pull',
        branchResults: [],
        failedBranches: []
      }
    }

    // Step 1: Upfront fetch to update all remote refs
    try {
      log.info(`[StackPullOperation.pullStack] Fetching from origin`)
      await git.fetch(repoPath, 'origin')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[StackPullOperation.pullStack] Failed to fetch from origin:`, error)
      return {
        status: 'error',
        message: `Failed to fetch from origin: ${message}`,
        branchResults: [],
        failedBranches: branchNames
      }
    }

    // Get worktree state to check which branches are checked out in dirty worktrees
    const worktrees = await git.listWorktrees(repoPath)
    const dirtyWorktreeBranches = new Set(
      worktrees.filter((wt) => wt.isDirty && wt.branch).map((wt) => wt.branch!)
    )

    // Step 2: Pull each branch sequentially
    for (const branchName of branchNames) {
      // Skip branches checked out in dirty worktrees
      if (dirtyWorktreeBranches.has(branchName)) {
        log.info(
          `[StackPullOperation.pullStack] Skipping ${branchName}: checked out in dirty worktree`
        )
        branchResults.push({
          branchName,
          status: 'skipped',
          message: 'Branch is checked out in a worktree with uncommitted changes'
        })
        continue
      }

      const result = await this.pullBranch(repoPath, branchName)
      branchResults.push(result)

      if (result.status === 'error') {
        failedBranches.push(branchName)
      }
    }

    // Determine overall status
    const successCount = branchResults.filter((r) => r.status === 'success').length
    const skippedCount = branchResults.filter((r) => r.status === 'skipped').length
    const errorCount = failedBranches.length

    let status: StackPullResult['status']
    let message: string

    if (errorCount === 0) {
      // No errors - either all succeeded, all skipped, or mix of success/skip
      status = 'success'
      if (successCount === 0) {
        // All branches were skipped (no remote or already up to date)
        const reasons = branchResults.map((r) => r.message).filter(Boolean)
        const allUpToDate = reasons.every((r) => r === 'Already up to date')
        const allNoRemote = reasons.every((r) => r === 'No remote branch')
        if (allUpToDate) {
          message = 'All branches are already up to date'
        } else if (allNoRemote) {
          message = 'No branches have remotes to pull from'
        } else {
          message = 'No branches needed pulling'
        }
      } else {
        message = `Pulled ${successCount} branch${successCount !== 1 ? 'es' : ''}`
      }
    } else if (successCount === 0 && skippedCount === 0) {
      // All branches failed
      status = 'error'
      message = `Failed to pull ${errorCount} branch${errorCount !== 1 ? 'es' : ''}`
    } else {
      // Mix of success/skip and errors
      status = 'partial'
      const parts: string[] = []
      if (successCount > 0) {
        parts.push(`${successCount} pulled`)
      }
      if (errorCount > 0) {
        parts.push(`${errorCount} failed`)
      }
      message = parts.join(', ')
    }

    log.info(`[StackPullOperation.pullStack] Completed: ${message}`)

    return {
      status,
      message,
      branchResults,
      failedBranches
    }
  }

  /**
   * Check if a branch has a corresponding remote tracking branch
   */
  private static async hasRemoteBranch(repoPath: string, branchName: string): Promise<boolean> {
    try {
      await execAsync(`git -C "${repoPath}" rev-parse --verify "refs/remotes/origin/${branchName}"`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if a branch is already up to date with its remote
   */
  private static async isUpToDate(repoPath: string, branchName: string): Promise<boolean> {
    try {
      const { stdout: localSha } = await execAsync(
        `git -C "${repoPath}" rev-parse "refs/heads/${branchName}"`
      )
      const { stdout: remoteSha } = await execAsync(
        `git -C "${repoPath}" rev-parse "refs/remotes/origin/${branchName}"`
      )
      return localSha.trim() === remoteSha.trim()
    } catch {
      return false
    }
  }

  /**
   * Pull a single branch using git fetch origin {branch}:{branch}
   *
   * This updates the local branch ref to match the remote without requiring checkout.
   * It will fail if the local branch has diverged from remote (non-fast-forward).
   */
  private static async pullBranch(repoPath: string, branchName: string): Promise<BranchPullResult> {
    // Check if remote branch exists first
    const hasRemote = await this.hasRemoteBranch(repoPath, branchName)
    if (!hasRemote) {
      log.info(`[StackPullOperation.pullBranch] Skipping ${branchName}: no remote branch`)
      return {
        branchName,
        status: 'skipped',
        message: 'No remote branch'
      }
    }

    // Check if already up to date
    const upToDate = await this.isUpToDate(repoPath, branchName)
    if (upToDate) {
      log.info(`[StackPullOperation.pullBranch] Skipping ${branchName}: already up to date`)
      return {
        branchName,
        status: 'skipped',
        message: 'Already up to date'
      }
    }

    try {
      // Prune stale worktrees first - git refuses to fetch into a branch that
      // it thinks is checked out, even if that worktree is stale
      await execAsync(`git -C "${repoPath}" worktree prune`)

      // Use git fetch origin branch:branch to update local ref
      await execAsync(`git -C "${repoPath}" fetch origin ${branchName}:${branchName}`)

      log.info(`[StackPullOperation.pullBranch] Successfully pulled ${branchName}`)
      return {
        branchName,
        status: 'success'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[StackPullOperation.pullBranch] Failed to pull ${branchName}:`, error)

      // Provide more user-friendly error messages for common cases
      if (message.includes('non-fast-forward')) {
        return {
          branchName,
          status: 'error',
          message: 'Local branch has diverged from remote'
        }
      }

      if (message.includes('Cannot update')) {
        return {
          branchName,
          status: 'error',
          message: 'Branch is currently checked out'
        }
      }

      return {
        branchName,
        status: 'error',
        message
      }
    }
  }
}
