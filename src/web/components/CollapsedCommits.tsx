import { ChevronDown, ChevronRight } from 'lucide-react'
import React, { memo } from 'react'
import { cn } from '../utils/cn'

interface CollapsedCommitsProps {
  count: number
  isExpanded: boolean
  onToggle: () => void
  className?: string
}

export const CollapsedCommits = memo(function CollapsedCommits({
  count,
  isExpanded,
  onToggle,
  className
}: CollapsedCommitsProps): React.JSX.Element {
  const Icon = isExpanded ? ChevronDown : ChevronRight
  const label = `${count} more commit${count !== 1 ? 's' : ''}`

  return (
    <button
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
      className={cn(
        'text-muted-foreground hover:text-foreground flex items-center gap-1 py-1 text-xs transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
})
