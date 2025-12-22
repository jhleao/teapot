import type { UiBranch } from '@shared/types'
import React from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { ContextMenu, ContextMenuItem } from './ContextMenu'

export function BranchBadge({ data }: { data: UiBranch }): React.JSX.Element {
  const { checkout, deleteBranch, isWorkingTreeDirty } = useUiStateContext()

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isWorkingTreeDirty) return
    e.stopPropagation()
    checkout({ ref: data.name })
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(data.name)
  }

  const handleDelete = () => {
    deleteBranch({ branchName: data.name })
  }

  return (
    <>
      <ContextMenu
        disabled={isWorkingTreeDirty}
        content={
          <>
            <ContextMenuItem onClick={handleCopy}>Copy branch name</ContextMenuItem>
            <ContextMenuItem onClick={handleDelete} disabled={data.isCurrent}>
              Delete branch
            </ContextMenuItem>
          </>
        }
      >
        <span
          onDoubleClick={handleDoubleClick}
          className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap select-none ${
            data.isCurrent
              ? 'bg-accent text-accent-foreground border-accent-border border'
              : data.isRemote
                ? 'bg-muted/50 text-muted-foreground/80 border-border/50 border border-dashed'
                : 'bg-muted text-muted-foreground border-border border'
          }`}
        >
          {data.isCurrent && (
            <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          )}
          {data.name}
        </span>
      </ContextMenu>
    </>
  )
}
