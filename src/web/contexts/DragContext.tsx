import type { UiStack, UiState } from '@shared/types'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import {
  captureCommitBoundingBoxes,
  findClosestCommitBelowMouse,
  type CommitBoundingBox
} from '../utils/dragging'
import { throttle } from '../utils/throttle'
import { useUiStateContext } from './UiStateContext'

interface PrefetchedIntent {
  headSha: string
  baseSha: string
  generation: number
  result: UiState | null
}

interface DragState {
  potentialDragSha: string | null
  activeDragSha: string | null
  frozenBoundingBoxes: CommitBoundingBox[]
}

interface PrefetchState {
  generation: number
  prefetched: PrefetchedIntent | null
}

interface DragContextValue {
  draggingCommitSha: string | null
  commitBelowMouse: string | null
  mousePosition: { x: number; y: number } | null
  draggedBranchCount: number
  registerCommitRef: (sha: string, ref: RefObject<HTMLDivElement>) => void
  unregisterCommitRef: (sha: string) => void
  handleCommitDotMouseDown: (sha: string) => void
}

const DragContext = createContext<DragContextValue | undefined>(undefined)

export function DragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { uiState, prefetchRebaseIntent, applyPrefetchedState, isWorkingTreeDirty } =
    useUiStateContext()

  const [draggingCommitSha, setDraggingCommitSha] = useState<string | null>(null)
  const [commitBelowMouse, setCommitBelowMouse] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null)

  const dragState = useRef<DragState>({
    potentialDragSha: null,
    activeDragSha: null,
    frozenBoundingBoxes: []
  })

  const prefetchState = useRef<PrefetchState>({
    generation: 0,
    prefetched: null
  })

  const commitRefsMap = useRef<Map<string, RefObject<HTMLDivElement>>>(new Map())

  const registerCommitRef = (sha: string, ref: RefObject<HTMLDivElement>): void => {
    commitRefsMap.current.set(sha, ref)
  }

  const unregisterCommitRef = (sha: string): void => {
    commitRefsMap.current.delete(sha)
  }

  const handleCommitDotMouseDown = (sha: string): void => {
    if (isWorkingTreeDirty) return
    dragState.current.potentialDragSha = sha
  }

  // Mouse event handlers for drag operation
  useEffect(() => {
    const stack = uiState?.stack
    if (!stack) return

    const maybeStartDrag = (e: MouseEvent): boolean => {
      const state = dragState.current
      if (!state.potentialDragSha || state.activeDragSha) return false

      state.frozenBoundingBoxes = captureCommitBoundingBoxes(commitRefsMap.current, stack)
      state.activeDragSha = state.potentialDragSha
      setDraggingCommitSha(state.potentialDragSha)
      setMousePosition({ x: e.clientX, y: e.clientY })
      return true
    }

    const updateDropTarget = (e: MouseEvent): void => {
      const { activeDragSha, frozenBoundingBoxes } = dragState.current
      if (!activeDragSha) return

      setMousePosition({ x: e.clientX, y: e.clientY })
      if (frozenBoundingBoxes.length > 0) {
        setCommitBelowMouse(findClosestCommitBelowMouse(e.clientY, frozenBoundingBoxes))
      }
    }

    const getValidPrefetch = (headSha: string, baseSha: string): UiState | null => {
      const { generation, prefetched } = prefetchState.current
      if (!prefetched) return null
      if (prefetched.headSha !== headSha || prefetched.baseSha !== baseSha) return null
      if (prefetched.generation !== generation) return null
      return prefetched.result
    }

    const commitDrop = (headSha: string, baseSha: string): void => {
      const cached = getValidPrefetch(headSha, baseSha)
      if (cached) {
        applyPrefetchedState(cached)
        return
      }
      prefetchRebaseIntent({ headSha, baseSha }).then((result) => {
        if (result) applyPrefetchedState(result)
      })
    }

    const resetDragState = (): void => {
      const state = dragState.current
      const pState = prefetchState.current

      state.activeDragSha = null
      state.potentialDragSha = null
      state.frozenBoundingBoxes = []
      pState.generation++
      pState.prefetched = null

      setDraggingCommitSha(null)
      setCommitBelowMouse(null)
      setMousePosition(null)
    }

    const handleMouseMove = (e: MouseEvent): void => {
      maybeStartDrag(e)
      updateDropTarget(e)
    }

    const handleMouseUp = (e: MouseEvent): void => {
      const { activeDragSha, frozenBoundingBoxes } = dragState.current
      if (!activeDragSha) {
        dragState.current.potentialDragSha = null
        return
      }

      const dropTarget = findClosestCommitBelowMouse(e.clientY, frozenBoundingBoxes)
      if (dropTarget) {
        commitDrop(activeDragSha, dropTarget)
      }
      resetDragState()
    }

    const throttledMouseMove = throttle(handleMouseMove, 50)
    window.addEventListener('mousemove', throttledMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', throttledMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [uiState?.stack, prefetchRebaseIntent, applyPrefetchedState])

  // Prefetch rebase intent when hover target changes during drag
  useEffect(() => {
    if (!draggingCommitSha || !commitBelowMouse) return

    const pState = prefetchState.current
    const currentGen = pState.generation

    prefetchRebaseIntent({ headSha: draggingCommitSha, baseSha: commitBelowMouse }).then(
      (result) => {
        if (pState.generation !== currentGen) return
        pState.prefetched = {
          headSha: draggingCommitSha,
          baseSha: commitBelowMouse,
          generation: currentGen,
          result
        }
      }
    )
  }, [draggingCommitSha, commitBelowMouse, prefetchRebaseIntent])

  // Hide cursor during drag
  useEffect(() => {
    if (!draggingCommitSha) return
    document.body.style.cursor = 'none'
    return () => {
      document.body.style.cursor = ''
    }
  }, [draggingCommitSha])

  const draggedBranchCount = useMemo(() => {
    if (!draggingCommitSha || !uiState?.stack) return 0
    return countBranchesFromCommit(draggingCommitSha, uiState.stack)
  }, [draggingCommitSha, uiState?.stack])

  return (
    <DragContext.Provider
      value={{
        draggingCommitSha,
        commitBelowMouse,
        mousePosition,
        draggedBranchCount,
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
  if (!context) throw new Error('useDragContext must be used within a DragProvider')
  return context
}

// --- Branch counting utilities ---

function countBranchesFromCommit(targetSha: string, stack: UiStack): number {
  return findAndCountBranches(targetSha, stack) ?? 0
}

function findAndCountBranches(targetSha: string, stack: UiStack): number | null {
  const idx = stack.commits.findIndex((c) => c.sha === targetSha)
  if (idx !== -1) return countBranchesFromIndex(stack, idx)

  for (const commit of stack.commits) {
    for (const spinoff of commit.spinoffs) {
      const count = findAndCountBranches(targetSha, spinoff)
      if (count !== null) return count
    }
  }
  return null
}

function countBranchesFromIndex(stack: UiStack, startIdx: number): number {
  let count = 0
  for (let i = startIdx; i < stack.commits.length; i++) {
    const commit = stack.commits[i]
    count += commit.branches.length
    count += commit.spinoffs.reduce((sum, s) => sum + countAllBranches(s), 0)
  }
  return count
}

function countAllBranches(stack: UiStack): number {
  return stack.commits.reduce((count, commit) => {
    return (
      count +
      commit.branches.length +
      commit.spinoffs.reduce((sum, s) => sum + countAllBranches(s), 0)
    )
  }, 0)
}
