import { log } from '@shared/logger'
import type {
  SquashBlocker,
  SquashPreview,
  SquashResult,
  UiStack,
  UiState,
  WorktreeConflict
} from '@shared/types'
import type { MergeStrategy } from '@shared/types/git-forge'
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
  uiState: UiState | null
  repoError: string | null
  repoPath: string | null
  setFilesStageStatus: (params: { staged: boolean; files: string[] }) => Promise<void>
  commit: (params: { message: string; newBranchName?: string }) => Promise<void>
  amend: (params: { message?: string }) => Promise<void>
  getCommitMessage: (commitSha: string) => Promise<string>
  discardStaged: () => Promise<void>
  submitRebaseIntent: (params: { headSha: string; baseSha: string }) => Promise<void>
  confirmRebaseIntent: () => Promise<void>
  cancelRebaseIntent: () => Promise<void>
  continueRebase: () => Promise<void>
  abortRebase: () => Promise<void>
  skipRebaseCommit: () => Promise<void>
  resumeRebaseQueue: () => Promise<void>
  dismissRebaseQueue: () => Promise<void>
  handleStashAndProceed: () => Promise<void>
  handleDeleteAndProceed: () => Promise<void>
  checkout: (params: { ref: string }) => Promise<void>
  deleteBranch: (params: { branchName: string }) => Promise<void>
  cleanupBranch: (params: { branchName: string }) => Promise<void>
  createBranch: (params: { branchName?: string; commitSha: string }) => Promise<void>
  renameBranch: (params: { oldBranchName: string; newBranchName: string }) => Promise<void>
  createPullRequest: (params: { headBranch: string }) => Promise<void>
  updatePullRequest: (params: { headBranch: string }) => Promise<void>
  getSquashPreview: (params: { branchName: string }) => Promise<SquashPreview>
  squashIntoParent: (params: {
    branchName: string
    commitMessage?: string
    branchChoice?: import('@shared/types').BranchChoice
  }) => Promise<SquashResult | undefined>
  uncommit: (params: { commitSha: string }) => Promise<void>
  shipIt: (params: { branchName: string; canShip?: boolean }) => Promise<void>
  syncTrunk: () => Promise<void>
  pullStack: (params: { branchNames: string[] }) => Promise<void>
  switchWorktree: (params: { worktreePath: string }) => Promise<void>
  createWorktree: (params: {
    branch: string
  }) => Promise<{ success: boolean; worktreePath?: string }>
  removeWorktree: (params: {
    worktreePath: string
    force?: boolean
  }) => Promise<{ success: boolean }>
  isWorkingTreeDirty: boolean
  isRebasingWithConflicts: boolean
  isOnTrunk: boolean
  queuedBranches: string[]
  mergeStrategy: MergeStrategy
}

// Default context value for graceful degradation during error recovery.
// When an error occurs and React unmounts/remounts the tree, child components
// may briefly render before UiStateProvider mounts. This default ensures they
// get a safe value instead of throwing, allowing the UI to show loading state.
const DEFAULT_UI_STATE_CONTEXT: UiStateContextValue = {
  uiState: null,
  repoError: null,
  repoPath: null,
  setFilesStageStatus: async () => {},
  commit: async () => {},
  amend: async () => {},
  getCommitMessage: async () => '',
  discardStaged: async () => {},
  submitRebaseIntent: async () => {},
  confirmRebaseIntent: async () => {},
  cancelRebaseIntent: async () => {},
  continueRebase: async () => {},
  abortRebase: async () => {},
  skipRebaseCommit: async () => {},
  resumeRebaseQueue: async () => {},
  dismissRebaseQueue: async () => {},
  handleStashAndProceed: async () => {},
  handleDeleteAndProceed: async () => {},
  checkout: async () => {},
  deleteBranch: async () => {},
  cleanupBranch: async () => {},
  createBranch: async () => {},
  renameBranch: async () => {},
  createPullRequest: async () => {},
  updatePullRequest: async () => {},
  getSquashPreview: async () => ({ canSquash: false, commits: [], combinedMessage: '' }),
  squashIntoParent: async () => undefined,
  uncommit: async () => {},
  shipIt: async () => {},
  syncTrunk: async () => {},
  pullStack: async () => {},
  switchWorktree: async () => {},
  createWorktree: async () => ({ success: false }),
  removeWorktree: async () => ({ success: false }),
  isWorkingTreeDirty: false,
  isRebasingWithConflicts: false,
  isOnTrunk: false,
  queuedBranches: [],
  mergeStrategy: 'rebase'
}

const UiStateContext = createContext<UiStateContextValue>(DEFAULT_UI_STATE_CONTEXT)

export function UiStateProvider({
  children,
  selectedRepoPath: repoPath
}: {
  children: ReactNode
  selectedRepoPath: string | null
}): React.JSX.Element {
  const { acquireVersion, checkVersion } = useRequestVersioning()
  const { refreshForge, markPrAsMerged, markPrChecksPending } = useForgeStateContext()
  const { refreshRepos } = useLocalStateContext()
  const [uiState, setUiState] = useState<UiState | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('rebase')
  const skipWatcherUpdatesRef = useRef(false)

  // Worktree conflict state for blocking rebase operations
  const [worktreeConflicts, setWorktreeConflicts] = useState<{
    conflicts: WorktreeConflict[]
    message: string
    headSha: string
    baseSha: string
  } | null>(null)
  const [isResolvingWorktreeConflict, setIsResolvingWorktreeConflict] = useState(false)

  const refreshRepo = useCallback(async () => {
    if (!repoPath) {
      setUiState(null)
      setRepoError(null)
      return
    }

    const version = acquireVersion()

    // Set a timeout to detect stuck IPC calls (e.g., after wake from sleep)
    const timeoutId = setTimeout(() => {
      if (checkVersion(version)) {
        setRepoError('Connection timed out. Try reloading the app.')
      }
    }, 10000)

    try {
      const result = await window.api.getRepo({ repoPath })
      clearTimeout(timeoutId)

      if (!checkVersion(version)) {
        log.debug('[UiStateContext] Discarding stale response')
        return
      }

      if (result) {
        setUiState(result)
        setRepoError(null)
      }
    } catch (error) {
      clearTimeout(timeoutId)
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

  useEffect(() => {
    window.api
      .getMergeStrategy()
      .then(setMergeStrategy)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.onRebaseWarning((message) => {
      toast.warning(message)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const onRepoChange = useCallback(() => {
    if (skipWatcherUpdatesRef.current) return
    refreshRepo()
  }, [refreshRepo])

  const onRepoError = useCallback((error: string) => {
    setRepoError(error)
    setUiState(null)
  }, [])

  useGitWatcher({ repoPath, onRepoChange, onRepoError })

  // Helper to call API and update state
  const callApi = useCallback(
    async (apiCall: Promise<UiState | null>) => {
      // Version guard prevents stale watcher responses from overwriting fresh mutations
      const version = acquireVersion()
      try {
        const newUiState = await apiCall
        if (!checkVersion(version)) return
        if (newUiState) setUiState(newUiState)
      } catch (error) {
        if (!checkVersion(version)) return
        log.error('API call failed:', error)
        toast.error('Operation failed', {
          description: error instanceof Error ? error.message : String(error)
        })
        // Re-throw so callers can handle loading states etc if needed
        throw error
      }
    },
    [acquireVersion, checkVersion]
  )

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

  const getCommitMessage = useCallback(
    async (commitSha: string): Promise<string> => {
      if (!repoPath) return ''
      return window.api.getCommitMessage({ repoPath, commitSha })
    },
    [repoPath]
  )

  const discardStaged = useCallback(async () => {
    if (!repoPath) return
    await callApi(window.api.discardStaged({ repoPath }))
  }, [repoPath, callApi])

  const submitRebaseIntent = useCallback(
    async (params: { headSha: string; baseSha: string }) => {
      if (!repoPath) return
      skipWatcherUpdatesRef.current = true

      try {
        const result = await window.api.submitRebaseIntent({ repoPath, ...params })

        if (result === null) {
          // Invalid intent (e.g., invalid head/base)
          log.warn('[UiStateContext.submitRebaseIntent] Invalid rebase intent', {
            headSha: params.headSha.slice(0, 8),
            baseSha: params.baseSha.slice(0, 8)
          })
          toast.error('Cannot rebase', {
            description: 'Invalid commit reference. The branch may have changed.'
          })
          return
        }

        if (!result.success) {
          // Handle all failure cases explicitly
          if (result.error === 'WORKTREE_CONFLICT') {
            // Worktree conflict - show dialog instead of proceeding
            setWorktreeConflicts({
              conflicts: result.worktreeConflicts,
              message: result.message,
              headSha: params.headSha,
              baseSha: params.baseSha
            })
            return
          }
          // Unknown error type - log and show toast
          log.error('[UiStateContext.submitRebaseIntent] Unexpected error', { result })
          toast.error('Rebase failed', {
            description: 'An unexpected error occurred'
          })
          return
        }

        // Success case
        setUiState(result.uiState)
      } catch (error) {
        log.error('Submit rebase intent failed:', error)
        toast.error('Failed to start rebase', {
          description: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        // Always reset the flag - whether success, failure, or error
        skipWatcherUpdatesRef.current = false
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
        success: result.success,
        hasConflicts: !!(result.conflicts && result.conflicts.length > 0),
        hasStack: !!result.uiState?.stack
      })
      if (result.uiState) setUiState(result.uiState)
      // Note: conflicts are handled by the UI via uiState updates (rebase status polling)
      // The success: false with conflicts indicates the rebase is paused waiting for resolution
    } catch (error) {
      log.error('[UiStateContext.confirmRebaseIntent] Failed:', error)
      handleRebaseError(error, 'Rebase')
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
    try {
      const result = await window.api.continueRebase({ repoPath })
      if (result.uiState) setUiState(result.uiState)
      if (!result.success && result.error) {
        log.error('Continue rebase failed:', result.error)
        toast.error('Continue rebase failed', { description: result.error })
      }
    } catch (error) {
      log.error('[UiStateContext.continueRebase] Failed:', error)
      handleRebaseError(error, 'Continue rebase')
    }
  }, [repoPath])

  const abortRebase = useCallback(async () => {
    if (!repoPath) return
    try {
      const result = await window.api.abortRebase({ repoPath })
      if (result.uiState) setUiState(result.uiState)
      if (!result.success && result.error) {
        log.error('Abort rebase failed:', result.error)
        toast.error('Abort rebase failed', { description: result.error })
      }
    } catch (error) {
      log.error('[UiStateContext.abortRebase] Failed:', error)
      handleRebaseError(error, 'Abort rebase')
    }
  }, [repoPath])

  const skipRebaseCommit = useCallback(async () => {
    if (!repoPath) return
    try {
      const result = await window.api.skipRebaseCommit({ repoPath })
      if (result.uiState) setUiState(result.uiState)
      if (!result.success && result.error) {
        log.error('Skip rebase commit failed:', result.error)
        toast.error('Skip commit failed', { description: result.error })
      }
    } catch (error) {
      log.error('[UiStateContext.skipRebaseCommit] Failed:', error)
      handleRebaseError(error, 'Skip commit')
    }
  }, [repoPath])

  const resumeRebaseQueue = useCallback(async () => {
    if (!repoPath) return
    // Capture queued branches before the operation (they'll be pushed)
    const branchesToPush = uiState?.stack ? findQueuedBranches(uiState.stack) : []
    try {
      const result = await window.api.resumeRebaseQueue({ repoPath })
      if (result.uiState) setUiState(result.uiState)
      if (result.success) {
        // Optimistically mark checks as pending for all pushed branches
        branchesToPush.forEach((branch) => markPrChecksPending(branch))
      }
      if (!result.success && result.error) {
        log.error('Resume rebase queue failed:', result.error)
      }
    } catch (error) {
      log.error('[UiStateContext.resumeRebaseQueue] Failed:', error)
      handleRebaseError(error, 'Resume rebase queue')
    }
  }, [repoPath, uiState?.stack, markPrChecksPending])

  const dismissRebaseQueue = useCallback(async () => {
    if (!repoPath) return
    try {
      const result = await window.api.dismissRebaseQueue({ repoPath })
      if (result) setUiState(result)
    } catch (error) {
      log.error('[UiStateContext.dismissRebaseQueue] Failed:', error)
      handleRebaseError(error, 'Dismiss rebase queue')
    }
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
      // Optimistically mark checks as pending - GitHub takes a few seconds
      // to register new check runs after a push
      markPrChecksPending(params.headBranch)
      // Refresh forge state to get the updated PR status
      await refreshForge()
    },
    [repoPath, callApi, refreshForge, markPrChecksPending]
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
            // Optimistically mark PR as merged to prevent Ship It button
            // from briefly re-enabling during the race with refreshForge()
            markPrAsMerged(params.branchName)
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
    [repoPath, refreshForge, markPrAsMerged]
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
      // Also refresh forge state (PR data) since user explicitly synced with remote
      refreshForge()
    } catch (error) {
      log.error('Sync trunk failed:', error)
      toast.error('Sync trunk failed', {
        description: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }, [repoPath, refreshForge])

  const pullStack = useCallback(
    async (params: { branchNames: string[] }) => {
      if (!repoPath) return
      try {
        const result = await window.api.pullStack({ repoPath, branchNames: params.branchNames })
        if (result.uiState) setUiState(result.uiState)
        if (result.status === 'success' && result.message) {
          if (result.pulledCount === 0) {
            toast.info(result.message)
          } else {
            toast.success(result.message)
          }
        } else if (result.status === 'partial' && result.message) {
          toast.warning(result.message, {
            description: result.failedBranches?.length
              ? `Failed: ${result.failedBranches.join(', ')}`
              : undefined
          })
        } else if (result.status === 'error' && result.message) {
          toast.error(result.message)
        }
        // Refresh forge state since we pulled from remote
        refreshForge()
      } catch (error) {
        log.error('Pull stack failed:', error)
        toast.error('Pull stack failed', {
          description: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    [repoPath, refreshForge]
  )

  const switchWorktree = useCallback(
    async (params: { worktreePath: string }) => {
      if (!repoPath) return
      await callApi(window.api.switchWorktree({ repoPath, ...params }))
      await refreshRepos()
    },
    [repoPath, callApi, refreshRepos]
  )

  const createWorktree = useCallback(
    async (params: { branch: string }): Promise<{ success: boolean; worktreePath?: string }> => {
      if (!repoPath) return { success: false }
      const result = await window.api.createWorktree({ repoPath, ...params })
      if (result.success && result.uiState) {
        setUiState(result.uiState)
      }
      return { success: result.success, worktreePath: result.worktreePath }
    },
    [repoPath]
  )

  const removeWorktree = useCallback(
    async (params: { worktreePath: string; force?: boolean }): Promise<{ success: boolean }> => {
      if (!repoPath) return { success: false }
      const result = await window.api.removeWorktree({ repoPath, ...params })
      if (result.success && result.uiState) {
        setUiState(result.uiState)
      }
      return { success: result.success }
    },
    [repoPath]
  )

  const resolveWorktreeConflicts = useCallback(
    async (action: 'stash' | 'delete') => {
      if (!repoPath || !worktreeConflicts) return
      setIsResolvingWorktreeConflict(true)
      skipWatcherUpdatesRef.current = true

      try {
        const resolutions = dedupeWorktreeConflicts(worktreeConflicts.conflicts).map(
          (conflict) => ({
            worktreePath: conflict.worktreePath,
            action
          })
        )

        const result = await window.api.resolveWorktreeConflictAndRebase({
          repoPath,
          headSha: worktreeConflicts.headSha,
          baseSha: worktreeConflicts.baseSha,
          resolutions
        })

        if (result === null) {
          // Invalid intent after resolution
          log.warn(
            '[UiStateContext.resolveWorktreeConflicts] Invalid rebase intent after resolution'
          )
          toast.error('Cannot rebase', {
            description: 'Invalid commit reference. The branch may have changed.'
          })
          setWorktreeConflicts(null)
          return
        }

        if (!result.success) {
          // Handle all failure cases explicitly
          if (result.error === 'WORKTREE_CONFLICT') {
            // Still have conflicts - update dialog
            setWorktreeConflicts({
              conflicts: result.worktreeConflicts,
              message: result.message,
              headSha: worktreeConflicts.headSha,
              baseSha: worktreeConflicts.baseSha
            })
            return
          }
          // Unknown error type
          log.error('[UiStateContext.resolveWorktreeConflicts] Unexpected error', { result })
          toast.error('Rebase failed', {
            description: 'An unexpected error occurred'
          })
          setWorktreeConflicts(null)
          return
        }

        // Success case
        setUiState(result.uiState)
        setWorktreeConflicts(null)
      } catch (error) {
        log.error('Resolve worktree conflicts failed:', error)
        toast.error('Failed to resolve worktree conflicts', {
          description: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        skipWatcherUpdatesRef.current = false
        setIsResolvingWorktreeConflict(false)
      }
    },
    [repoPath, worktreeConflicts]
  )

  const handleStashAndProceed = useCallback(async () => {
    await resolveWorktreeConflicts('stash')
  }, [resolveWorktreeConflicts])

  const handleDeleteAndProceed = useCallback(async () => {
    await resolveWorktreeConflicts('delete')
  }, [resolveWorktreeConflicts])

  const getSquashPreview = useCallback(
    async (params: { branchName: string }): Promise<SquashPreview> => {
      if (!repoPath) throw new Error('No repository selected')
      return window.api.getSquashPreview({ repoPath, ...params })
    },
    [repoPath]
  )

  const squashIntoParent = useCallback(
    async (params: {
      branchName: string
      commitMessage?: string
      branchChoice?: import('@shared/types').BranchChoice
    }): Promise<SquashResult | undefined> => {
      if (!repoPath) return

      try {
        const result = await window.api.squashIntoParent({ repoPath, ...params })

        if (result.success) {
          toast.success(`Squashed ${params.branchName} into parent`)
          // Optimistically mark checks as pending for all pushed branches
          if (result.modifiedBranches) {
            result.modifiedBranches.forEach((branch) => markPrChecksPending(branch))
          }
          await refreshRepo()
        } else if (result.localSuccess) {
          toast.warning('Local squash succeeded but push failed. Retry git push manually.')
          await refreshRepo()
        } else {
          toast.error(getSquashErrorMessage(result.error, result.errorDetail))
        }

        return result
      } catch (error) {
        toast.error('Squash failed', {
          description: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    [repoPath, refreshRepo, markPrChecksPending]
  )

  // Handler for closing the worktree conflict dialog
  const handleWorktreeConflictClose = useCallback(() => {
    if (isResolvingWorktreeConflict) return
    setWorktreeConflicts(null)
  }, [isResolvingWorktreeConflict])

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
      uiState,
      repoError,
      repoPath,
      setFilesStageStatus,
      commit,
      amend,
      getCommitMessage,
      discardStaged,
      submitRebaseIntent,
      confirmRebaseIntent,
      cancelRebaseIntent,
      continueRebase,
      abortRebase,
      skipRebaseCommit,
      resumeRebaseQueue,
      dismissRebaseQueue,
      handleStashAndProceed,
      handleDeleteAndProceed,
      checkout,
      deleteBranch,
      cleanupBranch,
      createBranch,
      renameBranch,
      createPullRequest,
      updatePullRequest,
      getSquashPreview,
      squashIntoParent,
      uncommit,
      shipIt,
      syncTrunk,
      pullStack,
      switchWorktree,
      createWorktree,
      removeWorktree,
      isWorkingTreeDirty,
      isRebasingWithConflicts,
      isOnTrunk,
      queuedBranches,
      mergeStrategy
    }),
    [
      uiState,
      repoError,
      repoPath,
      setFilesStageStatus,
      commit,
      amend,
      getCommitMessage,
      discardStaged,
      submitRebaseIntent,
      confirmRebaseIntent,
      cancelRebaseIntent,
      continueRebase,
      abortRebase,
      skipRebaseCommit,
      resumeRebaseQueue,
      dismissRebaseQueue,
      handleStashAndProceed,
      handleDeleteAndProceed,
      checkout,
      deleteBranch,
      cleanupBranch,
      createBranch,
      renameBranch,
      createPullRequest,
      updatePullRequest,
      getSquashPreview,
      squashIntoParent,
      uncommit,
      shipIt,
      syncTrunk,
      pullStack,
      switchWorktree,
      createWorktree,
      removeWorktree,
      isWorkingTreeDirty,
      isRebasingWithConflicts,
      isOnTrunk,
      queuedBranches,
      mergeStrategy
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
          onCancel={handleWorktreeConflictClose}
          onStashAndProceed={handleStashAndProceed}
          onDeleteAndProceed={handleDeleteAndProceed}
          isLoading={isResolvingWorktreeConflict}
        />
      )}
    </UiStateContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUiStateContext(): UiStateContextValue {
  return useContext(UiStateContext)
}

function dedupeWorktreeConflicts(conflicts: WorktreeConflict[]): WorktreeConflict[] {
  const byPath = new Map<string, WorktreeConflict>()
  for (const conflict of conflicts) {
    if (!byPath.has(conflict.worktreePath)) {
      byPath.set(conflict.worktreePath, conflict)
    }
  }
  return Array.from(byPath.values())
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

/** Valid rebase error codes (must match backend RebaseErrorCode type) */
type RebaseErrorCode =
  | 'WORKTREE_CREATION_FAILED'
  | 'REBASE_IN_PROGRESS'
  | 'GIT_ADAPTER_UNSUPPORTED'
  | 'VALIDATION_FAILED'
  | 'SESSION_EXISTS'
  | 'BRANCH_NOT_FOUND'
  | 'CONTEXT_ACQUISITION_FAILED'
  | 'GENERIC'

const VALID_ERROR_CODES: readonly RebaseErrorCode[] = [
  'WORKTREE_CREATION_FAILED',
  'REBASE_IN_PROGRESS',
  'GIT_ADAPTER_UNSUPPORTED',
  'VALIDATION_FAILED',
  'SESSION_EXISTS',
  'BRANCH_NOT_FOUND',
  'CONTEXT_ACQUISITION_FAILED',
  'GENERIC'
] as const

/**
 * Extracts error code from IPC-serialized error name.
 * Error names are encoded as "RebaseOperationError:ERROR_CODE".
 * Returns null if no valid error code is found.
 */
function extractRebaseErrorCode(error: unknown): RebaseErrorCode | null {
  if (!(error instanceof Error)) return null

  // Match pattern: RebaseOperationError:CODE (e.g., "RebaseOperationError:WORKTREE_CREATION_FAILED")
  const match = error.name.match(/^RebaseOperationError:([A-Z_]+)$/)
  if (!match) return null

  const code = match[1]
  return VALID_ERROR_CODES.includes(code as RebaseErrorCode) ? (code as RebaseErrorCode) : null
}

/**
 * Handles rebase operation errors with appropriate toast messages.
 * Extracts error codes from error name (encoded for IPC serialization) and shows user-friendly toasts.
 */
function handleRebaseError(error: unknown, operationName: string): void {
  const errorCode = extractRebaseErrorCode(error)

  switch (errorCode) {
    case 'WORKTREE_CREATION_FAILED':
      toast.error('Could not create temporary worktree', {
        description: 'Please commit or stash your changes and try again.'
      })
      break
    case 'CONTEXT_ACQUISITION_FAILED':
      toast.error('Could not prepare execution environment', {
        description: 'Please try again or restart the application.'
      })
      break
    case 'SESSION_EXISTS':
      toast.error('A rebase is already in progress', {
        description: 'Please complete or cancel the current rebase first.'
      })
      break
    case 'REBASE_IN_PROGRESS':
      toast.error('Git rebase already in progress', {
        description: 'Please resolve the current rebase before starting a new one.'
      })
      break
    case 'VALIDATION_FAILED':
    case 'BRANCH_NOT_FOUND':
    case 'GIT_ADAPTER_UNSUPPORTED':
    case 'GENERIC':
    default:
      toast.error(`${operationName} failed`, {
        description: error instanceof Error ? error.message : String(error)
      })
  }
}

function getSquashErrorMessage(error?: SquashBlocker, detail?: string): string {
  switch (error) {
    case 'no_parent':
      return 'Cannot squash: this branch has no parent'
    case 'not_linear':
      return 'Cannot squash: stack is not linear'
    case 'ancestry_mismatch':
      return 'Cannot squash: parent changed, restack first'
    case 'dirty_tree':
      return detail ? `Cannot squash: ${detail}` : 'Cannot squash: working tree is dirty'
    case 'rebase_in_progress':
      return 'Cannot squash: a rebase is already in progress'
    case 'parent_is_trunk':
      return 'Cannot squash: parent branch is trunk'
    case 'is_trunk':
      return 'Cannot squash trunk branches'
    case 'conflict':
      return 'Cannot squash: changes conflict with parent'
    case 'descendant_conflict':
      return 'Cannot squash: descendant rebase conflicted'
    case 'push_failed':
      return detail ? `Push failed: ${detail}` : 'Push failed'
    case 'worktree_conflict':
      return detail ? detail : 'Cannot squash: branch is checked out in another worktree'
    default:
      return 'Squash failed'
  }
}
