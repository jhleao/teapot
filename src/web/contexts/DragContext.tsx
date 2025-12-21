import type { UiStack } from '@shared/types'
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

interface DragState {
  potentialDragSha: string | null
  originalParentSha: string | null
  frozenBoundingBoxes: CommitBoundingBox[]
}

interface PendingRebase {
  headSha: string
  baseSha: string
  draggedBranchCount: number
  targetBranchName: string
  cursorPosition: { x: number; y: number }
}

interface DragContextValue {
  draggingCommitSha: string | null
  commitBelowMouse: string | null
  mousePosition: { x: number; y: number } | null
  draggedBranchCount: number
  /** Branch name of hovered commit, or short SHA if no branch */
  targetLabel: string | null
  isRebaseLoading: boolean
  pendingRebase: PendingRebase | null
  registerCommitRef: (sha: string, ref: RefObject<HTMLDivElement>) => void
  unregisterCommitRef: (sha: string) => void
  handleCommitDotMouseDown: (sha: string) => void
}

const DragContext = createContext<DragContextValue | undefined>(undefined)

export function DragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { uiState, submitRebaseIntent, isWorkingTreeDirty } = useUiStateContext()

  const [draggingCommitSha, setDraggingCommitSha] = useState<string | null>(null)
  const [commitBelowMouse, setCommitBelowMouse] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null)
  const [isRebaseLoading, setIsRebaseLoading] = useState(false)
  const [pendingRebase, setPendingRebase] = useState<PendingRebase | null>(null)

  const dragState = useRef<DragState>({
    potentialDragSha: null,
    originalParentSha: null,
    frozenBoundingBoxes: []
  })

  const commitRefsMap = useRef<Map<string, RefObject<HTMLDivElement>>>(new Map())

  const registerCommitRef = (sha: string, ref: RefObject<HTMLDivElement>): void => {
    commitRefsMap.current.set(sha, ref)
  }

  const unregisterCommitRef = (sha: string): void => {
    commitRefsMap.current.delete(sha)
  }

  const handleCommitDotMouseDown = (sha: string): void => {
    if (isWorkingTreeDirty || isRebaseLoading) return
    dragState.current.potentialDragSha = sha
  }

  // Mouse event handlers for drag operation
  useEffect(() => {
    const stack = uiState?.stack
    if (!stack) return

    const maybeStartDrag = (e: MouseEvent): void => {
      const state = dragState.current
      if (!state.potentialDragSha || draggingCommitSha) return

      state.frozenBoundingBoxes = captureCommitBoundingBoxes(commitRefsMap.current, stack)
      state.originalParentSha = findParentCommitSha(state.potentialDragSha, stack)
      setDraggingCommitSha(state.potentialDragSha)
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    const updateDropTarget = (e: MouseEvent): void => {
      if (!draggingCommitSha) return

      const { frozenBoundingBoxes, originalParentSha } = dragState.current
      setMousePosition({ x: e.clientX, y: e.clientY })

      if (frozenBoundingBoxes.length > 0) {
        const candidate = findClosestCommitBelowMouse(e.clientY, frozenBoundingBoxes)
        // Exclude the dragged commit itself and its original parent
        if (candidate && candidate !== draggingCommitSha && candidate !== originalParentSha) {
          setCommitBelowMouse(candidate)
        } else {
          setCommitBelowMouse(null)
        }
      }
    }

    const commitDrop = (
      headSha: string,
      baseSha: string,
      branchCount: number,
      cursorPos: { x: number; y: number }
    ): void => {
      const targetBranchName = findBranchNameForCommit(baseSha, stack)
      setIsRebaseLoading(true)
      setPendingRebase({
        headSha,
        baseSha,
        draggedBranchCount: branchCount,
        targetBranchName: targetBranchName ?? baseSha.slice(0, 7),
        cursorPosition: cursorPos
      })
      submitRebaseIntent({ headSha, baseSha }).finally(() => {
        setIsRebaseLoading(false)
        setPendingRebase(null)
      })
    }

    const resetDragState = (): void => {
      const state = dragState.current
      state.potentialDragSha = null
      state.originalParentSha = null
      state.frozenBoundingBoxes = []

      setDraggingCommitSha(null)
      setCommitBelowMouse(null)
      setMousePosition(null)
    }

    const handleMouseMove = (e: MouseEvent): void => {
      maybeStartDrag(e)
      updateDropTarget(e)
    }

    const handleMouseUp = (e: MouseEvent): void => {
      if (!draggingCommitSha) {
        dragState.current.potentialDragSha = null
        return
      }

      const { frozenBoundingBoxes, originalParentSha } = dragState.current
      const candidate = findClosestCommitBelowMouse(e.clientY, frozenBoundingBoxes)
      // Only commit if dropping on a valid target (not self, not original parent)
      if (candidate && candidate !== draggingCommitSha && candidate !== originalParentSha) {
        const branchCount = countBranchesFromCommit(draggingCommitSha, stack)
        commitDrop(draggingCommitSha, candidate, branchCount, { x: e.clientX, y: e.clientY })
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
  }, [uiState?.stack, submitRebaseIntent, draggingCommitSha])

  // Hide cursor during drag or loading
  useEffect(() => {
    if (!draggingCommitSha && !isRebaseLoading) return
    document.body.style.cursor = 'none'
    return () => {
      document.body.style.cursor = ''
    }
  }, [draggingCommitSha, isRebaseLoading])

  // Track mouse position during loading state
  useEffect(() => {
    if (!isRebaseLoading) return

    const handleMouseMove = (e: MouseEvent): void => {
      setPendingRebase((prev) =>
        prev ? { ...prev, cursorPosition: { x: e.clientX, y: e.clientY } } : null
      )
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [isRebaseLoading])

  const draggedBranchCount = useMemo(() => {
    if (!draggingCommitSha || !uiState?.stack) return 0
    return countBranchesFromCommit(draggingCommitSha, uiState.stack)
  }, [draggingCommitSha, uiState?.stack])

  const targetLabel = useMemo(() => {
    if (!commitBelowMouse || !uiState?.stack) return null
    const branchName = findBranchNameForCommit(commitBelowMouse, uiState.stack)
    return branchName ?? commitBelowMouse.slice(0, 7)
  }, [commitBelowMouse, uiState?.stack])

  return (
    <DragContext.Provider
      value={{
        draggingCommitSha,
        commitBelowMouse,
        mousePosition,
        draggedBranchCount,
        targetLabel,
        isRebaseLoading,
        pendingRebase,
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

// --- Stack traversal utilities ---

interface CommitContext {
  commit: UiStack['commits'][number]
  index: number
  stack: UiStack
  parentSha: string | null
}

function findCommitInStack(
  targetSha: string,
  stack: UiStack,
  parentSha: string | null = null
): CommitContext | null {
  for (let i = 0; i < stack.commits.length; i++) {
    const commit = stack.commits[i]
    if (commit.sha === targetSha) {
      return {
        commit,
        index: i,
        stack,
        parentSha: i > 0 ? stack.commits[i - 1].sha : parentSha
      }
    }
    for (const spinoff of commit.spinoffs) {
      const found = findCommitInStack(targetSha, spinoff, commit.sha)
      if (found) return found
    }
  }
  return null
}

function findParentCommitSha(targetSha: string, stack: UiStack): string | null {
  return findCommitInStack(targetSha, stack)?.parentSha ?? null
}

function findBranchNameForCommit(targetSha: string, stack: UiStack): string | null {
  const ctx = findCommitInStack(targetSha, stack)
  if (!ctx) return null
  const nonTrunk = ctx.commit.branches.find((b) => !b.isTrunk)
  return nonTrunk?.name ?? ctx.commit.branches[0]?.name ?? null
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

function countBranchesFromCommit(targetSha: string, stack: UiStack): number {
  const ctx = findCommitInStack(targetSha, stack)
  if (!ctx) return 0

  let count = 0
  for (let i = ctx.index; i < ctx.stack.commits.length; i++) {
    const commit = ctx.stack.commits[i]
    count += commit.branches.length
    count += commit.spinoffs.reduce((sum, s) => sum + countAllBranches(s), 0)
  }
  return count
}
