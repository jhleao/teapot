import type {
  DetachedWorktree,
  FileLogLevel,
  LocalRepo,
  RebaseIntent,
  RebaseState
} from '@shared/types'
import type { GitForgeState, MergeStrategy } from '@shared/types/git-forge'
import Store from 'electron-store'

// Rebase session type - defined here to avoid circular imports with SessionService
export type StoredRebaseSession = {
  intent: RebaseIntent
  state: RebaseState
  version: number
  createdAtMs: number
  updatedAtMs: number
  originalBranch: string
  autoDetachedWorktrees?: DetachedWorktree[]
}

/**
 * Cached forge state for instant UI on app startup.
 */
export type CachedForgeState = {
  state: GitForgeState
  timestamp: number
}

interface StoreSchema {
  repos: LocalRepo[]
  githubPat?: string
  preferredEditor?: string
  mergeStrategy?: MergeStrategy
  lastClonePath?: string
  fileLogLevel?: FileLogLevel
  // Legacy field - migrated to fileLogLevel on first read
  debugLoggingEnabled?: boolean
  rebaseSessions: Record<string, StoredRebaseSession>
  forgeStateCache: Record<string, CachedForgeState>
}

export class ConfigStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'config',
      defaults: {
        repos: [],
        rebaseSessions: {},
        forgeStateCache: {}
      }
    })
  }

  getLocalRepos(): LocalRepo[] {
    const repos = this.store.get('repos', [])
    // Normalize old repos that may not have activeWorktreePath
    return repos.map((repo) => ({
      ...repo,
      activeWorktreePath: repo.activeWorktreePath ?? null
    }))
  }

  getGithubPat(): string | undefined {
    return this.store.get('githubPat')
  }

  setGithubPat(token: string): void {
    this.store.set('githubPat', token)
  }

  getPreferredEditor(): string | undefined {
    return this.store.get('preferredEditor')
  }

  setPreferredEditor(editor: string): void {
    this.store.set('preferredEditor', editor)
  }

  getMergeStrategy(): MergeStrategy {
    return this.store.get('mergeStrategy', 'rebase')
  }

  setMergeStrategy(strategy: MergeStrategy): void {
    this.store.set('mergeStrategy', strategy)
  }

  getLastClonePath(): string | undefined {
    return this.store.get('lastClonePath')
  }

  setLastClonePath(path: string): void {
    this.store.set('lastClonePath', path)
  }

  // File logging methods

  getFileLogLevel(): FileLogLevel {
    // Check for new setting first
    const level = this.store.get('fileLogLevel')
    if (level !== undefined) {
      return level
    }

    // Migrate from legacy debugLoggingEnabled
    const legacyEnabled = this.store.get('debugLoggingEnabled')
    if (legacyEnabled === true) {
      // Migrate: old "enabled" -> new "verbose" (same behavior as before, minus trace)
      this.store.set('fileLogLevel', 'verbose')
      this.store.delete('debugLoggingEnabled')
      return 'verbose'
    }

    // Default: off
    return 'off'
  }

  setFileLogLevel(level: FileLogLevel): void {
    this.store.set('fileLogLevel', level)
    // Clean up legacy field if it exists
    if (this.store.get('debugLoggingEnabled') !== undefined) {
      this.store.delete('debugLoggingEnabled')
    }
  }

  /**
   * Get the path of the currently selected repo.
   * Returns null if no repo is selected.
   */
  getSelectedRepoPath(): string | null {
    const repos = this.getLocalRepos()
    const selected = repos.find((r) => r.isSelected)
    return selected?.path ?? null
  }

  private setRepos(repos: LocalRepo[]): void {
    this.store.set('repos', repos)
  }

  addLocalRepo(path: string): LocalRepo[] {
    const repos = this.getLocalRepos()
    // Check if repo already exists
    const existingRepo = repos.find((repo) => repo.path === path)
    if (existingRepo) {
      // If repo exists, select it
      return this.selectLocalRepo(path)
    }
    // Add new repo and select it (deselecting all others)
    const newRepos = [
      ...repos.map((repo) => ({ ...repo, isSelected: false })),
      { path, isSelected: true, activeWorktreePath: null }
    ]
    this.setRepos(newRepos)
    return newRepos
  }

  selectLocalRepo(path: string): LocalRepo[] {
    const repos = this.getLocalRepos()
    const updatedRepos = repos.map((repo) => ({
      ...repo,
      isSelected: repo.path === path
    }))
    this.setRepos(updatedRepos)
    return updatedRepos
  }

  removeLocalRepo(path: string): LocalRepo[] {
    const repos = this.getLocalRepos()
    const filteredRepos = repos.filter((repo) => repo.path !== path)
    this.setRepos(filteredRepos)
    return filteredRepos
  }

  // Active worktree methods

  /**
   * Get the active worktree path for a repo.
   * Returns null if using the main worktree (default).
   */
  getActiveWorktree(repoPath: string): string | null {
    const repos = this.getLocalRepos()
    const repo = repos.find((r) => r.path === repoPath)
    return repo?.activeWorktreePath ?? null
  }

  /**
   * Set the active worktree for a repo.
   * Pass null to switch back to main worktree.
   */
  setActiveWorktree(repoPath: string, worktreePath: string | null): void {
    const repos = this.getLocalRepos()
    const updatedRepos = repos.map((repo) => {
      if (repo.path !== repoPath) return repo
      // Set to null if switching to main worktree (same as repo path)
      const effectivePath = worktreePath === repoPath ? null : worktreePath
      return { ...repo, activeWorktreePath: effectivePath }
    })
    this.setRepos(updatedRepos)
  }

  // Rebase session persistence methods
  getRebaseSession(repoPath: string): StoredRebaseSession | null {
    const sessions = this.store.get('rebaseSessions', {})
    return sessions[repoPath] ?? null
  }

  setRebaseSession(repoPath: string, session: StoredRebaseSession): void {
    const sessions = this.store.get('rebaseSessions', {})
    sessions[repoPath] = session
    this.store.set('rebaseSessions', sessions)
  }

  deleteRebaseSession(repoPath: string): void {
    const sessions = this.store.get('rebaseSessions', {})
    delete sessions[repoPath]
    this.store.set('rebaseSessions', sessions)
  }

  hasRebaseSession(repoPath: string): boolean {
    const sessions = this.store.get('rebaseSessions', {})
    return repoPath in sessions
  }

  // Forge state cache methods

  /**
   * Get cached forge state for a repository.
   * Returns null if no cache or if cache is too old (> 1 hour).
   */
  getCachedForgeState(repoPath: string): CachedForgeState | null {
    const cache = this.store.get('forgeStateCache', {})
    const cached = cache[repoPath]
    if (!cached) return null

    // Expire cache after 1 hour
    const ONE_HOUR_MS = 60 * 60 * 1000
    if (Date.now() - cached.timestamp > ONE_HOUR_MS) {
      return null
    }

    return cached
  }

  /**
   * Set cached forge state for a repository.
   */
  setCachedForgeState(repoPath: string, state: GitForgeState): void {
    const cache = this.store.get('forgeStateCache', {})
    cache[repoPath] = {
      state,
      timestamp: Date.now()
    }
    this.store.set('forgeStateCache', cache)
  }

  /**
   * Clear cached forge state for a repository.
   */
  clearCachedForgeState(repoPath: string): void {
    const cache = this.store.get('forgeStateCache', {})
    delete cache[repoPath]
    this.store.set('forgeStateCache', cache)
  }
}

// Export singleton instance
export const configStore = new ConfigStore()
