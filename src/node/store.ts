import type { LocalRepo, RebaseIntent, RebaseState } from '@shared/types'
import Store from 'electron-store'

// Rebase session type - defined here to avoid circular imports with SessionService
export type StoredRebaseSession = {
  intent: RebaseIntent
  state: RebaseState
  version: number
  createdAtMs: number
  updatedAtMs: number
  originalBranch: string
}

interface StoreSchema {
  repos: LocalRepo[]
  githubPat?: string
  rebaseSessions: Record<string, StoredRebaseSession>
}

export class ConfigStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'config',
      defaults: {
        repos: [],
        rebaseSessions: {}
      }
    })
  }

  getLocalRepos(): LocalRepo[] {
    return this.store.get('repos', [])
  }

  getGithubPat(): string | undefined {
    return this.store.get('githubPat')
  }

  setGithubPat(token: string): void {
    this.store.set('githubPat', token)
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
      { path, isSelected: true }
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
}

// Export singleton instance
export const configStore = new ConfigStore()
