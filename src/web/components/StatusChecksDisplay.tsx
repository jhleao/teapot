import type { MergeReadiness, StatusCheck } from '@shared/types/git-forge'
import { CheckCircle2Icon, CircleDotIcon, CircleIcon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../utils/cn'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ScrollArea } from './ui/scroll-area'

interface StatusChecksDisplayProps {
  mergeReadiness: MergeReadiness
  className?: string
}

/**
 * Compact display of CI status checks for a PR.
 * Shows an icon with count badge, expandable to show individual checks.
 */
export function StatusChecksDisplay({
  mergeReadiness,
  className
}: StatusChecksDisplayProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)

  const { checks, checksStatus } = mergeReadiness

  // Don't show anything if there are no checks
  if (checks.length === 0) {
    return null
  }

  const passedCount = checks.filter((c) => c.status === 'success').length
  const failedCount = checks.filter((c) => c.status === 'failure').length
  const pendingCount = checks.filter((c) => c.status === 'pending').length

  // Determine icon and color based on overall status
  const getStatusDisplay = () => {
    switch (checksStatus) {
      case 'success':
        return {
          Icon: CheckCircle2Icon,
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30'
        }
      case 'failure':
        return {
          Icon: XCircleIcon,
          color: 'text-red-500',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30'
        }
      case 'pending':
        return {
          Icon: Loader2Icon,
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          animate: true
        }
      default:
        return {
          Icon: CircleIcon,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          borderColor: 'border-border'
        }
    }
  }

  const { Icon, color, bgColor, borderColor, animate } = getStatusDisplay()

  // Format the badge text
  const getBadgeText = () => {
    if (checksStatus === 'success') {
      return `${passedCount}`
    }
    if (checksStatus === 'failure') {
      return `${failedCount}/${checks.length}`
    }
    if (checksStatus === 'pending') {
      return `${passedCount}/${checks.length}`
    }
    return `${checks.length}`
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
            'cursor-pointer transition-opacity hover:opacity-80',
            bgColor,
            borderColor,
            color,
            className
          )}
          title={`${passedCount} passed, ${failedCount} failed, ${pendingCount} pending`}
        >
          <Icon className={cn('h-3 w-3', animate && 'animate-spin')} />
          <span>{getBadgeText()}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[300px] min-w-[200px] p-2">
        <div className="border-border text-muted-foreground mb-1.5 border-b pb-1.5 text-xs font-medium">
          Status Checks ({passedCount}/{checks.length})
        </div>
        <ScrollArea className="max-h-[200px]">
          <div className="flex flex-col gap-1">
            {checks.map((check, index) => (
              <CheckItem key={index} check={check} />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function CheckItem({ check }: { check: StatusCheck }): React.JSX.Element {
  const getCheckIcon = () => {
    switch (check.status) {
      case 'success':
        return <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500" />
      case 'failure':
        return <XCircleIcon className="h-3.5 w-3.5 text-red-500" />
      case 'pending':
        return <Loader2Icon className="h-3.5 w-3.5 animate-spin text-yellow-500" />
      case 'neutral':
      case 'skipped':
        return <CircleDotIcon className="text-muted-foreground h-3.5 w-3.5" />
      default:
        return <CircleIcon className="text-muted-foreground h-3.5 w-3.5" />
    }
  }

  const content = (
    <div className="flex items-start gap-2 py-0.5">
      <div className="mt-0.5 shrink-0">{getCheckIcon()}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{check.name}</div>
        {check.description && (
          <div className="text-muted-foreground truncate text-[10px]">{check.description}</div>
        )}
      </div>
    </div>
  )

  if (check.detailsUrl) {
    return (
      <a
        href={check.detailsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:bg-muted/50 -mx-1 rounded px-1"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    )
  }

  return <div className="-mx-1 px-1">{content}</div>
}
