import type { UiCommit } from '@shared/types'
import React from 'react'
import { cn } from '../utils/cn'

export function RebaseStatusBadge({
  status
}: {
  status: Exclude<UiCommit['rebaseStatus'], null>
}): React.JSX.Element {
  const statusColors = {
    prompting: 'text-blue-600',
    idle: 'text-yellow-600',
    running: 'text-purple-600',
    conflicted: 'text-red-600',
    resolved: 'text-orange-600',
    scheduled: 'text-green-600'
  }

  return <span className={cn('text-xs', statusColors[status])}>{status}</span>
}
