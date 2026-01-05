/**
 * CloneOperation - Orchestrates repository cloning
 *
 * Handles cloning a repository from a URL to a local path,
 * extracting the repo name and adding it to the config store.
 */

import { log } from '@shared/logger'
import fs from 'fs'
import path from 'path'
import { getGitAdapter, supportsClone } from '../adapters/git'
import { configStore } from '../store'
import { extractRepoName } from '../utils/git-url'

export type CloneResult = {
  success: boolean
  error?: string
  repoPath?: string
}

export class CloneOperation {
  /**
   * Clones a repository from the given URL into a subfolder of targetPath.
   * The subfolder name is extracted from the URL.
   */
  static async clone(url: string, targetPath: string): Promise<CloneResult> {
    // Validate inputs
    if (!url.trim()) {
      return { success: false, error: 'Repository URL is required' }
    }

    if (!targetPath.trim()) {
      return { success: false, error: 'Target path is required' }
    }

    // Extract repo name from URL
    const repoName = extractRepoName(url)
    if (!repoName) {
      return { success: false, error: 'Could not extract repository name from URL' }
    }

    const repoPath = path.join(targetPath.trim(), repoName)

    // Check if target already exists
    try {
      await fs.promises.access(repoPath)
      return {
        success: false,
        error: `Directory "${repoName}" already exists in the target folder`
      }
    } catch {
      // Path doesn't exist, which is what we want
    }

    // Perform clone
    try {
      const git = getGitAdapter()
      if (!supportsClone(git)) {
        return { success: false, error: 'Git adapter does not support clone operation' }
      }

      await git.clone(url, repoPath)
      configStore.addLocalRepo(repoPath)

      log.info(`[CloneOperation] Cloned ${url} to ${repoPath}`)
      return { success: true, repoPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[CloneOperation] Failed to clone ${url}:`, error)
      return { success: false, error: message }
    }
  }
}
