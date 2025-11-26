import type { LocalRepo } from '@shared/types'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { log } from '@shared/logger'

interface LocalStateContextValue {
  repos: LocalRepo[]
  selectedRepo: LocalRepo | null
  selectRepo: (path: string) => Promise<void>
  addRepo: (path: string) => Promise<void>
  removeRepo: (path: string) => Promise<void>
  isLoading: boolean
}

const LocalStateContext = createContext<LocalStateContextValue | undefined>(undefined)

export function LocalStateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [repos, setRepos] = useState<LocalRepo[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Compute the currently selected repo
  const selectedRepo = repos.find((repo) => repo.isSelected) ?? null

  // Load repos on mount
  useEffect(() => {
    async function loadRepos() {
      try {
        const loadedRepos = await window.api.getLocalRepos()
        setRepos(loadedRepos)
      } catch (error) {
        log.error('Failed to load repos:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadRepos()
  }, [])

  const selectRepo = useCallback(async (path: string) => {
    try {
      const updatedRepos = await window.api.selectLocalRepo({ path })
      setRepos(updatedRepos)
    } catch (error) {
      log.error('Failed to select repo:', error)
    }
  }, [])

  const addRepo = useCallback(async (path: string) => {
    try {
      await window.api.addLocalRepo({ path })
      const updatedRepos = await window.api.selectLocalRepo({ path })
      setRepos(updatedRepos)
    } catch (error) {
      log.error('Failed to add repo:', error)
    }
  }, [])

  const removeRepo = useCallback(async (path: string) => {
    try {
      const updatedRepos = await window.api.removeLocalRepo({ path })
      setRepos(updatedRepos)
    } catch (error) {
      log.error('Failed to remove repo:', error)
    }
  }, [])

  return (
    <LocalStateContext.Provider
      value={{
        repos,
        selectedRepo,
        selectRepo,
        addRepo,
        removeRepo,
        isLoading
      }}
    >
      {children}
    </LocalStateContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLocalStateContext(): LocalStateContextValue {
  const context = useContext(LocalStateContext)
  if (context === undefined) {
    throw new Error('useLocalStateContext must be used within a LocalStateProvider')
  }
  return context
}
