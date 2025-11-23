import type { UiState } from '@shared/types'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useGitWatcher } from '../hooks/use-git-watcher'

interface UiStateContextValue {
  toggleTheme: () => void
  isDark: boolean
  uiState: UiState | null
  setFilesStageStatus: (params: { staged: boolean; files: string[] }) => Promise<void>
  commit: (params: { message: string }) => Promise<void>
  amend: (params: { message: string }) => Promise<void>
  discardStaged: () => Promise<void>
  submitRebaseIntent: (params: { headSha: string; baseSha: string }) => Promise<void>
  confirmRebaseIntent: () => Promise<void>
  cancelRebaseIntent: () => Promise<void>
  checkout: (params: { ref: string }) => Promise<void>
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

  const refreshRepo = useCallback(async () => {
    if (!repoPath) {
      setUiState(null)
      return
    }

    const uiState = await window.api.getRepo({ repoPath })
    if (uiState) {
      setUiState(uiState)
    }
  }, [repoPath])

  useEffect(() => {
    refreshRepo()
  }, [refreshRepo])

  useEffect(() => {
    window.addEventListener('focus', refreshRepo)
    return () => window.removeEventListener('focus', refreshRepo)
  }, [refreshRepo])

  useGitWatcher({ repoPath, onRepoChange: refreshRepo })

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
    const newUiState = await apiCall
    if (newUiState) setUiState(newUiState)
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
    async (params: { message: string }) => {
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

  const checkout = useCallback(
    async (params: { ref: string }) => {
      if (!repoPath) return
      await callApi(window.api.checkout({ repoPath, ...params }))
    },
    [repoPath, callApi]
  )

  return (
    <UiStateContext.Provider
      value={{
        toggleTheme,
        isDark,
        uiState,
        setFilesStageStatus,
        commit,
        amend,
        discardStaged,
        submitRebaseIntent,
        confirmRebaseIntent,
        cancelRebaseIntent,
        checkout
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
