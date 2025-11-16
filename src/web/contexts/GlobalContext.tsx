import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
  type RefObject
} from 'react'
import type { UiStack, UiState } from '@shared/types'
import { throttle } from '../utils/throttle'
import { getUiCommitBySha } from '../utils/stack-utils'

/**
 * Finds the closest commit below the mouse cursor.
 */
function findClosestCommitBelowMouse(
  mouseY: number,
  commitRefsMap: Map<string, RefObject<HTMLDivElement>>,
  stacks: UiStack
): string | null {
  let closestSha: string | null = null
  let closestDistance = Infinity

  for (const [sha, ref] of commitRefsMap.entries()) {
    const commit = getUiCommitBySha(stacks, sha)
    if (!commit) continue
    if (commit.rebaseStatus) continue // Skip commits under planning

    const element = ref.current
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const commitCenterY = rect.top + rect.height / 2

    // Only consider commits that are below the mouse
    if (commitCenterY > mouseY) {
      const distance = commitCenterY - mouseY
      if (distance < closestDistance) {
        closestDistance = distance
        closestSha = sha
      }
    }
  }

  return closestSha
}

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

  useEffect(() => {
    const uiState = window.api.getRepo()
    setUiState(uiState)
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

    const newUiState = window.api.submitRebaseIntent({
      headSha: draggingCommitSha,
      baseSha: commitBelowMouse
    })

    setUiState(newUiState)
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
