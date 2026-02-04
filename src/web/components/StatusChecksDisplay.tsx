import type { MergeReadiness, StatusCheck } from '@shared/types/git-forge'
import { CheckCircle2Icon, CircleDotIcon, XCircleIcon } from 'lucide-react'
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
          icon: <CheckCircle2Icon className="h-3 w-3" />,
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30'
        }
      case 'failure':
        return {
          icon: <XCircleIcon className="h-3 w-3" />,
          color: 'text-red-500',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30'
        }
      case 'pending':
        return {
          icon: (
            <span className="inline-flex h-3 w-3 items-center justify-center">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
            </span>
          ),
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30'
        }
      default:
        return {
          icon: <span className="inline-block h-2.5 w-2.5 rounded-full bg-current" />,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          borderColor: 'border-border'
        }
    }
  }

  const { icon, color, bgColor, borderColor } = getStatusDisplay()

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
          {icon}
          <span>{getBadgeText()}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-2">
        <div className="border-border text-muted-foreground mb-1.5 border-b pb-1.5 text-xs font-medium">
          Status Checks ({passedCount}/{checks.length})
        </div>
        <ScrollArea className="max-h-[200px]">
          <div className="flex w-[224px] flex-col gap-1">
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
        return (
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
          </span>
        )
      case 'neutral':
      case 'skipped':
        return <CircleDotIcon className="text-muted-foreground h-3.5 w-3.5" />
      default:
        return <span className="border-muted-foreground inline-block h-3 w-3 rounded-full border" />
    }
  }

  const content = (
    <div className="flex min-w-0 items-start gap-2 py-0.5">
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
        className="hover:bg-muted/50 block overflow-hidden rounded"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    )
  }

  return <div className="overflow-hidden">{content}</div>
}
