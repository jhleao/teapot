import type { UiBranch } from '@shared/types'
import React, { memo, useMemo, useState } from 'react'
import { cn } from '../utils/cn'
import { BranchBadge } from './BranchBadge'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

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
  const [open, setOpen] = useState(false)

  // Process all branch data in a single memoized computation
  const { primary, additionalLocal, additionalRemote, additionalCount } = useMemo(
    () => processBranches(branches),
    [branches]
  )

  // If only one branch, just render the regular BranchBadge
  if (branches.length === 1) {
    return <BranchBadge data={branches[0]} />
  }

  const hasLocalBranches = additionalLocal.length > 0
  const hasRemoteBranches = additionalRemote.length > 0

  return (
    <div className="flex items-center gap-1">
      <BranchBadge data={primary} />
      {additionalCount > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                'inline-flex w-[1.625rem] items-center justify-center rounded-lg py-1 text-xs font-medium transition-colors',
                'border-border/50 bg-muted/70 text-muted-foreground border',
                'hover:bg-muted hover:text-foreground',
                open && 'bg-muted text-foreground'
              )}
              title={`${additionalCount} more branch${additionalCount > 1 ? 'es' : ''}`}
              aria-expanded={open}
              aria-haspopup="dialog"
            >
              +{additionalCount}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="min-w-[12rem] p-2"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {hasLocalBranches && <BranchSection title="Local branches" branches={additionalLocal} />}
            {hasLocalBranches && hasRemoteBranches && <div className="bg-border my-2 h-px" />}
            {hasRemoteBranches && (
              <BranchSection title="Remote branches" branches={additionalRemote} />
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
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
