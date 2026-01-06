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
import { extractRepoName, isValidGitUrl, parseGitCloneError } from '../domain'
import { configStore } from '../store'

export type CloneResult = {
  success: boolean
  error?: string
  repoPath?: string
}

export type CheckFolderResult = {
  exists: boolean
  suggestion?: string
}

export type CheckTargetPathResult = {
  valid: boolean
  error?: string
}

export class CloneOperation {
  /**
   * Checks if a target path exists and is writable.
   */
  static async checkTargetPath(targetPath: string): Promise<CheckTargetPathResult> {
    const trimmed = targetPath.trim()

    if (!trimmed) {
      return { valid: false, error: 'Target path is required' }
    }

    try {
      const stat = await fs.promises.stat(trimmed)
      if (!stat.isDirectory()) {
        return { valid: false, error: 'Path is not a directory' }
      }
    } catch {
      return { valid: false, error: 'Directory does not exist' }
    }

    // Check if writable by attempting to access with write permission
    try {
      await fs.promises.access(trimmed, fs.constants.W_OK)
    } catch {
      return { valid: false, error: 'Directory is not writable' }
    }

    return { valid: true }
  }

  /**
   * Checks if a folder name exists in the target path and suggests an alternative if it does.
   */
  static async checkFolderName(targetPath: string, folderName: string): Promise<CheckFolderResult> {
    const fullPath = path.join(targetPath.trim(), folderName.trim())

    try {
      await fs.promises.access(fullPath)
      // Folder exists, find a suggestion
      const suggestion = await this.findAvailableName(targetPath, folderName)
      return { exists: true, suggestion }
    } catch {
      // Folder doesn't exist
      return { exists: false }
    }
  }

  /**
   * Clones a repository from the given URL into a subfolder of targetPath.
   * The subfolder name is extracted from the URL or can be provided explicitly.
   */
  static async clone(url: string, targetPath: string, folderName?: string): Promise<CloneResult> {
    // Validate inputs
    if (!url.trim()) {
      return { success: false, error: 'Repository URL is required' }
    }

    if (!targetPath.trim()) {
      return { success: false, error: 'Target path is required' }
    }

    // Validate URL format
    if (!isValidGitUrl(url)) {
      return { success: false, error: 'Invalid Git URL format' }
    }

    // Use provided folder name or extract from URL
    const repoName = folderName?.trim() || extractRepoName(url)
    if (!repoName) {
      return { success: false, error: 'Could not determine repository folder name' }
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
      const rawMessage = error instanceof Error ? error.message : String(error)
      const { userMessage } = parseGitCloneError(rawMessage, url)
      log.error(`[CloneOperation] Failed to clone ${url}:`, error)
      return { success: false, error: userMessage }
    }
  }

  /**
   * Finds an available folder name by appending a number suffix.
   */
  private static async findAvailableName(targetPath: string, baseName: string): Promise<string> {
    let counter = 2
    let candidate = `${baseName}-${counter}`

    while (counter < 100) {
      const fullPath = path.join(targetPath.trim(), candidate)
      try {
        await fs.promises.access(fullPath)
        // Path exists, try next number
        counter++
        candidate = `${baseName}-${counter}`
      } catch {
        // Path doesn't exist, we found our candidate
        return candidate
      }
    }

    // Fallback (shouldn't happen in practice)
    return `${baseName}-${Date.now()}`
  }
}
