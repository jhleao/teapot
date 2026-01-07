import { log } from '@shared/logger'
import type {
  ForgeStateResult,
  ForgeStatus,
  GitForgeState,
  RateLimitInfo
} from '@shared/types/git-forge'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRequestVersioning } from '../hooks/use-request-versioning'

interface ForgeStateContextValue {
  /** Current forge state (PR data). May be stale if status is 'error'. */
  forgeState: GitForgeState | null
  /** Current status of the forge fetch operation */
  forgeStatus: ForgeStatus
  /** Error message if status is 'error' */
  forgeError: string | null
  /** Timestamp of last successful fetch */
  lastSuccessfulFetch: number | null
  /** Rate limit information from GitHub API */
  rateLimit: RateLimitInfo | null
  /** Manually trigger a refresh of forge state */
  refreshForge: () => Promise<void>
  /** Optimistically mark a PR as merged (prevents Ship It button race condition) */
  markPrAsMerged: (branchName: string) => void
  /** Optimistically mark a PR's checks as pending (when user pushes new commits) */
  markPrChecksPending: (branchName: string) => void
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
  const { acquireVersion, checkVersion } = useRequestVersioning()
  const [forgeState, setForgeState] = useState<GitForgeState | null>(null)
  const [forgeStatus, setForgeStatus] = useState<ForgeStatus>('idle')
  const [forgeError, setForgeError] = useState<string | null>(null)
  const [lastSuccessfulFetch, setLastSuccessfulFetch] = useState<number | null>(null)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)

  /**
   * Optimistically marks a PR as merged by branch name.
   * This prevents the Ship It button from briefly re-enabling during the race
   * between merge completion and forge state refresh.
   */
  const markPrAsMerged = useCallback((branchName: string) => {
    setForgeState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        pullRequests: prev.pullRequests.map((pr) =>
          pr.headRefName === branchName
            ? { ...pr, state: 'merged' as const, isMergeable: false, mergeReadiness: undefined }
            : pr
        )
      }
    })
  }, [])

  /**
   * Optimistically marks a PR's checks as pending by branch name.
   * Called when user pushes new commits - GitHub takes a few seconds to register
   * new check runs, so we show "Checks pending" immediately for better UX.
   */
  const markPrChecksPending = useCallback((branchName: string) => {
    setForgeState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        pullRequests: prev.pullRequests.map((pr) => {
          if (pr.headRefName !== branchName) return pr
          // Only update if PR has existing mergeReadiness (i.e., it's an open PR)
          if (!pr.mergeReadiness) return pr
          return {
            ...pr,
            isMergeable: false,
            mergeReadiness: {
              ...pr.mergeReadiness,
              canMerge: false,
              checksStatus: 'pending',
              // Clear existing checks - new ones will be registered by GitHub
              checks: [],
              // Add checks_pending blocker if not already present
              blockers: pr.mergeReadiness.blockers.includes('checks_pending')
                ? pr.mergeReadiness.blockers
                : [
                    ...pr.mergeReadiness.blockers.filter((b) => b !== 'checks_failed'),
                    'checks_pending'
                  ]
            }
          }
        })
      }
    })
  }, [])

  const fetchForgeState = useCallback(
    async (forceRefresh = false) => {
      if (!repoPath) {
        setForgeState(null)
        setForgeStatus('idle')
        setForgeError(null)
        return
      }

      const version = acquireVersion()
      setForgeStatus('fetching')

      try {
        const result: ForgeStateResult = await window.api.getForgeState({ repoPath, forceRefresh })

        if (!checkVersion(version)) {
          log.debug('[ForgeStateContext] Discarding stale response')
          return
        }

        setForgeState(result.state)
        setForgeStatus(result.status)
        setForgeError(result.error ?? null)
        if (result.lastSuccessfulFetch) {
          setLastSuccessfulFetch(result.lastSuccessfulFetch)
        }
        if (result.rateLimit) {
          setRateLimit(result.rateLimit)
        }
      } catch (error) {
        if (!checkVersion(version)) return

        // Network error or IPC failure - keep stale state
        log.error('Failed to fetch forge state:', error)
        setForgeStatus('error')
        setForgeError(error instanceof Error ? error.message : 'Failed to connect to GitHub')
        // Don't clear forgeState - keep showing stale data
      }
    },
    [repoPath, acquireVersion, checkVersion]
  )

  const refreshForge = useCallback(async () => {
    await fetchForgeState(false)
  }, [fetchForgeState])

  // Reset state and fetch when repoPath changes
  useEffect(() => {
    // Clear stale state from previous repo before fetching new one
    setForgeState(null)
    setForgeError(null)
    refreshForge()
  }, [refreshForge])

  // Refresh on window focus (invalidate cache to ensure fresh data)
  useEffect(() => {
    const handleFocus = (): void => {
      fetchForgeState(true)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [fetchForgeState])

  // Adaptive polling based on state:
  // - 5s when CI checks are pending (need to show status changes quickly)
  // - 15s when active (default)
  // - 30s when background tab or rate limit is low
  useEffect(() => {
    if (!repoPath) return

    const getPollingInterval = (): number => {
      // Slow down polling if rate limit is low
      if (rateLimit && rateLimit.remaining < rateLimit.limit * 0.1) {
        return 60_000 // 1 minute when rate limited
      }

      // Poll faster when CI checks are pending
      const hasPendingChecks = forgeState?.pullRequests.some(
        (pr) => pr.mergeReadiness?.checksStatus === 'pending'
      )
      if (hasPendingChecks) {
        return 5_000 // 5s for pending checks
      }

      // Slow down polling when tab is in background
      if (document.visibilityState === 'hidden') {
        return 30_000 // 30s when hidden
      }

      return 15_000 // Default 15s
    }

    let timeoutId: ReturnType<typeof setTimeout>

    const scheduleNext = (): void => {
      const interval = getPollingInterval()
      timeoutId = setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          await refreshForge()
        }
        scheduleNext()
      }, interval)
    }

    scheduleNext()

    return () => clearTimeout(timeoutId)
  }, [repoPath, refreshForge, forgeState, rateLimit])

  return (
    <ForgeStateContext.Provider
      value={{
        forgeState,
        forgeStatus,
        forgeError,
        lastSuccessfulFetch,
        rateLimit,
        refreshForge,
        markPrAsMerged,
        markPrChecksPending
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
