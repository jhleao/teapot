import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
  type RefObject
} from 'react'
import type { UiState } from '@shared/types'
import { throttle } from '../utils/throttle'
import { findClosestCommitBelowMouse } from '../utils/dragging'

interface GlobalContextValue {
  toggleTheme: () => void
  draggingCommitSha: string | null
  setDraggingCommitSha: (sha: string | null) => void
  commitBelowMouse: string | null
  registerCommitRef: (sha: string, ref: RefObject<HTMLDivElement>) => void
  unregisterCommitRef: (sha: string) => void
  uiState: UiState | null
}

const GlobalContext = createContext<GlobalContextValue | undefined>(undefined)

export function GlobalProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isDark, setIsDark] = useState(true)
  const [draggingCommitSha, setDraggingCommitSha] = useState<string | null>(null)
  const [commitBelowMouse, setCommitBelowMouse] = useState<string | null>(null)
  const [uiState, setUiState] = useState<UiState | null>(null)

  console.log('hello')
  useEffect(() => {
    ;(async () => {
      const uiState = await window.api.getRepo()
      setUiState(uiState)
    })()
  }, [])

  const commitRefsMap = useRef<Map<string, RefObject<HTMLDivElement>>>(new Map())
  const unregisterCommitRef = (sha: string) => commitRefsMap.current.delete(sha)
  const registerCommitRef = (sha: string, ref: RefObject<HTMLDivElement>) =>
    commitRefsMap.current.set(sha, ref)

  useEffect(() => {
    const html = document.documentElement
    if (isDark) html.classList.add('dark')
    else html.classList.remove('dark')
  }, [isDark])

  // Handle mousemove when dragging
  useEffect(() => {
    if (!draggingCommitSha) {
      setCommitBelowMouse(null)
      return
    }

    const handleMouseMove = (e: MouseEvent): void => {
      const stacks = uiState?.stack
      if (!stacks) return
      const { clientY } = e
      const closestSha = findClosestCommitBelowMouse(clientY, commitRefsMap.current, stacks)
      setCommitBelowMouse(closestSha)
    }

    const throttledMouseMove = throttle(handleMouseMove, 50)

    window.addEventListener('mousemove', throttledMouseMove)

    return () => {
      window.removeEventListener('mousemove', throttledMouseMove)
    }
  }, [draggingCommitSha, uiState?.stack])

  useEffect(() => {
    if (!draggingCommitSha || !commitBelowMouse || !uiState) return

    window.api
      .submitRebaseIntent({
        headSha: draggingCommitSha,
        baseSha: commitBelowMouse
      })
      .then((newUiState) => {
        setUiState(newUiState)
      })
  }, [commitBelowMouse, draggingCommitSha, uiState])

  const toggleTheme = (): void => {
    setIsDark((prev) => !prev)
  }

  return (
    <GlobalContext.Provider
      value={{
        toggleTheme,
        draggingCommitSha,
        setDraggingCommitSha,
        commitBelowMouse,
        registerCommitRef,
        unregisterCommitRef,
        uiState
      }}
    >
      {children}
    </GlobalContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGlobalCtx(): GlobalContextValue {
  const context = useContext(GlobalContext)
  if (context === undefined) {
    throw new Error('useGlobalCtx must be used within a GlobalProvider')
  }
  return context
}
