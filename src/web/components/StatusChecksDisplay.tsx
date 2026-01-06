import type { MergeReadiness, StatusCheck } from '@shared/types/git-forge'
import { CheckCircle2Icon, CircleDotIcon, CircleIcon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../utils/cn'

interface StatusChecksDisplayProps {
  mergeReadiness: MergeReadiness
  className?: string
}

type DropdownPosition = {
  top: boolean // true = opens below, false = opens above
  left: boolean // true = aligns left, false = aligns right
}

/**
 * Compact display of CI status checks for a PR.
 * Shows an icon with count badge, expandable to show individual checks.
 */
export function StatusChecksDisplay({
  mergeReadiness,
  className
}: StatusChecksDisplayProps): React.JSX.Element | null {
  const [isExpanded, setIsExpanded] = useState(false)
  const [position, setPosition] = useState<DropdownPosition>({ top: true, left: true })
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Calculate optimal dropdown position based on available viewport space
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // Estimate dropdown dimensions
    const dropdownHeight = 250 // max-h-[200px] + padding + header
    const dropdownWidth = 300 // max-w-[300px]

    // Determine vertical position: prefer below, but flip if not enough space
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const openBelow = spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove

    // Determine horizontal position: prefer left-aligned, but flip if not enough space
    const spaceRight = viewportWidth - rect.left
    const alignLeft = spaceRight >= dropdownWidth

    setPosition({ top: openBelow, left: alignLeft })
  }, [])

  // Update position when expanding
  useLayoutEffect(() => {
    if (isExpanded) {
      updatePosition()
    }
  }, [isExpanded, updatePosition])

  // Close dropdown on click outside or escape key
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false)
      }
    }

    // Use setTimeout to avoid closing immediately on the click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isExpanded])

  const { checks, checksStatus } = mergeReadiness

  // Don't show anything if there are no checks
  if (checks.length === 0) {
    return null
  }

  const passedCount = checks.filter((c) => c.status === 'success').length
  const failedCount = checks.filter((c) => c.status === 'failure').length
  const pendingCount = checks.filter((c) => c.status === 'pending').length

  // Determine icon and color based on overall status
  const getStatusDisplay = () => {
    switch (checksStatus) {
      case 'success':
        return {
          Icon: CheckCircle2Icon,
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30'
        }
      case 'failure':
        return {
          Icon: XCircleIcon,
          color: 'text-red-500',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30'
        }
      case 'pending':
        return {
          Icon: Loader2Icon,
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          animate: true
        }
      default:
        return {
          Icon: CircleIcon,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          borderColor: 'border-border'
        }
    }
  }

  const { Icon, color, bgColor, borderColor, animate } = getStatusDisplay()

  // Format the badge text
  const getBadgeText = () => {
    if (checksStatus === 'success') {
      return `${passedCount}`
    }
    if (checksStatus === 'failure') {
      return `${failedCount}/${checks.length}`
    }
    if (checksStatus === 'pending') {
      return `${passedCount}/${checks.length}`
    }
    return `${checks.length}`
  }

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
          'cursor-pointer transition-opacity hover:opacity-80',
          bgColor,
          borderColor,
          color
        )}
        title={`${passedCount} passed, ${failedCount} failed, ${pendingCount} pending`}
      >
        <Icon className={cn('h-3 w-3', animate && 'animate-spin')} />
        <span>{getBadgeText()}</span>
      </button>

      {isExpanded && (
        <div
          ref={dropdownRef}
          className={cn(
            'absolute z-50',
            // Vertical positioning
            position.top ? 'top-full mt-1' : 'bottom-full mb-1',
            // Horizontal positioning
            position.left ? 'left-0' : 'right-0',
            'bg-popover border-border rounded-md border shadow-lg',
            'max-w-[300px] min-w-[200px] p-2'
          )}
        >
          <div className="border-border text-muted-foreground mb-1.5 border-b pb-1.5 text-xs font-medium">
            Status Checks ({passedCount}/{checks.length})
          </div>
          <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto">
            {checks.map((check, index) => (
              <CheckItem key={index} check={check} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CheckItem({ check }: { check: StatusCheck }): React.JSX.Element {
  const getCheckIcon = () => {
    switch (check.status) {
      case 'success':
        return <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500" />
      case 'failure':
        return <XCircleIcon className="h-3.5 w-3.5 text-red-500" />
      case 'pending':
        return <Loader2Icon className="h-3.5 w-3.5 animate-spin text-yellow-500" />
      case 'neutral':
      case 'skipped':
        return <CircleDotIcon className="text-muted-foreground h-3.5 w-3.5" />
      default:
        return <CircleIcon className="text-muted-foreground h-3.5 w-3.5" />
    }
  }

  const content = (
    <div className="flex items-start gap-2 py-0.5">
      <div className="mt-0.5 shrink-0">{getCheckIcon()}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{check.name}</div>
        {check.description && (
          <div className="text-muted-foreground truncate text-[10px]">{check.description}</div>
        )}
      </div>
    </div>
  )

  if (check.detailsUrl) {
    return (
      <a
        href={check.detailsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:bg-muted/50 -mx-1 rounded px-1"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    )
  }

  return <div className="-mx-1 px-1">{content}</div>
}
