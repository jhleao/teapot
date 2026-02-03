import { log } from '@shared/logger'
import type { UiStack } from '@shared/types'
import {
  createContext,
  useCallback,
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
import { useScrollViewport } from './ScrollViewportContext'
import { useUiStateContext } from './UiStateContext'

// Auto-scroll configuration
const AUTO_SCROLL_EDGE_THRESHOLD = 60 // pixels from edge to trigger scroll
const AUTO_SCROLL_MAX_SPEED = 15 // max pixels per frame

interface DragState {
  potentialDragSha: string | null
  originalParentSha: string | null
  frozenBoundingBoxes: CommitBoundingBox[]
  initialScrollTop: number
  forbiddenDropTargets: Set<string>
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
  draggedBranchCount: number
  /** Branch name of hovered commit, or short SHA if no branch */
  targetLabel: string | null
  isRebaseLoading: boolean
  pendingRebase: PendingRebase | null
  registerCommitRef: (sha: string, ref: RefObject<HTMLDivElement>) => void
  unregisterCommitRef: (sha: string) => void
  handleCommitDotMouseDown: (sha: string, e: React.MouseEvent) => void
}

const DragContext = createContext<DragContextValue | undefined>(undefined)

export function DragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { uiState, submitRebaseIntent } = useUiStateContext()
  const { viewportRef } = useScrollViewport()

  const [draggingCommitSha, setDraggingCommitSha] = useState<string | null>(null)
  const [commitBelowMouse, setCommitBelowMouse] = useState<string | null>(null)
  const [isRebaseLoading, setIsRebaseLoading] = useState(false)
  const [pendingRebase, setPendingRebase] = useState<PendingRebase | null>(null)

  const dragState = useRef<DragState>({
    potentialDragSha: null,
    originalParentSha: null,
    frozenBoundingBoxes: [],
    initialScrollTop: 0,
    forbiddenDropTargets: new Set()
  })

  // Auto-scroll state
  const autoScrollRAF = useRef<number | null>(null)
  const lastMouseY = useRef<number>(0)

  const commitRefsMap = useRef<Map<string, RefObject<HTMLDivElement>>>(new Map())

  const registerCommitRef = useCallback((sha: string, ref: RefObject<HTMLDivElement>): void => {
    commitRefsMap.current.set(sha, ref)
  }, [])

  const unregisterCommitRef = useCallback((sha: string): void => {
    commitRefsMap.current.delete(sha)
  }, [])

  const handleCommitDotMouseDown = useCallback(
    (sha: string, e: React.MouseEvent): void => {
      if (e.button !== 0) return // Only left-click initiates drag
      // Parallel mode allows rebasing with dirty worktree, only check loading state
      if (isRebaseLoading) return

      // Don't allow dragging commits without branches
      const stack = uiState?.stack
      if (!stack) return
      const ctx = findCommitInStack(sha, stack)
      if (!ctx || ctx.commit.branches.length === 0) return

      dragState.current.potentialDragSha = sha
    },
    [isRebaseLoading, uiState?.stack]
  )

  // Auto-scroll function for edge detection
  const performAutoScroll = useCallback((): void => {
    const viewport = viewportRef.current
    if (!viewport || !draggingCommitSha) {
      autoScrollRAF.current = null
      return
    }

    const viewportRect = viewport.getBoundingClientRect()
    const mouseY = lastMouseY.current

    // Calculate distance from edges
    const distanceFromTop = mouseY - viewportRect.top
    const distanceFromBottom = viewportRect.bottom - mouseY

    let scrollAmount = 0

    if (distanceFromTop < AUTO_SCROLL_EDGE_THRESHOLD) {
      // Near or past top edge - scroll up (negative)
      // Use max speed if past the edge, proportional speed if within threshold
      const proximity = distanceFromTop <= 0 ? 1 : 1 - distanceFromTop / AUTO_SCROLL_EDGE_THRESHOLD
      scrollAmount = -AUTO_SCROLL_MAX_SPEED * proximity
    } else if (distanceFromBottom < AUTO_SCROLL_EDGE_THRESHOLD) {
      // Near or past bottom edge - scroll down (positive)
      const proximity =
        distanceFromBottom <= 0 ? 1 : 1 - distanceFromBottom / AUTO_SCROLL_EDGE_THRESHOLD
      scrollAmount = AUTO_SCROLL_MAX_SPEED * proximity
    }

    if (scrollAmount !== 0) {
      viewport.scrollBy(0, scrollAmount)
      // Continue auto-scroll loop
      autoScrollRAF.current = requestAnimationFrame(performAutoScroll)
    } else {
      autoScrollRAF.current = null
    }
  }, [draggingCommitSha, viewportRef])

  // Stop auto-scroll when drag ends
  useEffect(() => {
    if (!draggingCommitSha && autoScrollRAF.current !== null) {
      cancelAnimationFrame(autoScrollRAF.current)
      autoScrollRAF.current = null
    }
  }, [draggingCommitSha])

  // Mouse event handlers for drag operation
  useEffect(() => {
    const stack = uiState?.stack
    if (!stack) return

    const maybeStartDrag = (): void => {
      const state = dragState.current
      if (!state.potentialDragSha || draggingCommitSha) return

      const captured = captureCommitBoundingBoxes(commitRefsMap.current, stack, viewportRef.current)
      state.frozenBoundingBoxes = captured.boundingBoxes
      state.initialScrollTop = captured.initialScrollTop
      log.debug('[DragContext.maybeStartDrag] Captured drag state', {
        sha: state.potentialDragSha?.slice(0, 8),
        boundingBoxCount: captured.boundingBoxes.length,
        initialScrollTop: captured.initialScrollTop
      })
      state.originalParentSha = findParentCommitSha(state.potentialDragSha, stack)
      state.forbiddenDropTargets = collectDescendantShas(state.potentialDragSha, stack)
      setDraggingCommitSha(state.potentialDragSha)
    }

    const updateDropTarget = (e: MouseEvent): void => {
      if (!draggingCommitSha) return

      const { frozenBoundingBoxes, originalParentSha, forbiddenDropTargets, initialScrollTop } =
        dragState.current
      const currentScrollTop = viewportRef.current?.scrollTop ?? 0

      if (frozenBoundingBoxes.length > 0) {
        const candidate = findClosestCommitBelowMouse(
          e.clientY,
          frozenBoundingBoxes,
          initialScrollTop,
          currentScrollTop
        )
        // Exclude: dragged commit itself, original parent, and any descendants (can't rebase onto a child)
        if (
          candidate &&
          candidate !== draggingCommitSha &&
          candidate !== originalParentSha &&
          !forbiddenDropTargets.has(candidate)
        ) {
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
      const sourceBranchName = findBranchNameForCommit(headSha, stack)
      const originalParent = dragState.current.originalParentSha
      log.debug('[DragContext.commitDrop] Dropping commit', {
        headSha: headSha.slice(0, 8),
        baseSha: baseSha.slice(0, 8),
        sourceBranch: sourceBranchName,
        targetBranch: targetBranchName,
        originalParentSha: originalParent?.slice(0, 8),
        branchCount
      })
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
      state.initialScrollTop = 0
      state.forbiddenDropTargets = new Set()

      setDraggingCommitSha(null)
      setCommitBelowMouse(null)
    }

    const handleMouseMove = (e: MouseEvent): void => {
      maybeStartDrag()
      updateDropTarget(e)

      // Update last mouse position for auto-scroll
      lastMouseY.current = e.clientY

      // Start auto-scroll if not already running and we're dragging
      if (draggingCommitSha && autoScrollRAF.current === null) {
        autoScrollRAF.current = requestAnimationFrame(performAutoScroll)
      }
    }

    const handleMouseUp = (e: MouseEvent): void => {
      // Stop auto-scroll
      if (autoScrollRAF.current !== null) {
        cancelAnimationFrame(autoScrollRAF.current)
        autoScrollRAF.current = null
      }

      if (!draggingCommitSha) {
        dragState.current.potentialDragSha = null
        return
      }

      const { frozenBoundingBoxes, originalParentSha, forbiddenDropTargets, initialScrollTop } =
        dragState.current
      const currentScrollTop = viewportRef.current?.scrollTop ?? 0
      const candidate = findClosestCommitBelowMouse(
        e.clientY,
        frozenBoundingBoxes,
        initialScrollTop,
        currentScrollTop
      )
      // Only commit if dropping on a valid target (not self, not original parent, not a descendant)
      if (
        candidate &&
        candidate !== draggingCommitSha &&
        candidate !== originalParentSha &&
        !forbiddenDropTargets.has(candidate)
      ) {
        const branchCount = countBranchesFromCommit(draggingCommitSha, stack)
        commitDrop(draggingCommitSha, candidate, branchCount, { x: e.clientX, y: e.clientY })
      }
      resetDragState()
    }

    let rafId: number | null = null
    let lastEvent: MouseEvent | null = null

    const rafMouseMove = (e: MouseEvent): void => {
      lastEvent = e
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (lastEvent) handleMouseMove(lastEvent)
      })
    }

    window.addEventListener('mousemove', rafMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', rafMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (rafId !== null) cancelAnimationFrame(rafId)
      // Note: Don't cancel autoScrollRAF here. Let it continue until handleMouseUp
      // or cursor moves away from edge. Cancelling on effect re-runs (e.g., when
      // uiState?.stack updates) causes freezes since no mouse move restarts it.
    }
  }, [uiState?.stack, submitRebaseIntent, draggingCommitSha, viewportRef, performAutoScroll])

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

  // Show/hide drop indicator via direct DOM manipulation (avoids CommitView re-renders)
  useEffect(() => {
    const targetElement = commitBelowMouse
      ? document.querySelector(`[data-commit-sha="${commitBelowMouse}"] .drop-indicator`)
      : null

    if (targetElement instanceof HTMLElement) {
      targetElement.classList.remove('hidden')
      targetElement.classList.add('animate-in')
    }

    return () => {
      if (targetElement instanceof HTMLElement) {
        targetElement.classList.add('hidden')
        targetElement.classList.remove('animate-in')
      }
    }
  }, [commitBelowMouse])

  const draggedBranchCount = useMemo(() => {
    if (!draggingCommitSha || !uiState?.stack) return 0
    return countBranchesFromCommit(draggingCommitSha, uiState.stack)
  }, [draggingCommitSha, uiState?.stack])

  const targetLabel = useMemo(() => {
    if (!commitBelowMouse || !uiState?.stack) return null
    const branchName = findBranchNameForCommit(commitBelowMouse, uiState.stack)
    return branchName ?? commitBelowMouse.slice(0, 7)
  }, [commitBelowMouse, uiState?.stack])

  const contextValue = useMemo<DragContextValue>(
    () => ({
      draggingCommitSha,
      draggedBranchCount,
      targetLabel,
      isRebaseLoading,
      pendingRebase,
      registerCommitRef,
      unregisterCommitRef,
      handleCommitDotMouseDown
    }),
    [
      draggingCommitSha,
      draggedBranchCount,
      targetLabel,
      isRebaseLoading,
      pendingRebase,
      registerCommitRef,
      unregisterCommitRef,
      handleCommitDotMouseDown
    ]
  )

  return <DragContext.Provider value={contextValue}>{children}</DragContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDragContext(): DragContextValue {
  const context = useContext(DragContext)
  if (context === undefined) {
    throw new Error('useDragContext must be used within a DragProvider')
  }
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

/** Collect all SHAs in a stack (recursively includes spinoffs) */
function collectAllShasInStack(stack: UiStack, result: Set<string>): void {
  for (const commit of stack.commits) {
    result.add(commit.sha)
    for (const spinoff of commit.spinoffs) {
      collectAllShasInStack(spinoff, result)
    }
  }
}

/** Collect all descendant SHAs of a commit (children at any level) */
function collectDescendantShas(targetSha: string, stack: UiStack): Set<string> {
  const result = new Set<string>()
  const ctx = findCommitInStack(targetSha, stack)
  if (!ctx) return result

  // Include all commits after the target in the same sub-stack (direct descendants)
  // and all their spinoffs (branch descendants)
  for (let i = ctx.index + 1; i < ctx.stack.commits.length; i++) {
    const commit = ctx.stack.commits[i]
    result.add(commit.sha)
    for (const spinoff of commit.spinoffs) {
      collectAllShasInStack(spinoff, result)
    }
  }

  // Also include spinoffs of the target commit itself (they are children too)
  for (const spinoff of ctx.commit.spinoffs) {
    collectAllShasInStack(spinoff, result)
  }

  return result
}
