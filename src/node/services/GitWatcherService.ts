/**
 * GitWatcherService - File system watcher for Git repository changes
 *
 * This service watches a repository directory for file changes and
 * notifies the UI to refresh when changes occur.
 *
 * Design: One watcher instance per window. The watcher is tightly coupled
 * to a WebContents lifecycle - when the WebContents is destroyed, the
 * watcher automatically cleans up.
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
  private currentWebContents: WebContents | null = null
  private boundOnDestroyed: (() => void) | null = null
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
    this.currentWebContents = webContents

    // Bind the handler so we can remove it later
    this.boundOnDestroyed = () => {
      log.info('[GitWatcher] WebContents destroyed, stopping watcher')
      this.stop()
    }
    webContents.once('destroyed', this.boundOnDestroyed)

    try {
      this.currentWatcher = watch(repoPath, { recursive: true }, () => {
        this.handleFileChange()
      })
    } catch (error) {
      log.error('[GitWatcher] Failed to watch repo:', error)
      this.sendSafe(IPC_EVENTS.repoError, error instanceof Error ? error.message : String(error))
    }
  }

  stop(): void {
    // Remove the destroyed listener if we're stopping manually
    // (prevents dangling listener if stop() called before webContents destroyed)
    if (this.currentWebContents && this.boundOnDestroyed) {
      this.currentWebContents.removeListener('destroyed', this.boundOnDestroyed)
    }

    if (this.currentWatcher) {
      this.currentWatcher.close()
      this.currentWatcher = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.currentRepoPath = null
    this.currentWebContents = null
    this.boundOnDestroyed = null
  }

  /**
   * Safely sends an IPC message to the renderer.
   * Returns true if sent successfully, false if renderer unavailable.
   */
  private sendSafe(channel: string, ...args: unknown[]): boolean {
    const webContents = this.currentWebContents
    if (!webContents || webContents.isDestroyed()) {
      return false
    }

    try {
      webContents.send(channel, ...args)
      return true
    } catch (error) {
      // Render frame can be disposed while webContents object still exists
      // (e.g., after long sleep/suspend). This is a known Electron race condition.
      log.warn('[GitWatcher] Failed to send to renderer, stopping watcher:', error)
      this.stop()
      return false
    }
  }

  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null

      // Invalidate cached data when git state changes
      if (this.currentRepoPath) {
        CacheService.invalidateRepoCache(this.currentRepoPath)
      }

      this.sendSafe(IPC_EVENTS.repoChange)
    }, 100)
  }
}
