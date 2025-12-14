import { log } from '@shared/logger'
import type { ForgeStateResult, ForgeStatus, GitForgeState } from '@shared/types/git-forge'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

interface ForgeStateContextValue {
  /** Current forge state (PR data). May be stale if status is 'error'. */
  forgeState: GitForgeState | null
  /** Current status of the forge fetch operation */
  forgeStatus: ForgeStatus
  /** Error message if status is 'error' */
  forgeError: string | null
  /** Timestamp of last successful fetch */
  lastSuccessfulFetch: number | null
  /** Manually trigger a refresh of forge state */
  refreshForge: () => Promise<void>
}

const ForgeStateContext = createContext<ForgeStateContextValue | undefined>(undefined)

interface ForgeStateProviderProps {
  children: ReactNode
  repoPath: string | null
}

/**
 * Provides forge state (GitHub PR data) separately from local git state.
 *
 * Key behaviors:
 * - Fetches on mount and when repoPath changes
 * - Refreshes on window focus
 * - Tracks loading/error states for UI feedback
 * - Preserves stale data on error for graceful degradation
 */
export function ForgeStateProvider({
  children,
  repoPath
}: ForgeStateProviderProps): React.JSX.Element {
  const [forgeState, setForgeState] = useState<GitForgeState | null>(null)
  const [forgeStatus, setForgeStatus] = useState<ForgeStatus>('idle')
  const [forgeError, setForgeError] = useState<string | null>(null)
  const [lastSuccessfulFetch, setLastSuccessfulFetch] = useState<number | null>(null)

  const refreshForge = useCallback(async () => {
    if (!repoPath) {
      setForgeState(null)
      setForgeStatus('idle')
      setForgeError(null)
      return
    }

    setForgeStatus('fetching')

    try {
      const result: ForgeStateResult = await window.api.getForgeState({ repoPath })
      setForgeState(result.state)
      setForgeStatus(result.status)
      setForgeError(result.error ?? null)
      if (result.lastSuccessfulFetch) {
        setLastSuccessfulFetch(result.lastSuccessfulFetch)
      }
    } catch (error) {
      // Network error or IPC failure - keep stale state
      log.error('Failed to fetch forge state:', error)
      setForgeStatus('error')
      setForgeError(error instanceof Error ? error.message : 'Failed to connect to GitHub')
      // Don't clear forgeState - keep showing stale data
    }
  }, [repoPath])

  // Reset state and fetch when repoPath changes
  useEffect(() => {
    // Clear stale state from previous repo before fetching new one
    setForgeState(null)
    setForgeError(null)
    refreshForge()
  }, [refreshForge])

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = (): void => {
      refreshForge()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshForge])

  return (
    <ForgeStateContext.Provider
      value={{
        forgeState,
        forgeStatus,
        forgeError,
        lastSuccessfulFetch,
        refreshForge
      }}
    >
      {children}
    </ForgeStateContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useForgeStateContext(): ForgeStateContextValue {
  const context = useContext(ForgeStateContext)
  if (context === undefined) {
    throw new Error('useForgeStateContext must be used within a ForgeStateProvider')
  }
  return context
}
