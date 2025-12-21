/**
 * GitWatcherService - File system watcher for Git repository changes
 *
 * This service watches a repository directory for file changes and
 * notifies the UI to refresh when changes occur.
 */

import { log } from '@shared/logger'
import { IPC_EVENTS } from '@shared/types'
import { WebContents } from 'electron'
import { FSWatcher, watch } from 'fs'
import * as CacheService from './CacheService'

export class GitWatcher {
  private currentWatcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private currentRepoPath: string | null = null
  private static instance: GitWatcher

  static getInstance(): GitWatcher {
    if (!GitWatcher.instance) {
      GitWatcher.instance = new GitWatcher()
    }
    return GitWatcher.instance
  }

  watch(repoPath: string, webContents: WebContents): void {
    this.stop()
    this.currentRepoPath = repoPath

    try {
      this.currentWatcher = watch(repoPath, { recursive: true }, () => {
        this.handleFileChange(webContents)
      })
    } catch (error) {
      log.error('Failed to watch repo:', error)
      if (!webContents.isDestroyed()) {
        // Extract message if it's an Error object, otherwise assume it's a string or send a generic message
        const message = error instanceof Error ? error.message : String(error)
        webContents.send(IPC_EVENTS.repoError, message)
      }
    }
  }

  stop(): void {
    if (this.currentWatcher) {
      this.currentWatcher.close()
      this.currentWatcher = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.currentRepoPath = null
  }

  private handleFileChange(webContents: WebContents): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      // Invalidate cached data when git state changes
      if (this.currentRepoPath) {
        CacheService.invalidateRepoCache(this.currentRepoPath)
      }

      // Verify webContents is still valid before sending
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.repoChange)
      }
      this.debounceTimer = null
    }, 100)
  }
}
