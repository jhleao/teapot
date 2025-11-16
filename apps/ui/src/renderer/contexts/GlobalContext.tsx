import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
  type RefObject
} from 'react'
import type { UiStack } from '@teapot/contract'
import { throttle } from '../utils/throttle'
import { buildOptimisticDrag, isInsideDraggingStack } from '../utils/stack-operations'

/**
 * Finds the closest commit below the mouse cursor.
 * @param mouseY - The Y position of the mouse cursor
 * @param commitRefsMap - Map of commit SHAs to their DOM element refs
 * @param draggingCommitSha - The SHA of the commit currently being dragged
 * @param stacks - The current stack structure to check which commits are inside the dragging stack
 * @returns The SHA of the closest commit below the mouse, or null if none found
 */
function findClosestCommitBelowMouse(
  mouseY: number,
  commitRefsMap: Map<string, RefObject<HTMLDivElement>>,
  draggingCommitSha: string,
  stacks: UiStack | null
): string | null {
  let closestSha: string | null = null
  let closestDistance = Infinity

  for (const [sha, ref] of commitRefsMap.entries()) {
    // Skip commits that are inside the dragging stack (including the dragging commit itself)
    if (stacks && isInsideDraggingStack(stacks, draggingCommitSha, sha)) {
      continue
    }

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
  stacks: UiStack | null
  setStacks: (stacks: UiStack | null) => void
  getEffectiveStacks: () => { stacks: UiStack | null; isOptimistic: boolean }
  isInsideDraggingStack: (candidateSha: string) => boolean
}

const GlobalContext = createContext<GlobalContextValue | undefined>(undefined)

export function GlobalProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isDark, setIsDark] = useState(true)
  const [draggingCommitSha, setDraggingCommitSha] = useState<string | null>(null)
  const [commitBelowMouse, setCommitBelowMouse] = useState<string | null>(null)
  const [stacks, setStacks] = useState<UiStack | null>(null)
  const [optimisticStacks, setOptimisticStacks] = useState<UiStack | null>(null)

  // Store refs for all commits
  const commitRefsMap = useRef<Map<string, RefObject<HTMLDivElement>>>(new Map())

  const registerCommitRef = useCallback((sha: string, ref: RefObject<HTMLDivElement>) => {
    commitRefsMap.current.set(sha, ref)
  }, [])

  const unregisterCommitRef = useCallback((sha: string) => {
    commitRefsMap.current.delete(sha)
  }, [])

  const getEffectiveStacks = useCallback(() => {
    return {
      stacks: optimisticStacks || stacks,
      isOptimistic: optimisticStacks !== null
    }
  }, [stacks, optimisticStacks])

  // Custom setDraggingCommitSha that computes optimistic stacks
  const handleSetDraggingCommitSha = useCallback((sha: string | null) => {
    setDraggingCommitSha(sha)

    if (sha === null) {
      // Clear optimistic stacks when dragging ends
      setOptimisticStacks(null)
    }
  }, [])

  // Simplified isInsideDraggingStack that only requires candidateSha
  const handleIsInsideDraggingStack = useCallback(
    (candidateSha: string): boolean => {
      if (!draggingCommitSha || !stacks) {
        return false
      }
      return isInsideDraggingStack(stacks, draggingCommitSha, candidateSha)
    },
    [stacks, draggingCommitSha]
  )

  useEffect(() => {
    const html = document.documentElement
    if (isDark) {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
  }, [isDark])

  // Handle mousemove when dragging
  useEffect(() => {
    if (!draggingCommitSha) {
      setCommitBelowMouse(null)
      return
    }

    const handleMouseMove = (e: MouseEvent): void => {
      const { clientY } = e
      const closestSha = findClosestCommitBelowMouse(
        clientY,
        commitRefsMap.current,
        draggingCommitSha,
        stacks
      )
      setCommitBelowMouse(closestSha)
    }

    // Throttle to 50ms for smooth but not excessive updates
    const throttledMouseMove = throttle(handleMouseMove, 50)

    window.addEventListener('mousemove', throttledMouseMove)

    return () => {
      window.removeEventListener('mousemove', throttledMouseMove)
    }
  }, [draggingCommitSha, stacks])

  // Compute optimistic stacks when we have both dragging commit and target commit
  useEffect(() => {
    if (!draggingCommitSha || !commitBelowMouse || !stacks) {
      return
    }

    const optimistic = buildOptimisticDrag(stacks, draggingCommitSha, commitBelowMouse)
    setOptimisticStacks(optimistic)
  }, [draggingCommitSha, commitBelowMouse, stacks])

  const toggleTheme = (): void => {
    setIsDark((prev) => !prev)
  }

  return (
    <GlobalContext.Provider
      value={{
        toggleTheme,
        draggingCommitSha,
        setDraggingCommitSha: handleSetDraggingCommitSha,
        commitBelowMouse,
        registerCommitRef,
        unregisterCommitRef,
        stacks,
        setStacks,
        getEffectiveStacks,
        isInsideDraggingStack: handleIsInsideDraggingStack
      }}
    >
      {children}
    </GlobalContext.Provider>
  )
}

export function useGlobalCtx(): GlobalContextValue {
  const context = useContext(GlobalContext)
  if (context === undefined) {
    throw new Error('useGlobalCtx must be used within a GlobalProvider')
  }
  return context
}
