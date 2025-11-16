import type { UiState } from '@shared/types'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

interface UiStateContextValue {
  toggleTheme: () => void
  uiState: UiState | null
  setUiState: (newUiState: UiState) => void
}

const UiStateContext = createContext<UiStateContextValue | undefined>(undefined)

export function UiStateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isDark, setIsDark] = useState(true)
  const [uiState, setUiState] = useState<UiState | null>(null)

  console.log(uiState)

  useEffect(() => {
    ;(async () => {
      const uiState = await window.api.getRepo()
      setUiState(uiState)
    })()
  }, [])

  useEffect(() => {
    const html = document.documentElement
    if (isDark) html.classList.add('dark')
    else html.classList.remove('dark')
  }, [isDark])

  const toggleTheme = (): void => {
    setIsDark((prev) => !prev)
  }

  const handleSetUiState = useCallback((newUiState: UiState) => {
    setUiState(newUiState)
  }, [])

  return (
    <UiStateContext.Provider
      value={{
        toggleTheme,
        uiState,
        setUiState: handleSetUiState
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
