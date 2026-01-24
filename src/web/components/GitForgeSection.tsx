import { log } from '@shared/logger'
import type { UiBranch } from '@shared/types'
import type { StatusCheck } from '@shared/types/git-forge'
import {
  BadgeCheckIcon,
  BadgeXIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon
} from 'lucide-react'
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useForgeStateContext } from '../contexts/ForgeStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { getMergedBranchToCleanup } from '../utils/get-merged-branch-to-cleanup'
import { getPrStateStyles } from '../utils/pr-state-styles'
import { Tooltip } from './Tooltip'
import { ScrollArea } from './ui/scroll-area'

interface GitForgeSectionProps {
  branches: UiBranch[]
  isTrunk: boolean
  commitSha: string
  trunkHeadSha: string
  canRebaseToTrunk: boolean
}

export const GitForgeSection = memo(function GitForgeSection({
  branches,
  isTrunk,
  commitSha,
  trunkHeadSha,
  canRebaseToTrunk
}: GitForgeSectionProps): React.JSX.Element | null {
  const { createPullRequest, submitRebaseIntent, cleanupBranch, shipIt, mergeStrategy } =
    useUiStateContext()
  const { forgeStatus, forgeState } = useForgeStateContext()
  const [isLoading, setIsLoading] = useState(false)
  const [isShipping, setIsShipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChecksOpen, setIsChecksOpen] = useState(false)
  const checksRef = useRef<HTMLDivElement>(null)

  const mergedBranchToCleanup = useMemo(() => getMergedBranchToCleanup(branches), [branches])
  const branchWithPr = useMemo(() => branches.find((b) => b.pullRequest), [branches])
  const pr = branchWithPr?.pullRequest
  const isMerged = useMemo(() => branches.some((b) => b.isMerged), [branches])
  const branchCanShip = branchWithPr?.canShip ?? false

  const handleCleanup = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading || !mergedBranchToCleanup) return

      setIsLoading(true)
      try {
        await cleanupBranch({ branchName: mergedBranchToCleanup.name })
      } catch (error) {
        log.error('Failed to cleanup branch:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, mergedBranchToCleanup, cleanupBranch]
  )

  const handleRebase = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading) return

      setIsLoading(true)
      try {
        await submitRebaseIntent({ headSha: commitSha, baseSha: trunkHeadSha })
      } catch {
        // Handled by context toast
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, submitRebaseIntent, commitSha, trunkHeadSha]
  )

  const handleShipIt = useCallback(async (): Promise<void> => {
    if (isShipping || !branchWithPr) return

    setIsShipping(true)
    try {
      await shipIt({ branchName: branchWithPr.name, canShip: branchWithPr.canShip })
      setIsChecksOpen(false)
    } catch (error) {
      log.error('Failed to ship:', error)
    } finally {
      setIsShipping(false)
    }
  }, [isShipping, branchWithPr, shipIt])

  const handleCreatePr = useCallback(
    async (e?: React.MouseEvent): Promise<void> => {
      e?.stopPropagation()
      if (isLoading) return

      const branch = branches[0]
      if (!branch) return

      setIsLoading(true)
      setError(null)
      try {
        await createPullRequest({ headBranch: branch.name })
      } catch (error) {
        log.error('Failed to create PR:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, branches, createPullRequest]
  )

  if (branches.length === 0) return null

  if (isTrunk) {
    if (!mergedBranchToCleanup) return null

    return (
      <span className="animate-in fade-in duration-150">
        <button
          type="button"
          onClick={handleCleanup}
          disabled={isLoading}
          className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Cleaning...' : 'Clean up'}
        </button>
      </span>
    )
  }

  if (pr) {
    const prIsMerged = pr.state === 'merged'
    const prIsClosed = pr.state === 'closed'
    const prIsActive = pr.state === 'open' || pr.state === 'draft'
    const mergeReadiness = pr.mergeReadiness
    const checksStatus = mergeReadiness?.checksStatus ?? 'none'
    const checks = mergeReadiness?.checks ?? []
    const hasConflicts = mergeReadiness?.blockers?.includes('conflicts') ?? false
    const hasChecks = checks.length > 0 && !hasConflicts

    const canShipNow =
      prIsActive && pr.isInSync && !branchWithPr?.hasStaleTarget && branchCanShip && pr.isMergeable

    if (!prIsActive) {
      const prStyles = getPrStateStyles(pr.state)
      return (
        <div className="animate-in fade-in flex items-center gap-2 duration-150">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('cursor-pointer text-sm hover:underline', prStyles.textClass)}
            onClick={(e) => e.stopPropagation()}
          >
            #{pr.number}
            {prStyles.label}
          </a>
          {(prIsMerged || prIsClosed) && mergedBranchToCleanup && (
            <button
              type="button"
              onClick={handleCleanup}
              disabled={isLoading}
              className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Cleaning...' : 'Clean up'}
            </button>
          )}
          {prIsClosed && !prIsMerged && (
            <button
              type="button"
              onClick={handleCreatePr}
              disabled={isLoading}
              className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Create PR'}
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="animate-in fade-in flex items-center gap-2 duration-150">
        {canRebaseToTrunk && (
          <button
            type="button"
            onClick={handleRebase}
            disabled={isLoading}
            className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
          >
            Rebase
          </button>
        )}
        <div
          ref={checksRef}
          className={cn(
            'relative inline-flex items-center gap-1.5',
            isLoading && 'pointer-events-none opacity-60'
          )}
        >
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer text-sm text-blue-500 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{pr.number}
          </a>
          {hasChecks && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsChecksOpen(!isChecksOpen)
              }}
              className="cursor-pointer hover:opacity-70"
            >
              <ChecksIcon checksStatus={checksStatus} />
            </button>
          )}
          {isChecksOpen && (
            <ChecksPopover
              checks={checks}
              onClose={() => setIsChecksOpen(false)}
              containerRef={checksRef}
              canMerge={canShipNow}
              mergeStrategy={mergeStrategy}
              onMerge={handleShipIt}
              isMerging={isShipping}
            />
          )}
        </div>
        {pr.hasMultipleOpenPrs && (
          <Tooltip
            content={
              <span>
                Multiple open PRs exist for this branch.
                <br />
                Using most recently created.
              </span>
            }
          >
            <span className="border-warning/50 bg-warning/20 text-warning inline-flex items-center rounded-lg border px-2 py-1 text-xs font-medium">
              Multiple PRs
            </span>
          </Tooltip>
        )}
        {branchWithPr?.hasStaleTarget && (
          <span
            className="border-warning/50 bg-warning/20 text-warning inline-flex items-center rounded-lg border px-2 py-1 text-xs font-medium"
            title="PR target branch has been merged. Update the PR target first."
          >
            Stale target
          </span>
        )}
      </div>
    )
  }

  if (isMerged) {
    return (
      <div className="animate-in fade-in flex items-center gap-2 duration-150">
        <span className="text-muted-foreground text-sm">(Merged)</span>
        {mergedBranchToCleanup && (
          <button
            type="button"
            onClick={handleCleanup}
            disabled={isLoading}
            className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Cleaning...' : 'Clean up'}
          </button>
        )}
      </div>
    )
  }

  const isInitialForgeLoad =
    forgeState === null && (forgeStatus === 'idle' || forgeStatus === 'fetching')

  if (isInitialForgeLoad) {
    if (!canRebaseToTrunk) return null
    return (
      <button
        type="button"
        onClick={handleRebase}
        disabled={isLoading}
        className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
      >
        Rebase
      </button>
    )
  }

  return (
    <div className="animate-in fade-in flex items-center gap-2 duration-150">
      {canRebaseToTrunk && (
        <button
          type="button"
          onClick={handleRebase}
          disabled={isLoading}
          className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
        >
          Rebase
        </button>
      )}
      <button
        type="button"
        onClick={handleCreatePr}
        disabled={isLoading}
        className={cn(
          'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors',
          error
            ? 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500/20'
            : 'text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30'
        )}
        title={error || undefined}
      >
        {isLoading ? 'Creating PR...' : error ? 'Failed - Retry' : 'Create PR'}
      </button>
      {error && (
        <span className="max-w-[200px] text-[10px] wrap-break-word text-red-500" title={error}>
          {error.length > 50 ? `${error.substring(0, 50)}...` : error}
        </span>
      )}
    </div>
  )
})

function ChecksIcon({ checksStatus }: { checksStatus: string }): React.JSX.Element {
  switch (checksStatus) {
    case 'success':
      return <BadgeCheckIcon className="h-4 w-4 text-green-500" />
    case 'failure':
      return <BadgeXIcon className="h-4 w-4 text-red-500" />
    case 'pending':
      return <Loader2Icon className="h-4 w-4 animate-spin text-yellow-500" />
    default:
      return <CircleIcon className="text-muted-foreground h-4 w-4" />
  }
}

function ChecksPopover({
  checks,
  onClose,
  containerRef,
  canMerge,
  mergeStrategy,
  onMerge,
  isMerging
}: {
  checks: StatusCheck[]
  onClose: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
  canMerge?: boolean
  mergeStrategy?: 'squash' | 'merge' | 'rebase'
  onMerge?: () => void
  isMerging?: boolean
}): React.JSX.Element {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: boolean; left: boolean }>({
    top: true,
    left: true
  })

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const spaceRight = window.innerWidth - rect.left
    setPosition({
      top: spaceBelow >= 250 || spaceBelow >= spaceAbove,
      left: spaceRight >= 300
    })
  }, [containerRef])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, containerRef])

  const passedCount = checks.filter((c) => c.status === 'success').length

  const mergeLabel =
    mergeStrategy === 'squash'
      ? 'Squash and merge'
      : mergeStrategy === 'merge'
        ? 'Merge pull request'
        : 'Rebase and merge'

  return (
    <div
      ref={dropdownRef}
      className={cn(
        'absolute z-50',
        position.top ? 'top-full mt-1' : 'bottom-full mb-1',
        position.left ? 'left-0' : 'right-0',
        'bg-background border-border rounded-md border shadow-lg',
        'max-w-[300px] min-w-[200px] p-2'
      )}
    >
      <div className="border-border text-muted-foreground mb-1.5 border-b pb-1.5 text-xs font-medium">
        Status Checks ({passedCount}/{checks.length})
      </div>
      <ScrollArea className="max-h-[200px]">
        <div className="flex flex-col gap-1">
          {checks.map((check, index) => (
            <CheckItemRow key={index} check={check} />
          ))}
        </div>
      </ScrollArea>
      {canMerge && onMerge && (
        <div className="border-border mt-2 border-t pt-2">
          <button
            type="button"
            onClick={onMerge}
            disabled={isMerging}
            className="w-full cursor-pointer rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {isMerging ? 'Merging...' : mergeLabel}
          </button>
        </div>
      )}
    </div>
  )
}

function CheckItemRow({ check }: { check: StatusCheck }): React.JSX.Element {
  const icon = getCheckStatusIcon(check.status)
  const content = (
    <div className="flex items-start gap-2 py-0.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
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

function getCheckStatusIcon(status: string): React.JSX.Element {
  switch (status) {
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
