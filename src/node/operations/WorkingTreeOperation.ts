/**
 * WorkingTreeOperation - Orchestrates working tree operations
 *
 * This module handles:
 * - Staging/unstaging files
 * - Discarding changes (both tracked and untracked)
 */

import { log } from '@shared/logger'
import fs from 'fs'
import path from 'path'
import { getGitAdapter } from '../adapters/git'

export class WorkingTreeOperation {
  /**
   * Updates the staging status of files.
   */
  static async updateFileStageStatus(
    repoPath: string,
    files: string[],
    staged: boolean
  ): Promise<void> {
    if (staged) {
      await this.stageFiles(repoPath, files)
    } else {
      await this.unstageFiles(repoPath, files)
    }
  }

  /**
   * Discards all working tree changes.
   */
  static async discardChanges(repoPath: string): Promise<void> {
    if (await this.hasHead(repoPath)) {
      await this.revertTrackedFiles(repoPath)
    }

    try {
      await this.removeUntrackedFiles(repoPath)
    } catch {
      // Ignore errors if status fails
    }
  }

  private static async stageFiles(repoPath: string, files: string[]): Promise<void> {
    const git = getGitAdapter()
    await git.add(repoPath, files)
  }

  private static async unstageFiles(repoPath: string, files: string[]): Promise<void> {
    const git = getGitAdapter()

    if (await this.hasHead(repoPath)) {
      await git.resetIndex(repoPath, files)
    } else {
      await git.remove(repoPath, files)
    }
  }

  private static async hasHead(repoPath: string): Promise<boolean> {
    const git = getGitAdapter()
    try {
      await git.resolveRef(repoPath, 'HEAD')
      return true
    } catch {
      return false
    }
  }

  private static async revertTrackedFiles(repoPath: string): Promise<void> {
    const git = getGitAdapter()
    const currentBranch = await git.currentBranch(repoPath)
    const ref = currentBranch || 'HEAD'
    await git.checkout(repoPath, ref, { force: true })
  }

  private static async removeUntrackedFiles(repoPath: string): Promise<void> {
    const git = getGitAdapter()
    const status = await git.getWorkingTreeStatus(repoPath)
    const filesToRemove = [...status.not_added, ...status.created]

    for (const filepath of filesToRemove) {
      const fullPath = path.join(repoPath, filepath)
      try {
        await fs.promises.rm(fullPath, { force: true, recursive: true })
      } catch (e) {
        log.error(`Failed to remove ${fullPath}:`, e)
      }
    }
  }
}
