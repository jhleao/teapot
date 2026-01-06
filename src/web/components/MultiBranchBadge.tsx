import type { UiBranch } from '@shared/types'
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'
import { BranchBadge } from './BranchBadge'

interface MultiBranchBadgeProps {
  branches: UiBranch[]
}

interface ProcessedBranches {
  primary: UiBranch
  additionalLocal: UiBranch[]
  additionalRemote: UiBranch[]
  additionalCount: number
}

/**
 * Processes branches into a structured format for display.
 * Sorts by priority (current > local > remote) and groups additional branches by type.
 */
function processBranches(branches: UiBranch[]): ProcessedBranches {
  // Sort: current first, then local, then remote
  const sorted = [...branches].sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1
    if (!a.isCurrent && b.isCurrent) return 1
    if (!a.isRemote && b.isRemote) return -1
    if (a.isRemote && !b.isRemote) return 1
    return 0
  })

  const [primary, ...additional] = sorted
  const additionalLocal: UiBranch[] = []
  const additionalRemote: UiBranch[] = []

  for (const branch of additional) {
    if (branch.isRemote) {
      additionalRemote.push(branch)
    } else {
      additionalLocal.push(branch)
    }
  }

  return {
    primary,
    additionalLocal,
    additionalRemote,
    additionalCount: additional.length
  }
}

/**
 * Displays multiple branches pointing to the same commit in a compact way.
 * Shows the primary branch (current or first local) with a "+N" indicator
 * that expands to show all branches on click.
 */
export const MultiBranchBadge = memo(function MultiBranchBadge({
  branches
}: MultiBranchBadgeProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Process all branch data in a single memoized computation
  const { primary, additionalLocal, additionalRemote, additionalCount } = useMemo(
    () => processBranches(branches),
    [branches]
  )

  const closePopover = useCallback(() => {
    setIsExpanded(false)
    setPopoverPosition(null)
  }, [])

  const handleToggleExpanded = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      if (isExpanded) {
        closePopover()
      } else {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (rect) {
          setPopoverPosition({
            x: rect.left,
            y: rect.bottom + 4
          })
        }
        setIsExpanded(true)
      }
    },
    [isExpanded, closePopover]
  )

  // Close popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        closePopover()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePopover()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isExpanded, closePopover])

  // If only one branch, just render the regular BranchBadge
  if (branches.length === 1) {
    return <BranchBadge data={branches[0]} />
  }

  return (
    <div className="flex items-center gap-1">
      <BranchBadge data={primary} />
      {additionalCount > 0 && (
        <>
          <button
            ref={triggerRef}
            onClick={handleToggleExpanded}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors',
              'bg-muted/70 text-muted-foreground border-border/50 border',
              'hover:bg-muted hover:text-foreground',
              isExpanded && 'bg-muted text-foreground'
            )}
            title={`${additionalCount} more branch${additionalCount > 1 ? 'es' : ''}`}
            aria-expanded={isExpanded}
            aria-haspopup="dialog"
          >
            +{additionalCount}
          </button>
          {isExpanded && popoverPosition && (
            <BranchPopover
              ref={popoverRef}
              localBranches={additionalLocal}
              remoteBranches={additionalRemote}
              position={popoverPosition}
              triggerRef={triggerRef}
            />
          )}
        </>
      )}
    </div>
  )
})

interface BranchPopoverProps {
  localBranches: UiBranch[]
  remoteBranches: UiBranch[]
  position: { x: number; y: number }
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

const BranchPopover = React.forwardRef<HTMLDivElement, BranchPopoverProps>(function BranchPopover(
  { localBranches, remoteBranches, position, triggerRef },
  forwardedRef
) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [isPositioned, setIsPositioned] = useState(false)
  const [finalPosition, setFinalPosition] = useState(position)

  // Adjust position before paint, then reveal
  useLayoutEffect(() => {
    const popover = innerRef.current
    const trigger = triggerRef.current
    if (!popover) return

    const rect = popover.getBoundingClientRect()
    const triggerRect = trigger?.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x = position.x
    let y = position.y

    // Adjust horizontal position if needed
    if (x + rect.width > viewportWidth - 8) {
      x = viewportWidth - rect.width - 8
    }
    // Ensure doesn't go off left edge
    if (x < 8) {
      x = 8
    }

    // Adjust vertical position if needed (show above if no room below)
    if (y + rect.height > viewportHeight - 8) {
      const triggerHeight = triggerRect?.height ?? 24
      y = position.y - rect.height - triggerHeight - 8
    }

    setFinalPosition({ x, y })
    setIsPositioned(true)
  }, [position, triggerRef])

  // Merge refs
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      ;(innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  const hasLocalBranches = localBranches.length > 0
  const hasRemoteBranches = remoteBranches.length > 0

  return createPortal(
    <div
      ref={setRef}
      role="dialog"
      aria-label="Additional branches"
      className={cn(
        'fixed z-50 min-w-[12rem] overflow-hidden rounded-lg border p-2 shadow-lg',
        'border-border bg-background',
        // Hide until positioned to prevent flash, then animate in
        isPositioned ? 'animate-in fade-in zoom-in-95' : 'invisible'
      )}
      style={{ top: finalPosition.y, left: finalPosition.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasLocalBranches && <BranchSection title="Local branches" branches={localBranches} />}
      {hasLocalBranches && hasRemoteBranches && <div className="bg-border my-2 h-px" />}
      {hasRemoteBranches && <BranchSection title="Remote branches" branches={remoteBranches} />}
    </div>,
    document.body
  )
})

interface BranchSectionProps {
  title: string
  branches: UiBranch[]
}

function BranchSection({ title, branches }: BranchSectionProps): React.JSX.Element {
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">{title}</div>
      <div className="flex flex-col gap-1">
        {branches.map((branch) => (
          <div key={branch.name} className="flex">
            <BranchBadge data={branch} />
          </div>
        ))}
      </div>
    </div>
  )
}
