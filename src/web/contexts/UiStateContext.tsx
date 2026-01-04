import { log } from '@shared/logger'
import type { UiStack, UiState, WorktreeConflict } from '@shared/types'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import { WorktreeConflictDialog } from '../components/WorktreeConflictDialog'
import { useGitWatcher } from '../hooks/use-git-watcher'
import { useRequestVersioning } from '../hooks/use-request-versioning'
import { useForgeStateContext } from './ForgeStateContext'
import { useLocalStateContext } from './LocalStateContext'

interface UiStateContextValue {
  toggleTheme: () => void
  isDark: boolean
  uiState: UiState | null
  repoError: string | null
  repoPath: string | null
  setFilesStageStatus: (params: { staged: boolean; files: string[] }) => Promise<void>
  commit: (params: { message: string; newBranchName?: string }) => Promise<void>
  amend: (params: { message?: string }) => Promise<void>
  discardStaged: () => Promise<void>
  submitRebaseIntent: (params: { headSha: string; baseSha: string }) => Promise<void>
  confirmRebaseIntent: () => Promise<void>
  cancelRebaseIntent: () => Promise<void>
  continueRebase: () => Promise<void>
  abortRebase: () => Promise<void>
  skipRebaseCommit: () => Promise<void>
  resumeRebaseQueue: () => Promise<void>
  dismissRebaseQueue: () => Promise<void>
  checkout: (params: { ref: string }) => Promise<void>
  deleteBranch: (params: { branchName: string }) => Promise<void>
  cleanupBranch: (params: { branchName: string }) => Promise<void>
  createBranch: (params: { branchName?: string; commitSha: string }) => Promise<void>
  renameBranch: (params: { oldBranchName: string; newBranchName: string }) => Promise<void>
  createPullRequest: (params: { headBranch: string }) => Promise<void>
  updatePullRequest: (params: { headBranch: string }) => Promise<void>
  uncommit: (params: { commitSha: string }) => Promise<void>
  shipIt: (params: { branchName: string }) => Promise<void>
  syncTrunk: () => Promise<void>
  switchWorktree: (params: { worktreePath: string }) => Promise<void>
  isWorkingTreeDirty: boolean
  /** True when Git is mid-rebase (either conflicted or resolved, waiting for continue) */
  isRebasingWithConflicts: boolean
  /** True when the current branch is a trunk branch (main/master). Amending on trunk is dangerous. */
  isOnTrunk: boolean
  /** Branches that are pending in queue after external continue */
  queuedBranches: string[]
}

const UiStateContext = createContext<UiStateContextValue | undefined>(undefined)

export function UiStateProvider({
  children,
  selectedRepoPath: repoPath
}: {
  children: ReactNode
  selectedRepoPath: string | null
}): React.JSX.Element {
  const { acquireVersion, checkVersion } = useRequestVersioning()
  const { refreshForge } = useForgeStateContext()
  const { refreshRepos } = useLocalStateContext()
  const [isDark, setIsDark] = useState(true)
  const [uiState, setUiState] = useState<UiState | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  const skipWatcherUpdatesRef = useRef(false)

  // Worktree conflict state for blocking rebase operations
  const [worktreeConflicts, setWorktreeConflicts] = useState<{
    conflicts: WorktreeConflict[]
    message: string
  } | null>(null)

  const refreshRepo = useCallback(async () => {
    if (!repoPath) {
      setUiState(null)
      setRepoError(null)
      return
    }

    const version = acquireVersion()

    try {
      const uiState = await window.api.getRepo({ repoPath })

      if (!checkVersion(version)) {
        log.debug('[UiStateContext] Discarding stale response')
        return
      }

      if (uiState) {
        setUiState(uiState)
        setRepoError(null)
      }
    } catch (error) {
      if (!checkVersion(version)) return

      log.error('Failed to refresh repo:', error)
      setRepoError(error instanceof Error ? error.message : String(error))
      setUiState(null)
    }
  }, [repoPath, acquireVersion, checkVersion])

  // Clear state immediately when repo path changes to show loading state
  useEffect(() => {
    setUiState(null)
    setRepoError(null)
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
    onRepoChange: () => {
      if (skipWatcherUpdatesRef.current) return
      refreshRepo()
    },
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

  const toggleTheme = useCallback((): void => {
    setIsDark((prev) => !prev)
  }, [])

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
    async (params: { message: string; newBranchName?: string }) => {
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
      skipWatcherUpdatesRef.current = true
      log.debug('[UiStateContext.submitRebaseIntent] Starting', {
        repoPath,
        headSha: params.headSha.slice(0, 8),
        baseSha: params.baseSha.slice(0, 8)
      })

      try {
        const result = await window.api.submitRebaseIntent({ repoPath, ...params })
        log.debug('[UiStateContext.submitRebaseIntent] Result received', {
          repoPath,
          resultIsNull: result === null,
          success: result?.success,
          hasUiState: result?.success && !!result.uiState
        })

        if (result === null) {
          // Invalid intent (e.g., invalid head/base)
          skipWatcherUpdatesRef.current = false
          return
        }

        if (!result.success && result.error === 'WORKTREE_CONFLICT') {
          // Worktree conflict - show dialog instead of proceeding
          skipWatcherUpdatesRef.current = false
          setWorktreeConflicts({
            conflicts: result.worktreeConflicts,
            message: result.message
          })
          return
        }

        if (result.success && result.uiState) {
          setUiState(result.uiState)
        }
      } catch (error) {
        skipWatcherUpdatesRef.current = false
        log.error('Submit rebase intent failed:', error)
        toast.error('Failed to start rebase', {
          description: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    [repoPath]
  )

  const confirmRebaseIntent = useCallback(async () => {
    if (!repoPath) return
    log.debug('[UiStateContext.confirmRebaseIntent] Starting', { repoPath })
    try {
      const result = await window.api.confirmRebaseIntent({ repoPath })
      log.debug('[UiStateContext.confirmRebaseIntent] Result received', {
        repoPath,
        resultIsNull: result === null,
        hasStack: !!result?.stack
      })
      if (result) setUiState(result)
    } catch (error) {
      log.error('[UiStateContext.confirmRebaseIntent] Failed:', error)
      toast.error('Operation failed', {
        description: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      skipWatcherUpdatesRef.current = false
    }
  }, [repoPath])

  const cancelRebaseIntent = useCallback(async () => {
    if (!repoPath) return
    try {
      await callApi(window.api.cancelRebaseIntent({ repoPath }))
    } finally {
      skipWatcherUpdatesRef.current = false
    }
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

  const resumeRebaseQueue = useCallback(async () => {
    if (!repoPath) return
    const result = await window.api.resumeRebaseQueue({ repoPath })
    if (result.uiState) setUiState(result.uiState)
    if (!result.success && result.error) {
      log.error('Resume rebase queue failed:', result.error)
    }
  }, [repoPath])

  const dismissRebaseQueue = useCallback(async () => {
    if (!repoPath) return
    const result = await window.api.dismissRebaseQueue({ repoPath })
    if (result) setUiState(result)
  }, [repoPath])

  const checkout = useCallback(
    async (params: { ref: string }) => {
      if (!repoPath) return
      try {
        const result = await window.api.checkout({ repoPath, ...params })
        if (result.uiState) setUiState(result.uiState)
      } catch (error) {
        const errorStr = String(error)
        // Show info toast for worktree conflicts (not a real error, just can't checkout)
        // Extract the user-friendly part from Electron's wrapped error message
        const worktreeMatch = errorStr.match(/Cannot checkout '[^']+' - already checked out in .+/)
        if (worktreeMatch) {
          toast.info(worktreeMatch[0])
          return
        }
        const message = error instanceof Error ? error.message : errorStr
        log.error('Checkout failed:', error)
        toast.error('Checkout failed', { description: message })
        throw error
      }
    },
    [repoPath]
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

  const createBranch = useCallback(
    async (params: { branchName?: string; commitSha: string }) => {
      if (!repoPath) return
      await callApi(window.api.createBranch({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const renameBranch = useCallback(
    async (params: { oldBranchName: string; newBranchName: string }) => {
      if (!repoPath) return
      await callApi(window.api.renameBranch({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  const createPullRequest = useCallback(
    async (params: { headBranch: string }) => {
      if (!repoPath) return
      await callApi(window.api.createPullRequest({ repoPath, ...params }))
      // Refresh forge state to get the newly created PR
      await refreshForge()
    },
    [repoPath, callApi, refreshForge]
  )

  const updatePullRequest = useCallback(
    async (params: { headBranch: string }) => {
      if (!repoPath) return
      await callApi(window.api.updatePullRequest({ repoPath, ...params }))
      // Refresh forge state to get the updated PR status
      await refreshForge()
    },
    [repoPath, callApi, refreshForge]
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
      try {
        const result = await window.api.shipIt({ repoPath, ...params })
        if (result.uiState) setUiState(result.uiState)
        if (result.message) {
          // Use info toast if needs rebase, success otherwise
          if (result.needsRebase) {
            toast.info(result.message)
          } else {
            toast.success(result.message)
          }
        }
        // Refresh forge state to get updated PR status (merged)
        await refreshForge()
      } catch (error) {
        log.error('Ship It failed:', error)
        toast.error('Ship It failed', {
          description: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    [repoPath, refreshForge]
  )

  const syncTrunk = useCallback(async () => {
    if (!repoPath) return
    try {
      const result = await window.api.syncTrunk({ repoPath })
      if (result.uiState) setUiState(result.uiState)
      if (result.status === 'success' && result.message) {
        toast.success(result.message)
      } else if (result.status === 'conflict' && result.message) {
        toast.warning(result.message)
      } else if (result.status === 'error' && result.message) {
        toast.error(result.message)
      }
    } catch (error) {
      log.error('Sync trunk failed:', error)
      toast.error('Sync trunk failed', {
        description: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }, [repoPath])

  const switchWorktree = useCallback(
    async (params: { worktreePath: string }) => {
      if (!repoPath) return
      await callApi(window.api.switchWorktree({ repoPath, ...params }))
      await refreshRepos()
    },
    [repoPath, callApi, refreshRepos]
  )

  // Handler for closing the worktree conflict dialog
  const handleWorktreeConflictClose = useCallback(() => {
    setWorktreeConflicts(null)
  }, [])

  const isWorkingTreeDirty = useMemo(
    () => (uiState?.workingTree?.length ?? 0) > 0,
    [uiState?.workingTree?.length]
  )

  // Check if any commit in the stack has 'conflicted' or 'resolved' status
  const isRebasingWithConflicts = useMemo(
    () => (uiState?.stack ? hasRebaseConflictStatus(uiState.stack) : false),
    [uiState?.stack]
  )

  // Check if currently on a trunk branch (main/master) - amending on trunk is dangerous
  const isOnTrunk = useMemo(
    () => (uiState?.stack ? isCurrentBranchTrunk(uiState.stack) : false),
    [uiState?.stack]
  )

  // Find branches that are pending in queue after external continue
  const queuedBranches = useMemo(
    () => (uiState?.stack ? findQueuedBranches(uiState.stack) : []),
    [uiState?.stack]
  )

  const contextValue = useMemo<UiStateContextValue>(
    () => ({
      toggleTheme,
      isDark,
      uiState,
      repoError,
      repoPath,
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
      resumeRebaseQueue,
      dismissRebaseQueue,
      checkout,
      deleteBranch,
      cleanupBranch,
      createBranch,
      renameBranch,
      createPullRequest,
      updatePullRequest,
      uncommit,
      shipIt,
      syncTrunk,
      switchWorktree,
      isWorkingTreeDirty,
      isRebasingWithConflicts,
      isOnTrunk,
      queuedBranches
    }),
    [
      toggleTheme,
      isDark,
      uiState,
      repoError,
      repoPath,
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
      resumeRebaseQueue,
      dismissRebaseQueue,
      checkout,
      deleteBranch,
      cleanupBranch,
      createBranch,
      renameBranch,
      createPullRequest,
      updatePullRequest,
      uncommit,
      shipIt,
      syncTrunk,
      switchWorktree,
      isWorkingTreeDirty,
      isRebasingWithConflicts,
      isOnTrunk,
      queuedBranches
    ]
  )

  return (
    <UiStateContext.Provider value={contextValue}>
      {children}
      {worktreeConflicts && (
        <WorktreeConflictDialog
          open={true}
          conflicts={worktreeConflicts.conflicts}
          message={worktreeConflicts.message}
          onClose={handleWorktreeConflictClose}
        />
      )}
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

/**
 * Checks if HEAD is on a trunk commit (main/master or origin/main).
 * Handles both checked-out branches and detached HEAD.
 */
function isCurrentBranchTrunk(stack: UiStack): boolean {
  for (const commit of stack.commits) {
    if (!commit.isCurrent) continue
    for (const branch of commit.branches) {
      if (branch.isTrunk) {
        return true
      }
    }
  }
  return false
}

/**
 * Finds branches that have 'queued' rebase status (pending in queue after external continue).
 */
function findQueuedBranches(stack: UiStack): string[] {
  const branches: string[] = []
  function traverse(s: UiStack) {
    for (const commit of s.commits) {
      if (commit.rebaseStatus === 'queued') {
        const branchName = commit.branches[0]?.name
        if (branchName) branches.push(branchName)
      }
      for (const spinoff of commit.spinoffs) traverse(spinoff)
    }
  }
  traverse(stack)
  return branches
}
