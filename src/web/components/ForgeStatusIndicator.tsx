import { CloudOffIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import React from 'react'
import { useForgeStateContext } from '../contexts/ForgeStateContext'
import { cn } from '../utils/cn'

/**
 * Displays the current status of GitHub/forge connectivity.
 *
 * Shows:
 * - Nothing when connected and idle (success state is invisible)
 * - Spinner when fetching
 * - Warning icon with error tooltip when offline/errored
 */
export function ForgeStatusIndicator(): React.JSX.Element | null {
  const { forgeStatus, forgeError, refreshForge } = useForgeStateContext()

  if (forgeStatus === 'idle' || forgeStatus === 'success') {
    // No indicator needed when everything is working
    return null
  }

  if (forgeStatus === 'fetching') {
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2Icon className="size-3 animate-spin" />
        <span>Syncing...</span>
      </div>
    )
  }

  // Error state
  return (
    <button
      onClick={() => refreshForge()}
      className={cn(
        'flex items-center gap-1.5 text-xs',
        'text-amber-500 hover:text-amber-400',
        'cursor-pointer transition-colors'
      )}
      title={forgeError ?? 'GitHub connection error. Click to retry.'}
    >
      <CloudOffIcon className="size-3" />
      <span>GitHub offline</span>
      <RefreshCwIcon className="size-3 opacity-50" />
    </button>
  )
}
