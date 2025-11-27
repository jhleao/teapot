import { log } from '@shared/logger'
import type { LocalRepo } from '@shared/types'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

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

  // Helper for consistent error handling
  const safeApiCall = useCallback(
    async <T,>(
      promise: Promise<T>,
      errorMessage: string,
      onSuccess?: (result: T) => void
    ): Promise<void> => {
      try {
        const result = await promise
        if (onSuccess) onSuccess(result)
      } catch (error) {
        log.error(`${errorMessage}:`, error)
        toast.error(errorMessage, {
          description: error instanceof Error ? error.message : String(error)
        })
      }
    },
    []
  )

  // Load repos on mount
  useEffect(() => {
    async function loadRepos() {
      await safeApiCall(
        window.api.getLocalRepos(),
        'Failed to load repositories',
        (loadedRepos) => {
          setRepos(loadedRepos)
        }
      )
      setIsLoading(false)
    }
    loadRepos()
  }, [safeApiCall])

  const selectRepo = useCallback(
    async (path: string) => {
      await safeApiCall(
        window.api.selectLocalRepo({ path }),
        'Failed to select repository',
        setRepos
      )
    },
    [safeApiCall]
  )

  const addRepo = useCallback(
    async (path: string) => {
      await safeApiCall(
        (async () => {
          await window.api.addLocalRepo({ path })
          return window.api.selectLocalRepo({ path })
        })(),
        'Failed to add repository',
        setRepos
      )
    },
    [safeApiCall]
  )

  const removeRepo = useCallback(
    async (path: string) => {
      await safeApiCall(
        window.api.removeLocalRepo({ path }),
        'Failed to remove repository',
        setRepos
      )
    },
    [safeApiCall]
  )

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
