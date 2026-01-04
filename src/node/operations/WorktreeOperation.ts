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
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

import { log } from '@shared/logger'

import { getGitAdapter } from '../adapters/git'
import { BranchUtils } from '../domain/BranchUtils'
import { configStore } from '../store'
import { ExternalApps } from '../utils/ExternalApps'

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
   * Delete a worktree.
   * Use force=true to delete even if the worktree has uncommitted changes.
   */
  static async remove(
    repoPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<WorktreeOperationResult> {
    try {
      // Resolve symlinks to match git's canonical path (e.g., /var -> /private/var on macOS)
      let resolvedPath = worktreePath
      try {
        resolvedPath = await fs.promises.realpath(worktreePath)
      } catch {
        // Path doesn't exist, use original path
      }

      // Cannot remove the main worktree
      const git = getGitAdapter()
      const worktrees = await git.listWorktrees(repoPath)
      const targetWorktree = worktrees.find((wt) => wt.path === resolvedPath)

      if (!targetWorktree) {
        return { success: false, error: 'Worktree not found' }
      }

      if (targetWorktree.isMain) {
        return { success: false, error: 'Cannot remove the main worktree' }
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
   * The worktree is created in <temp>/teapot/worktrees/<random-name>
   */
  static async create(
    repoPath: string,
    branch: string
  ): Promise<WorktreeOperationResult & { worktreePath?: string }> {
    try {
      // Generate a random directory name
      const dirName = BranchUtils.generateRandomBranchName('wt')
      const baseDir = path.join(os.tmpdir(), 'teapot', 'worktrees')
      const worktreePath = path.join(baseDir, dirName)

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
}
