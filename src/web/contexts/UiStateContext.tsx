import { log } from '@shared/logger'
import type { UiStack, UiState } from '@shared/types'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useGitWatcher } from '../hooks/use-git-watcher'

interface UiStateContextValue {
  toggleTheme: () => void
  isDark: boolean
  uiState: UiState | null
  repoError: string | null
  setFilesStageStatus: (params: { staged: boolean; files: string[] }) => Promise<void>
  commit: (params: { message: string }) => Promise<void>
  amend: (params: { message?: string }) => Promise<void>
  discardStaged: () => Promise<void>
  submitRebaseIntent: (params: { headSha: string; baseSha: string }) => Promise<void>
  confirmRebaseIntent: () => Promise<void>
  cancelRebaseIntent: () => Promise<void>
  continueRebase: () => Promise<void>
  abortRebase: () => Promise<void>
  skipRebaseCommit: () => Promise<void>
  checkout: (params: { ref: string }) => Promise<void>
  deleteBranch: (params: { branchName: string }) => Promise<void>
  cleanupBranch: (params: { branchName: string }) => Promise<void>
  createPullRequest: (params: { headBranch: string }) => Promise<void>
  updatePullRequest: (params: { headBranch: string }) => Promise<void>
  uncommit: (params: { commitSha: string }) => Promise<void>
  shipIt: (params: { branchName: string }) => Promise<void>
  isWorkingTreeDirty: boolean
  /** True when Git is mid-rebase (either conflicted or resolved, waiting for continue) */
  isRebasingWithConflicts: boolean
}

const UiStateContext = createContext<UiStateContextValue | undefined>(undefined)

export function UiStateProvider({
  children,
  selectedRepoPath: repoPath
}: {
  children: ReactNode
  selectedRepoPath: string | null
}): React.JSX.Element {
  const [isDark, setIsDark] = useState(true)
  const [uiState, setUiState] = useState<UiState | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)

  const refreshRepo = useCallback(async () => {
    if (!repoPath) {
      setUiState(null)
      setRepoError(null)
      return
    }

    try {
      const uiState = await window.api.getRepo({ repoPath })
      if (uiState) {
        setUiState(uiState)
        setRepoError(null)
      }
    } catch (error) {
      log.error('Failed to refresh repo:', error)
      setRepoError(error instanceof Error ? error.message : String(error))
      setUiState(null)
    }
  }, [repoPath])

  useEffect(() => {
    refreshRepo()
  }, [refreshRepo])

  useEffect(() => {
    window.addEventListener('focus', refreshRepo)
    return () => window.removeEventListener('focus', refreshRepo)
  }, [refreshRepo])

  useGitWatcher({
    repoPath,
    onRepoChange: refreshRepo,
    onRepoError: (error) => {
      setRepoError(error)
      setUiState(null)
    }
  })

  useEffect(() => {
    const html = document.documentElement
    if (isDark) html.classList.add('dark')
    else html.classList.remove('dark')
  }, [isDark])

  const toggleTheme = (): void => {
    setIsDark((prev) => !prev)
  }

  // Helper to call API and update state
  const callApi = useCallback(async (apiCall: Promise<UiState | null>) => {
    try {
      const newUiState = await apiCall
      if (newUiState) setUiState(newUiState)
    } catch (error) {
      log.error('API call failed:', error)
      toast.error('Operation failed', {
        description: error instanceof Error ? error.message : String(error)
      })
      // Re-throw so callers can handle loading states etc if needed
      throw error
    }
  }, [])

  const setFilesStageStatus = useCallback(
    async (params: { staged: boolean; files: string[] }) => {
      if (!repoPath) return
      await callApi(window.api.setFilesStageStatus({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const commit = useCallback(
    async (params: { message: string }) => {
      if (!repoPath) return
      await callApi(window.api.commit({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const amend = useCallback(
    async (params: { message?: string }) => {
      if (!repoPath) return
      await callApi(window.api.amend({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const discardStaged = useCallback(async () => {
    if (!repoPath) return
    await callApi(window.api.discardStaged({ repoPath }))
  }, [repoPath, callApi])

  const submitRebaseIntent = useCallback(
    async (params: { headSha: string; baseSha: string }) => {
      if (!repoPath) return
      await callApi(window.api.submitRebaseIntent({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const confirmRebaseIntent = useCallback(async () => {
    if (!repoPath) return
    await callApi(window.api.confirmRebaseIntent({ repoPath }))
  }, [repoPath, callApi])

  const cancelRebaseIntent = useCallback(async () => {
    if (!repoPath) return
    await callApi(window.api.cancelRebaseIntent({ repoPath }))
  }, [repoPath, callApi])

  const continueRebase = useCallback(async () => {
    if (!repoPath) return
    const result = await window.api.continueRebase({ repoPath })
    if (result.uiState) setUiState(result.uiState)
    if (!result.success && result.error) {
      log.error('Continue rebase failed:', result.error)
    }
  }, [repoPath])

  const abortRebase = useCallback(async () => {
    if (!repoPath) return
    const result = await window.api.abortRebase({ repoPath })
    if (result.uiState) setUiState(result.uiState)
    if (!result.success && result.error) {
      log.error('Abort rebase failed:', result.error)
    }
  }, [repoPath])

  const skipRebaseCommit = useCallback(async () => {
    if (!repoPath) return
    const result = await window.api.skipRebaseCommit({ repoPath })
    if (result.uiState) setUiState(result.uiState)
    if (!result.success && result.error) {
      log.error('Skip rebase commit failed:', result.error)
    }
  }, [repoPath])

  const checkout = useCallback(
    async (params: { ref: string }) => {
      if (!repoPath) return
      await callApi(window.api.checkout({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const deleteBranch = useCallback(
    async (params: { branchName: string }) => {
      if (!repoPath) return
      await callApi(window.api.deleteBranch({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const cleanupBranch = useCallback(
    async (params: { branchName: string }) => {
      if (!repoPath) return
      await callApi(window.api.cleanupBranch({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const createPullRequest = useCallback(
    async (params: { headBranch: string }) => {
      if (!repoPath) return
      await callApi(window.api.createPullRequest({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const updatePullRequest = useCallback(
    async (params: { headBranch: string }) => {
      if (!repoPath) return
      await callApi(window.api.updatePullRequest({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const uncommit = useCallback(
    async (params: { commitSha: string }) => {
      if (!repoPath) return
      await callApi(window.api.uncommit({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const shipIt = useCallback(
    async (params: { branchName: string }) => {
      if (!repoPath) return
      await callApi(window.api.shipIt({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const isWorkingTreeDirty = (uiState?.workingTree?.length ?? 0) > 0

  // Check if any commit in the stack has 'conflicted' or 'resolved' status
  const isRebasingWithConflicts = uiState?.stack ? hasRebaseConflictStatus(uiState.stack) : false

  return (
    <UiStateContext.Provider
      value={{
        toggleTheme,
        isDark,
        uiState,
        repoError,
        setFilesStageStatus,
        commit,
        amend,
        discardStaged,
        submitRebaseIntent,
        confirmRebaseIntent,
        cancelRebaseIntent,
        continueRebase,
        abortRebase,
        skipRebaseCommit,
        checkout,
        deleteBranch,
        cleanupBranch,
        createPullRequest,
        updatePullRequest,
        uncommit,
        shipIt,
        isWorkingTreeDirty,
        isRebasingWithConflicts
      }}
    >
      {children}
    </UiStateContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUiStateContext(): UiStateContextValue {
  const context = useContext(UiStateContext)
  if (context === undefined) {
    throw new Error('useUiStateContext must be used within a UiStateProvider')
  }
  return context
}

/**
 * Recursively checks if any commit in the stack has 'conflicted' or 'resolved' rebase status
 */
function hasRebaseConflictStatus(stack: UiStack): boolean {
  for (const commit of stack.commits) {
    if (commit.rebaseStatus === 'conflicted' || commit.rebaseStatus === 'resolved') {
      return true
    }
    // Check spinoffs
    for (const spinoff of commit.spinoffs) {
      if (hasRebaseConflictStatus(spinoff)) {
        return true
      }
    }
  }
  return false
}
