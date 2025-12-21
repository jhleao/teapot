import { log } from '@shared/logger'
import { IPC_EVENTS } from '@shared/types'
import { WebContents } from 'electron'
import { FSWatcher, watch } from 'fs'
import { invalidateRepoCache } from './utils/repo-cache'

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
        invalidateRepoCache(this.currentRepoPath)
      }

      // Verify webContents is still valid before sending
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.repoChange)
      }
      this.debounceTimer = null
    }, 100)
  }
}
