import type { Worktree } from '@shared/types'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import React from 'react'

interface WorktreeConflictBannerProps {
  conflictedWorktrees: Worktree[]
  onSwitchToWorktree: (worktreePath: string) => void
}

/**
 * Non-blocking banner shown when a non-current worktree has merge conflicts.
 * Allows the user to switch to the conflicted worktree to resolve.
 */
export function WorktreeConflictBanner({
  conflictedWorktrees,
  onSwitchToWorktree
}: WorktreeConflictBannerProps): React.JSX.Element | null {
  if (conflictedWorktrees.length === 0) return null

  const count = conflictedWorktrees.length
  const firstWorktree = conflictedWorktrees[0]

  return (
    <div role="alert" className="max-w-[100vw] overflow-hidden border-b border-red-500/30 bg-red-500/10 px-4 py-2">
      <div className="flex items-center gap-2">
        <div
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm text-red-600"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">
            {count === 1
              ? 'A worktree has merge conflicts that need to be resolved'
              : `${count} worktrees have merge conflicts that need to be resolved`}
          </span>
        </div>
        {count === 1 && (
          <button
            onClick={() => onSwitchToWorktree(firstWorktree.path)}
            className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-500/10 hover:text-red-700 focus:ring-2 focus:ring-red-500 focus:outline-none"
          >
            Switch to resolve
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
