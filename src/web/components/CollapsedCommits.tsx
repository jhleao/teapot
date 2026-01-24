import { ChevronDown, ChevronRight } from 'lucide-react'
import React, { memo } from 'react'
import type { UiCommit, UiStack, UiWorkingTreeFile } from '@shared/types'
import { cn } from '../utils/cn'
import { CommitView } from './StackView'

interface CollapsedCommitsProps {
  count: number
  isExpanded: boolean
  onToggle: () => void
  className?: string
  ownedCommits: UiCommit[]
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
  draggedCommitSet: Set<string> | null
}

export const CollapsedCommits = memo(function CollapsedCommits({
  count,
  isExpanded,
  onToggle,
  className,
  ownedCommits,
  stack,
  workingTree,
  draggedCommitSet
}: CollapsedCommitsProps): React.JSX.Element {
  const Icon = isExpanded ? ChevronDown : ChevronRight
  const label = `${count} more commit${count !== 1 ? 's' : ''}`

  return (
    <div
      className={cn(
        'border-border border-l-2',
        !isExpanded && 'pb-2',
        className
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
        className={cn(
          'text-muted-foreground/60 hover:text-muted-foreground ml-4 flex items-center gap-1 text-xs transition-colors',
          'focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1'
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {isExpanded &&
        ownedCommits.map((commit) => (
          <CommitView
            key={commit.sha}
            data={commit}
            stack={stack}
            workingTree={workingTree}
            draggedCommitSet={draggedCommitSet}
            isOwned
          />
        ))}
    </div>
  )
})
