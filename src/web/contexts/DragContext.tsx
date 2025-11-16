import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { findClosestCommitBelowMouse } from '../utils/dragging'
import { throttle } from '../utils/throttle'
import { useUiStateContext } from './UiStateContext'

interface DragContextValue {
  draggingCommitSha: string | null
  setDraggingCommitSha: (sha: string | null) => void
  commitBelowMouse: string | null
  registerCommitRef: (sha: string, ref: RefObject<HTMLDivElement>) => void
  unregisterCommitRef: (sha: string) => void
  handleCommitDotMouseDown: (sha: string) => void
}

const DragContext = createContext<DragContextValue | undefined>(undefined)

export function DragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { uiState, submitRebaseIntent } = useUiStateContext()
  const [draggingCommitSha, setDraggingCommitSha] = useState<string | null>(null)
  const [commitBelowMouse, setCommitBelowMouse] = useState<string | null>(null)

  const potentialDragSha = useRef<string | null>(null)
  const draggingCommitShaRef = useRef<string | null>(null)

  const commitRefsMap = useRef<Map<string, RefObject<HTMLDivElement>>>(new Map())
  const unregisterCommitRef = (sha: string) => commitRefsMap.current.delete(sha)
  const registerCommitRef = (sha: string, ref: RefObject<HTMLDivElement>) =>
    commitRefsMap.current.set(sha, ref)

  // Keep ref in sync with state
  useEffect(() => {
    draggingCommitShaRef.current = draggingCommitSha
  }, [draggingCommitSha])

  // Handle mousedown on commit dot - prepare for potential drag
  const handleCommitDotMouseDown = (sha: string): void => {
    potentialDragSha.current = sha
  }

  // Handle mousemove to start drag if mousedown happened
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      // If we have a potential drag and haven't started dragging yet, start dragging
      if (potentialDragSha.current && !draggingCommitShaRef.current) {
        setDraggingCommitSha(potentialDragSha.current)
      }

      // If we're already dragging, update commit below mouse
      if (draggingCommitShaRef.current) {
        const stacks = uiState?.stack
        if (!stacks) return
        const { clientY } = e
        const closestSha = findClosestCommitBelowMouse(clientY, commitRefsMap.current, stacks)
        setCommitBelowMouse(closestSha)
      }
    }

    const handleMouseUp = (): void => {
      // Stop dragging on mouseup
      if (draggingCommitShaRef.current) {
        setDraggingCommitSha(null)
        setCommitBelowMouse(null)
      }
      // Clear potential drag
      potentialDragSha.current = null
    }

    const throttledMouseMove = throttle(handleMouseMove, 50)

    window.addEventListener('mousemove', throttledMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', throttledMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [uiState?.stack])

  // Clear commit below mouse when dragging stops
  useEffect(() => {
    if (!draggingCommitSha) {
      setCommitBelowMouse(null)
    }
  }, [draggingCommitSha])

  // Handle rebase intent when dragging completes
  useEffect(() => {
    if (!draggingCommitSha || !commitBelowMouse || !uiState) return

    submitRebaseIntent({
      headSha: draggingCommitSha,
      baseSha: commitBelowMouse
    })
  }, [commitBelowMouse, draggingCommitSha, uiState, submitRebaseIntent])

  return (
    <DragContext.Provider
      value={{
        draggingCommitSha,
        setDraggingCommitSha,
        commitBelowMouse,
        registerCommitRef,
        unregisterCommitRef,
        handleCommitDotMouseDown
      }}
    >
      {children}
    </DragContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDragContext(): DragContextValue {
  const context = useContext(DragContext)
  if (context === undefined) {
    throw new Error('useDragContext must be used within a DragProvider')
  }
  return context
}
