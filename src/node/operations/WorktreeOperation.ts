/**
 * WorktreeOperation - Orchestrates git worktree operations
 *
 * This module handles worktree-specific operations including:
 * - Checkout a branch in a worktree
 * - Delete a worktree
 * - Discard all changes in a worktree
 * - Open worktree in external applications
 */

import { exec } from 'child_process'
import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

import { log } from '@shared/logger'

import { getGitAdapter, resolveTrunkRef } from '../adapters/git'
import { BranchUtils } from '../domain/BranchUtils'
import { configStore } from '../store'
import { ExternalApps } from '../utils/ExternalApps'
import { normalizePath, pruneStaleWorktrees } from './WorktreeUtils'

const execAsync = promisify(exec)

export type WorktreeOperationResult = {
  success: boolean
  error?: string
}

export class WorktreeOperation {
  /**
   * Checkout a different branch in a worktree.
   * The worktree must be clean (no uncommitted changes).
   */
  static async checkoutBranch(
    worktreePath: string,
    branch: string
  ): Promise<WorktreeOperationResult> {
    try {
      // Check if worktree is dirty first
      const isDirty = await this.isWorktreeDirty(worktreePath)
      if (isDirty) {
        return {
          success: false,
          error: 'Worktree has uncommitted changes. Commit or discard them first.'
        }
      }

      // Use git -C to checkout in the worktree directory
      await execAsync(`git -C "${worktreePath}" checkout "${branch}"`)

      log.info(`[WorktreeOperation] Checked out ${branch} in worktree ${worktreePath}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.checkoutBranch] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Checkout a branch inside a worktree without validating cleanliness.
   * Used for restoring worktrees after automated operations.
   */
  static async checkoutBranchInWorktree(
    worktreePath: string,
    branch: string
  ): Promise<WorktreeOperationResult> {
    try {
      await execAsync(`git -C "${worktreePath}" checkout "${branch}"`)
      log.info(
        `[WorktreeOperation] Checked out ${branch} in worktree ${worktreePath} (no validation)`
      )
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.checkoutBranchInWorktree] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Detach HEAD in a worktree to release the branch reference.
   */
  static async detachHead(worktreePath: string): Promise<WorktreeOperationResult> {
    try {
      await execAsync(`git -C "${worktreePath}" checkout --detach HEAD`)
      log.info(`[WorktreeOperation] Detached HEAD in worktree ${worktreePath}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.detachHead] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Stash all changes in a worktree before detaching.
   */
  static async stash(worktreePath: string): Promise<WorktreeOperationResult> {
    try {
      await execAsync(`git -C "${worktreePath}" stash push -u -m "Teapot auto-stash before rebase"`)
      log.info(`[WorktreeOperation] Stashed changes in worktree ${worktreePath}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.stash] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Delete a worktree.
   * Use force=true to delete even if the worktree has uncommitted changes.
   *
   * Handles stale worktrees by pruning git's registry when the worktree
   * directory no longer exists on disk.
   */
  static async remove(
    repoPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<WorktreeOperationResult> {
    try {
      // Normalize the path to handle symlinks (e.g., /var -> /private/var on macOS)
      // This uses the centralized normalizePath utility which handles non-existent paths
      // We also check if path exists atomically with normalization to avoid race conditions
      let resolvedPath: string
      let pathExists: boolean

      try {
        // If realpath succeeds, path exists and we get the normalized path
        resolvedPath = await fs.promises.realpath(worktreePath)
        pathExists = true
      } catch {
        // Path doesn't exist - use normalizePath to resolve parent symlinks
        resolvedPath = await normalizePath(worktreePath)
        pathExists = false
      }

      // Cannot remove the main worktree
      const git = getGitAdapter()
      const worktrees = await git.listWorktrees(repoPath)

      // Try to find the worktree by resolved path first, then by original path
      let targetWorktree = worktrees.find((wt) => wt.path === resolvedPath)
      if (!targetWorktree && resolvedPath !== worktreePath) {
        targetWorktree = worktrees.find((wt) => wt.path === worktreePath)
      }

      if (!targetWorktree) {
        return { success: false, error: 'Worktree not found' }
      }

      if (targetWorktree.isMain) {
        return { success: false, error: 'Cannot remove the main worktree' }
      }

      // If the worktree directory doesn't exist, it's stale - just prune it
      // Use pruneStaleWorktrees which handles race conditions gracefully
      if (!pathExists || targetWorktree.isStale) {
        log.info(
          `[WorktreeOperation] Worktree ${worktreePath} is stale (directory doesn't exist), pruning`
        )
        await pruneStaleWorktrees(repoPath)
        return { success: true }
      }

      const forceFlag = force ? ' --force' : ''
      await execAsync(`git -C "${repoPath}" worktree remove "${worktreePath}"${forceFlag}`)

      log.info(`[WorktreeOperation] Removed worktree ${worktreePath}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.remove] Failed:`, error)

      // Provide helpful error messages
      if (message.includes('contains modified or untracked files')) {
        return {
          success: false,
          error: 'Worktree has uncommitted changes. Use force delete or discard changes first.'
        }
      }

      return { success: false, error: message }
    }
  }

  /**
   * Discard all changes in a worktree.
   * This resets tracked files and removes untracked files.
   * WARNING: This is destructive and cannot be undone.
   */
  static async discardAllChanges(worktreePath: string): Promise<WorktreeOperationResult> {
    try {
      // Reset tracked files to HEAD
      await execAsync(`git -C "${worktreePath}" checkout -- .`)

      // Remove untracked files and directories
      await execAsync(`git -C "${worktreePath}" clean -fd`)

      log.info(`[WorktreeOperation] Discarded all changes in ${worktreePath}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.discardAllChanges] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Create a new worktree for a branch.
   * The worktree is created in <temp>/teapot/worktrees/wt-<branch-name>
   * If the directory already exists (e.g., from a deleted worktree), a suffix is added.
   */
  static async create(
    repoPath: string,
    branch: string
  ): Promise<WorktreeOperationResult & { worktreePath?: string }> {
    try {
      // Use branch name for the directory, sanitized for filesystem, with wt- prefix
      const sanitizedBranch = branch.replace(/[^a-zA-Z0-9_-]/g, '-')
      const baseDir = path.join(os.tmpdir(), 'teapot', 'worktrees')
      let dirName = `wt-${sanitizedBranch}`
      let worktreePath = path.join(baseDir, dirName)

      // Handle case where directory already exists (add numeric suffix)
      let suffix = 1
      while (await this.directoryExists(worktreePath)) {
        dirName = `wt-${sanitizedBranch}-${suffix}`
        worktreePath = path.join(baseDir, dirName)
        suffix++
      }

      // Ensure the parent directory exists (cross-platform)
      await fs.promises.mkdir(baseDir, { recursive: true })

      await execAsync(`git -C "${repoPath}" worktree add "${worktreePath}" "${branch}"`)

      // Resolve symlinks to get the canonical path (e.g., /var -> /private/var on macOS)
      // This ensures the path matches what git reports in `worktree list`
      const resolvedPath = await fs.promises.realpath(worktreePath)

      log.info(`[WorktreeOperation] Created worktree ${resolvedPath} for branch ${branch}`)
      return { success: true, worktreePath: resolvedPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.create] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Create a new branch, optionally with a worktree.
   * This is the enhanced branch creation flow that:
   * 1. Creates a new branch from the source branch
   * 2. Optionally creates a worktree for that branch
   * 3. Optionally creates a "working commit" (empty WIP commit)
   */
  static async createWithNewBranch(
    repoPath: string,
    sourceBranch: string,
    options: {
      newBranchName?: string
      createWorktree?: boolean
      createWorkingCommit: boolean
    }
  ): Promise<{
    success: boolean
    error?: string
    worktreePath?: string
    branchName?: string
  }> {
    const branchName = options.newBranchName?.trim() || BranchUtils.generateRandomBranchName('')
    const shouldCreateWorktree = options.createWorktree !== false // Default to true

    // Step 1: Create the new branch from source
    try {
      await execAsync(`git -C "${repoPath}" branch "${branchName}" "${sourceBranch}"`)
      log.info(`[WorktreeOperation] Created branch ${branchName} from ${sourceBranch}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.createWithNewBranch] Failed to create branch:`, error)
      return { success: false, error: `Failed to create branch: ${message}` }
    }

    // If not creating worktree, we're done
    if (!shouldCreateWorktree) {
      return {
        success: true,
        branchName
      }
    }

    // Step 2: Create the worktree for the new branch
    const worktreeResult = await this.create(repoPath, branchName)
    if (!worktreeResult.success) {
      // Rollback: delete the branch we just created
      await this.rollbackBranchCreation(repoPath, branchName)
      return { success: false, error: worktreeResult.error }
    }

    const worktreePath = worktreeResult.worktreePath!

    // Step 3: Create working commit if requested
    if (options.createWorkingCommit) {
      const commitResult = await this.createWorkingCommit(worktreePath, sourceBranch)
      if (!commitResult.success) {
        // Non-fatal: log warning but continue
        log.warn(`[WorktreeOperation] Failed to create working commit: ${commitResult.error}`)
      }
    }

    return {
      success: true,
      worktreePath,
      branchName
    }
  }

  /**
   * Open a worktree directory in the system file manager.
   */
  static async openInFinder(worktreePath: string): Promise<WorktreeOperationResult> {
    return ExternalApps.openInFileManager(worktreePath)
  }

  /**
   * Open a worktree in the user's configured editor.
   */
  static async openInEditor(worktreePath: string): Promise<WorktreeOperationResult> {
    const editor = configStore.getPreferredEditor()
    return ExternalApps.openInEditor(worktreePath, editor)
  }

  /**
   * Open a worktree in Terminal.
   */
  static async openInTerminal(worktreePath: string): Promise<WorktreeOperationResult> {
    return ExternalApps.openInTerminal(worktreePath)
  }

  /**
   * Copy a path to the clipboard.
   */
  static copyPath(worktreePath: string): WorktreeOperationResult {
    return ExternalApps.copyToClipboard(worktreePath)
  }

  /**
   * Create a temporary worktree for execution-only operations.
   * Always uses detached HEAD at trunk (main/master) for isolation.
   *
   * @param repoPath - Path to the git repository
   * @param baseDir - Optional base directory for the worktree (defaults to /tmp/teapot/exec)
   */
  static async createTemporary(
    repoPath: string,
    baseDir?: string
  ): Promise<WorktreeOperationResult & { worktreePath?: string }> {
    try {
      const git = getGitAdapter()

      // Find trunk branch to use as base (consistent with resolveTrunkRef used elsewhere)
      const branches = await git.listBranches(repoPath)
      const trunkName = await resolveTrunkRef(repoPath, branches)
      const refToCheckout = trunkName ?? 'HEAD'

      // Generate unique directory name using crypto
      const uniqueId = randomBytes(8).toString('hex')
      const dirName = `teapot-exec-${uniqueId}`
      const effectiveBaseDir = baseDir ?? path.join(os.tmpdir(), 'teapot', 'exec')
      const worktreePath = path.join(effectiveBaseDir, dirName)

      // Ensure the parent directory exists
      await fs.promises.mkdir(effectiveBaseDir, { recursive: true })

      // Create worktree with detached HEAD for isolation
      await execAsync(
        `git -C "${repoPath}" worktree add --detach "${worktreePath}" "${refToCheckout}"`
      )

      // Resolve symlinks to get the canonical path (e.g., /var -> /private/var on macOS)
      const resolvedPath = await fs.promises.realpath(worktreePath)

      log.info(`[WorktreeOperation] Created temporary worktree ${resolvedPath} at ${refToCheckout}`)
      return { success: true, worktreePath: resolvedPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.createTemporary] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Check if a worktree has uncommitted changes.
   */
  private static async isWorktreeDirty(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`git -C "${worktreePath}" status --porcelain`)
      return stdout.trim().length > 0
    } catch {
      return false
    }
  }

  /**
   * Check if a directory exists.
   */
  private static async directoryExists(dirPath: string): Promise<boolean> {
    try {
      await fs.promises.access(dirPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Create an empty "WIP" commit to act as a working commit.
   */
  private static async createWorkingCommit(
    worktreePath: string,
    sourceBranch: string
  ): Promise<WorktreeOperationResult> {
    try {
      const message = `WIP: Work started from ${sourceBranch}`
      await execAsync(`git -C "${worktreePath}" commit --allow-empty -m "${message}"`)
      log.info(`[WorktreeOperation] Created working commit in ${worktreePath}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[WorktreeOperation.createWorkingCommit] Failed:`, error)
      return { success: false, error: message }
    }
  }

  /**
   * Rollback branch creation if worktree creation fails.
   */
  private static async rollbackBranchCreation(repoPath: string, branchName: string): Promise<void> {
    try {
      await execAsync(`git -C "${repoPath}" branch -D "${branchName}"`)
      log.info(`[WorktreeOperation] Rolled back branch creation: ${branchName}`)
    } catch (error) {
      log.warn(`[WorktreeOperation] Failed to rollback branch ${branchName}:`, error)
    }
  }
}
