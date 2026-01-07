import { AlertTriangleIcon, CloudOffIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import React from 'react'
import { useForgeStateContext } from '../contexts/ForgeStateContext'
import { cn } from '../utils/cn'

/**
 * Displays the current status of GitHub/forge connectivity.
 *
 * Shows:
 * - Nothing when connected and idle (success state is invisible)
 * - Spinner when fetching
 * - Warning icon when rate limit is low
 * - Warning icon with error tooltip when offline/errored
 */
export function ForgeStatusIndicator(): React.JSX.Element | null {
  const { forgeStatus, forgeError, rateLimit, refreshForge } = useForgeStateContext()

  // Show rate limit warning if remaining is less than 10% of limit
  const isRateLimitLow = rateLimit && rateLimit.remaining < rateLimit.limit * 0.1

  if (forgeStatus === 'fetching') {
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2Icon className="size-3 animate-spin" />
        <span>Syncing...</span>
      </div>
    )
  }

  if (forgeStatus === 'error') {
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

  // Show rate limit warning when low (even on success)
  if (isRateLimitLow && rateLimit) {
    const resetDate = new Date(rateLimit.reset * 1000)
    const resetTime = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    return (
      <div
        className={cn(
          'flex items-center gap-1.5 text-xs',
          rateLimit.remaining === 0 ? 'text-red-500' : 'text-amber-500'
        )}
        title={`GitHub API rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining. Resets at ${resetTime}.`}
      >
        <AlertTriangleIcon className="size-3" />
        <span>
          {rateLimit.remaining === 0
            ? `Rate limit exceeded (resets ${resetTime})`
            : `Rate limit low: ${rateLimit.remaining}/${rateLimit.limit}`}
        </span>
      </div>
    )
  }

  // No indicator needed when everything is working
  return null
}
