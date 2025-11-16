import type { LocalRepo } from '@shared/types'
import Store from 'electron-store'

interface StoreSchema {
  repos: LocalRepo[]
}

export class ConfigStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'config',
      defaults: {
        repos: []
      }
    })
  }

  getLocalRepos(): LocalRepo[] {
    return this.store.get('repos', [])
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
}

// Export singleton instance
export const configStore = new ConfigStore()
