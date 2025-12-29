import React from 'react'
import { cn } from '../utils/cn'

interface IconProps {
  className?: string
}

/**
 * Tree/worktree icon - represents git worktrees
 */
export function TreeIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg
      className={cn('h-4 w-4', className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21v-6m0 0l-3-3m3 3l3-3m-3-3V3m0 9l-6-6m6 6l6-6"
      />
    </svg>
  )
}
