import { IPC_EVENTS } from '@shared/types'
import { WebContents } from 'electron'
import { FSWatcher, watch } from 'fs'

export class GitWatcher {
  private currentWatcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private static instance: GitWatcher

  static getInstance(): GitWatcher {
    if (!GitWatcher.instance) {
      GitWatcher.instance = new GitWatcher()
    }
    return GitWatcher.instance
  }

  watch(repoPath: string, webContents: WebContents): void {
    this.stop()

    try {
      this.currentWatcher = watch(repoPath, { recursive: true }, () => {
        this.handleFileChange(webContents)
      })
    } catch (error) {
      console.error('Failed to watch repo:', error)
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
  }

  private handleFileChange(webContents: WebContents): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      // Verify webContents is still valid before sending
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.repoChange)
      }
      this.debounceTimer = null
    }, 100)
  }
}
