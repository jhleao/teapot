/**
 * GitWatcherService - File system watcher for Git repository changes
 *
 * This service watches a repository directory for file changes and
 * notifies the UI to refresh when changes occur.
 *
 * Filtering:
 * - All .git/ internal changes are ignored to prevent feedback loops
 *   (our own git commands write to .git/, which would re-trigger the watcher)
 * - Gitignored paths (node_modules, build output, etc.) are filtered using
 *   the repo's .gitignore and .git/info/exclude
 * - External git state changes (terminal commits, checkouts) are detected
 *   via the window focus listener in the renderer
 *
 * Design: One watcher instance per window. The watcher is tightly coupled
 * to a WebContents lifecycle - when the WebContents is destroyed, the
 * watcher automatically cleans up.
 */

import { log } from '@shared/logger'
import { IPC_EVENTS } from '@shared/types'
import { WebContents } from 'electron'
import { FSWatcher, watch } from 'fs'
import { readFile } from 'fs/promises'
import ignore, { type Ignore } from 'ignore'
import { join } from 'path'
import * as CacheService from './CacheService'

export class GitWatcher {
  private currentWatcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private currentRepoPath: string | null = null
  private currentWebContents: WebContents | null = null
  private boundOnDestroyed: (() => void) | null = null
  private paused = false
  private pendingChange = false
  private ignoreFilter: Ignore | null = null
  private static instance: GitWatcher

  static getInstance(): GitWatcher {
    if (!GitWatcher.instance) {
      GitWatcher.instance = new GitWatcher()
    }
    return GitWatcher.instance
  }

  /**
   * Pause the watcher so file change events are suppressed.
   * Use this during multi-step operations (like rebase queues) to avoid
   * showing intermediate states in the UI.
   */
  pause(): void {
    this.paused = true
    this.pendingChange = false
  }

  /**
   * Resume the watcher. If any file changes occurred while paused,
   * immediately fires a single change notification.
   */
  resume(): void {
    this.paused = false
    if (this.pendingChange) {
      this.pendingChange = false
      if (this.currentRepoPath) {
        CacheService.invalidateRepoCache(this.currentRepoPath)
      }
      this.sendSafe(IPC_EVENTS.repoChange)
    }
  }

  async watch(repoPath: string, webContents: WebContents): Promise<void> {
    this.stop()
    this.currentRepoPath = repoPath
    this.currentWebContents = webContents

    // Bind the handler so we can remove it later
    this.boundOnDestroyed = () => {
      log.info('[GitWatcher] WebContents destroyed, stopping watcher')
      this.stop()
    }
    webContents.once('destroyed', this.boundOnDestroyed)

    this.ignoreFilter = await this.buildIgnoreFilter(repoPath)

    try {
      this.currentWatcher = watch(repoPath, { recursive: true }, (_event, filename) => {
        if (this.shouldIgnore(filename)) return
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
    this.ignoreFilter = null
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

  private shouldIgnore(filename: string | null): boolean {
    if (!filename) return false

    // Ignore all .git/ internal changes. This breaks the feedback loop where
    // our git commands write to .git/ and re-trigger the watcher.
    // External git operations (from terminal) are picked up via the
    // window focus listener in the renderer.
    if (filename === '.git' || filename.startsWith('.git/') || filename.startsWith('.git\\')) {
      return true
    }

    if (this.ignoreFilter?.ignores(filename)) {
      return true
    }

    return false
  }

  private async buildIgnoreFilter(repoPath: string): Promise<Ignore> {
    const ig = ignore()

    const files = [join(repoPath, '.gitignore'), join(repoPath, '.git', 'info', 'exclude')]

    await Promise.all(
      files.map(async (filePath) => {
        try {
          const content = await readFile(filePath, 'utf-8')
          ig.add(content)
        } catch {
          // File doesn't exist, that's fine
        }
      })
    )

    return ig
  }

  private handleFileChange(): void {
    if (this.paused) {
      this.pendingChange = true
      return
    }

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
