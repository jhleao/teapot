import React from 'react'
import type { UiBranch } from '@shared/types'

export function BranchBadge({ data }: { data: UiBranch }): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${
        data.isCurrent
          ? 'bg-accent text-accent-foreground border border-accent-border'
          : 'bg-muted text-muted-foreground border border-border'
      }`}
    >
      {data.isCurrent && (
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {data.name}
    </span>
  )
}

