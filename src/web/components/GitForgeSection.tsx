import { log } from '@shared/logger'
import type { UiBranch } from '@shared/types'
import type { StatusCheck } from '@shared/types/git-forge'
import {
  BadgeCheckIcon,
  BadgeMinusIcon,
  BadgeXIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleSlashIcon,
  Loader2Icon,
  XCircleIcon
} from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useForgeStateContext } from '../contexts/ForgeStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { getMergedBranchToCleanup } from '../utils/get-merged-branch-to-cleanup'
import { getPrStateStyles } from '../utils/pr-state-styles'
import { Tooltip } from './Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ScrollArea } from './ui/scroll-area'

const SECONDARY_BUTTON_CLASS =
  'text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50'

interface GitForgeSectionProps {
  branches: UiBranch[]
  isTrunk: boolean
  commitSha: string
  trunkHeadSha: string
  canRebaseToTrunk: boolean
}

type MergeBlockReason =
  | 'not_in_sync'
  | 'stale_target'
  | 'not_off_trunk'
  | 'not_mergeable'
  | 'checks_pending'
  | 'checks_failed'
  | 'reviews_required'
  | 'conflicts'
  | 'branch_protection'

export const GitForgeSection = memo(function GitForgeSection({
  branches,
  isTrunk,
  commitSha,
  trunkHeadSha,
  canRebaseToTrunk
}: GitForgeSectionProps): React.JSX.Element | null {
  const {
    createPullRequest,
    updatePullRequest,
    submitRebaseIntent,
    cleanupBranch,
    shipIt,
    mergeStrategy
  } = useUiStateContext()
  const { forgeStatus, forgeState } = useForgeStateContext()
  const [isLoading, setIsLoading] = useState(false)
  const [isShipping, setIsShipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChecksOpen, setIsChecksOpen] = useState(false)

  const mergedBranchToCleanup = useMemo(() => getMergedBranchToCleanup(branches), [branches])
  const branchWithPr = useMemo(() => branches.find((b) => b.pullRequest), [branches])
  const pr = branchWithPr?.pullRequest
  const isMerged = useMemo(() => branches.some((b) => b.isMerged), [branches])
  const branchCanShip = branchWithPr?.canShip ?? false

  const localBranch = useMemo(() => branches.find((b) => !b.isRemote && !b.isTrunk), [branches])
  const { canCreatePr, createPrBlockedReason } = useMemo(() => {
    const expectedPrBase = localBranch?.expectedPrBase
    if (!expectedPrBase) {
      return { canCreatePr: true, createPrBlockedReason: undefined }
    }

    const isTrunkBase = expectedPrBase === 'main' || expectedPrBase === 'master'
    if (isTrunkBase) {
      return { canCreatePr: true, createPrBlockedReason: undefined }
    }

    if (!forgeState) {
      return { canCreatePr: true, createPrBlockedReason: undefined }
    }

    const baseHasPr = forgeState.pullRequests.some((pr) => pr.headRefName === expectedPrBase)
    if (baseHasPr) {
      return { canCreatePr: true, createPrBlockedReason: undefined }
    }

    return {
      canCreatePr: false,
      createPrBlockedReason: `Create a PR for "${expectedPrBase}" first`
    }
  }, [localBranch?.expectedPrBase, forgeState])

  const prIsActive = pr?.state === 'open' || pr?.state === 'draft'
  const mergeReadiness = pr?.mergeReadiness
  const checksStatus = mergeReadiness?.checksStatus ?? 'none'
  const checks = useMemo(() => mergeReadiness?.checks ?? [], [mergeReadiness])
  const hasConflicts = mergeReadiness?.blockers?.includes('conflicts') ?? false
  const reviewsRequired = mergeReadiness?.blockers?.includes('reviews_required') ?? false

  const canShipNow = useMemo(() => {
    if (!pr || !prIsActive) return false
    return (
      pr.isInSync &&
      !pr.hasBaseDrift &&
      !branchWithPr?.hasStaleTarget &&
      branchCanShip &&
      pr.isMergeable
    )
  }, [pr, prIsActive, branchWithPr?.hasStaleTarget, branchCanShip])

  const blockReasons = useMemo((): MergeBlockReason[] => {
    if (!pr) return []
    const reasons: MergeBlockReason[] = []
    if (!pr.isInSync || pr.hasBaseDrift) reasons.push('not_in_sync')
    if (branchWithPr?.hasStaleTarget) reasons.push('stale_target')
    if (!branchCanShip) reasons.push('not_off_trunk')
    if (hasConflicts) reasons.push('conflicts')
    if (reviewsRequired) reasons.push('reviews_required')
    if (checks.some((c) => c.status === 'failure')) reasons.push('checks_failed')
    if (checks.some((c) => c.status === 'pending' || c.status === 'expected'))
      reasons.push('checks_pending')
    if (!pr.isMergeable && reasons.length === 0) reasons.push('not_mergeable')
    return reasons
  }, [pr, branchWithPr?.hasStaleTarget, branchCanShip, hasConflicts, reviewsRequired, checks])

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

  const handleUpdatePr = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading || !branchWithPr) return

      setIsLoading(true)
      try {
        await updatePullRequest({ headBranch: branchWithPr.name })
      } catch {
        // Error already handled by context (toast shown)
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, branchWithPr, updatePullRequest]
  )

  const handleRebase = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading) return

      setIsLoading(true)
      try {
        await submitRebaseIntent({ headSha: commitSha, baseSha: trunkHeadSha })
      } catch {
        // Error already handled by context (toast shown)
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
    return (
      <TrunkCleanupSection
        mergedBranchToCleanup={mergedBranchToCleanup}
        isLoading={isLoading}
        onCleanup={handleCleanup}
      />
    )
  }

  if (pr) {
    const prIsMerged = pr.state === 'merged'
    const prIsClosed = pr.state === 'closed'
    const hasChecks =
      ((checks.length > 0 || checksStatus === 'expected') && !hasConflicts) || !branchCanShip

    if (!prIsActive) {
      return (
        <ClosedPrSection
          pr={pr}
          prIsMerged={prIsMerged}
          prIsClosed={prIsClosed}
          mergedBranchToCleanup={mergedBranchToCleanup}
          isLoading={isLoading}
          onCleanup={handleCleanup}
          onCreatePr={handleCreatePr}
        />
      )
    }

    return (
      <ActivePrSection
        pr={pr}
        branchWithPr={branchWithPr}
        canRebaseToTrunk={canRebaseToTrunk}
        isLoading={isLoading}
        isShipping={isShipping}
        isChecksOpen={isChecksOpen}
        setIsChecksOpen={setIsChecksOpen}
        hasChecks={hasChecks}
        checksStatus={checksStatus}
        reviewsRequired={reviewsRequired}
        branchCanShip={branchCanShip}
        checks={checks}
        blockReasons={blockReasons}
        canShipNow={canShipNow}
        mergeStrategy={mergeStrategy}
        onRebase={handleRebase}
        onUpdatePr={handleUpdatePr}
        onShipIt={handleShipIt}
      />
    )
  }

  if (isMerged) {
    return (
      <MergedBranchSection
        mergedBranchToCleanup={mergedBranchToCleanup}
        isLoading={isLoading}
        onCleanup={handleCleanup}
      />
    )
  }

  const isInitialForgeLoad =
    forgeState === null && (forgeStatus === 'idle' || forgeStatus === 'fetching')

  if (isInitialForgeLoad) {
    return (
      <LoadingSection
        canRebaseToTrunk={canRebaseToTrunk}
        isLoading={isLoading}
        onRebase={handleRebase}
      />
    )
  }

  return (
    <CreatePrSection
      canRebaseToTrunk={canRebaseToTrunk}
      isLoading={isLoading}
      error={error}
      canCreatePr={canCreatePr}
      createPrBlockedReason={createPrBlockedReason}
      onRebase={handleRebase}
      onCreatePr={handleCreatePr}
    />
  )
})

function TrunkCleanupSection({
  mergedBranchToCleanup,
  isLoading,
  onCleanup
}: {
  mergedBranchToCleanup: UiBranch | null
  isLoading: boolean
  onCleanup: (e: React.MouseEvent) => void
}): React.JSX.Element | null {
  if (!mergedBranchToCleanup) return null

  return (
    <span className="animate-in fade-in duration-150">
      <button
        type="button"
        onClick={onCleanup}
        disabled={isLoading}
        className={SECONDARY_BUTTON_CLASS}
      >
        {isLoading ? 'Cleaning...' : 'Clean up'}
      </button>
    </span>
  )
}

function ClosedPrSection({
  pr,
  prIsMerged,
  prIsClosed,
  mergedBranchToCleanup,
  isLoading,
  onCleanup,
  onCreatePr
}: {
  pr: NonNullable<UiBranch['pullRequest']>
  prIsMerged: boolean
  prIsClosed: boolean
  mergedBranchToCleanup: UiBranch | null
  isLoading: boolean
  onCleanup: (e: React.MouseEvent) => void
  onCreatePr: (e?: React.MouseEvent) => void
}): React.JSX.Element {
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
          onClick={onCleanup}
          disabled={isLoading}
          className={SECONDARY_BUTTON_CLASS}
        >
          {isLoading ? 'Cleaning...' : 'Clean up'}
        </button>
      )}
      {prIsClosed && !prIsMerged && (
        <button
          type="button"
          onClick={onCreatePr}
          disabled={isLoading}
          className={SECONDARY_BUTTON_CLASS}
        >
          {isLoading ? 'Creating...' : 'Create PR'}
        </button>
      )}
    </div>
  )
}

function ActivePrSection({
  pr,
  branchWithPr,
  canRebaseToTrunk,
  isLoading,
  isShipping,
  isChecksOpen,
  setIsChecksOpen,
  hasChecks,
  checksStatus,
  reviewsRequired,
  branchCanShip,
  checks,
  blockReasons,
  canShipNow,
  mergeStrategy,
  onRebase,
  onUpdatePr,
  onShipIt
}: {
  pr: NonNullable<UiBranch['pullRequest']>
  branchWithPr: UiBranch | undefined
  canRebaseToTrunk: boolean
  isLoading: boolean
  isShipping: boolean
  isChecksOpen: boolean
  setIsChecksOpen: (open: boolean) => void
  hasChecks: boolean
  checksStatus: string
  reviewsRequired: boolean
  branchCanShip: boolean
  checks: StatusCheck[]
  blockReasons: MergeBlockReason[]
  canShipNow: boolean
  mergeStrategy?: 'squash' | 'merge' | 'rebase' | 'fast-forward'
  onRebase: (e: React.MouseEvent) => void
  onUpdatePr: (e: React.MouseEvent) => void
  onShipIt: () => void
}): React.JSX.Element {
  return (
    <div className="animate-in fade-in flex items-center gap-2 duration-150">
      {canRebaseToTrunk && (
        <button
          type="button"
          onClick={onRebase}
          disabled={isLoading}
          className={SECONDARY_BUTTON_CLASS}
        >
          Rebase
        </button>
      )}
      <div
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
          <Popover open={isChecksOpen} onOpenChange={setIsChecksOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="cursor-pointer hover:opacity-70"
              >
                <ChecksIcon
                  checksStatus={checksStatus}
                  reviewsRequired={reviewsRequired}
                  canShip={branchCanShip}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-w-[340px] min-w-[240px] p-3">
              <ChecksPopoverContent
                checks={checks}
                reviewsRequired={reviewsRequired}
                blockReasons={blockReasons}
                canMerge={canShipNow}
                mergeStrategy={mergeStrategy}
                onMerge={onShipIt}
                isMerging={isShipping}
              />
            </PopoverContent>
          </Popover>
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
      {(!pr.isInSync || pr.hasBaseDrift) && (
        <button
          onClick={onUpdatePr}
          disabled={isLoading}
          className="border-warning/50 bg-warning/20 text-warning hover:bg-warning/10 inline-flex cursor-pointer items-center rounded-lg border px-2 py-1 text-xs font-medium transition-colors select-none disabled:opacity-50"
          title={
            pr.hasBaseDrift
              ? 'PR target branch has changed. Click to update.'
              : 'Local branch is ahead/behind remote. Click to force push.'
          }
        >
          {isLoading ? 'Updating...' : 'Update PR'}
        </button>
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

function MergedBranchSection({
  mergedBranchToCleanup,
  isLoading,
  onCleanup
}: {
  mergedBranchToCleanup: UiBranch | null
  isLoading: boolean
  onCleanup: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div className="animate-in fade-in flex items-center gap-2 duration-150">
      <span className="text-muted-foreground text-sm">(Merged)</span>
      {mergedBranchToCleanup && (
        <button
          type="button"
          onClick={onCleanup}
          disabled={isLoading}
          className={SECONDARY_BUTTON_CLASS}
        >
          {isLoading ? 'Cleaning...' : 'Clean up'}
        </button>
      )}
    </div>
  )
}

function LoadingSection({
  canRebaseToTrunk,
  isLoading,
  onRebase
}: {
  canRebaseToTrunk: boolean
  isLoading: boolean
  onRebase: (e: React.MouseEvent) => void
}): React.JSX.Element | null {
  if (!canRebaseToTrunk) return null

  return (
    <button
      type="button"
      onClick={onRebase}
      disabled={isLoading}
      className={SECONDARY_BUTTON_CLASS}
    >
      Rebase
    </button>
  )
}

function CreatePrSection({
  canRebaseToTrunk,
  isLoading,
  error,
  canCreatePr,
  createPrBlockedReason,
  onRebase,
  onCreatePr
}: {
  canRebaseToTrunk: boolean
  isLoading: boolean
  error: string | null
  canCreatePr?: boolean
  createPrBlockedReason?: string
  onRebase: (e: React.MouseEvent) => void
  onCreatePr: (e?: React.MouseEvent) => void
}): React.JSX.Element {
  const isBlocked = canCreatePr === false
  const isDisabled = isLoading || isBlocked

  return (
    <div className="animate-in fade-in flex items-center gap-2 duration-150">
      {canRebaseToTrunk && (
        <button
          type="button"
          onClick={onRebase}
          disabled={isLoading}
          className={SECONDARY_BUTTON_CLASS}
        >
          Rebase
        </button>
      )}
      <Tooltip content={createPrBlockedReason} disabled={!isBlocked} delayDuration={300}>
        <button
          type="button"
          onClick={onCreatePr}
          disabled={isDisabled}
          className={cn(
            'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors',
            error
              ? 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500/20'
              : isBlocked
                ? 'text-muted-foreground/50 bg-muted/50 border-border cursor-not-allowed'
                : 'text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30',
            isDisabled && 'disabled:opacity-50'
          )}
          title={error || undefined}
        >
          {isLoading ? 'Creating PR...' : error ? 'Failed - Retry' : 'Create PR'}
        </button>
      </Tooltip>
      {error && (
        <span className="max-w-[200px] text-[10px] wrap-break-word text-red-500" title={error}>
          {error.length > 50 ? `${error.substring(0, 50)}...` : error}
        </span>
      )}
    </div>
  )
}

function ChecksIcon({
  checksStatus,
  reviewsRequired,
  canShip
}: {
  checksStatus: string
  reviewsRequired?: boolean
  canShip?: boolean
}): React.JSX.Element {
  if (canShip === false) {
    return <BadgeMinusIcon className="text-muted-foreground h-4 w-4" />
  }

  if (reviewsRequired && checksStatus === 'success') {
    return <BadgeCheckIcon className="h-4 w-4 text-yellow-500" />
  }

  switch (checksStatus) {
    case 'success':
      return <BadgeCheckIcon className="h-4 w-4 text-green-500" />
    case 'failure':
      return <BadgeXIcon className="h-4 w-4 text-red-500" />
    case 'pending':
      return <Loader2Icon className="h-4 w-4 animate-spin text-yellow-500" />
    case 'expected':
      return <CircleDotIcon className="h-4 w-4 text-yellow-500" />
    default:
      return <CircleSlashIcon className="text-muted-foreground h-4 w-4" />
  }
}

function getBlockReasonLabel(reason: MergeBlockReason): string {
  switch (reason) {
    case 'not_in_sync':
      return 'Local branch out of sync'
    case 'stale_target':
      return 'Target branch was merged'
    case 'not_off_trunk':
      return 'PR does not target trunk'
    case 'not_mergeable':
      return 'Not mergeable'
    case 'checks_pending':
      return 'Checks pending'
    case 'checks_failed':
      return 'Checks failed'
    case 'reviews_required':
      return 'Waiting for review'
    case 'conflicts':
      return 'Has merge conflicts'
    case 'branch_protection':
      return 'Branch protection rules'
    default:
      return 'Cannot merge'
  }
}

function ChecksPopoverContent({
  checks,
  reviewsRequired,
  blockReasons,
  canMerge,
  mergeStrategy,
  onMerge,
  isMerging
}: {
  checks: StatusCheck[]
  reviewsRequired?: boolean
  blockReasons: MergeBlockReason[]
  canMerge?: boolean
  mergeStrategy?: 'squash' | 'merge' | 'rebase' | 'fast-forward'
  onMerge?: () => void
  isMerging?: boolean
}): React.JSX.Element {
  const mergeLabel =
    mergeStrategy === 'squash'
      ? 'Squash and merge'
      : mergeStrategy === 'merge'
        ? 'Merge pull request'
        : mergeStrategy === 'fast-forward'
          ? 'Fast-forward merge'
          : 'Rebase and merge'

  const additionalBlockers = blockReasons.filter(
    (r) => r !== 'reviews_required' && r !== 'checks_pending' && r !== 'checks_failed'
  )

  return (
    <>
      <ScrollArea className="max-h-[200px]">
        <div className="flex flex-col gap-1.5">
          {[...checks]
            .sort((a, b) => {
              const order: Record<string, number> = {
                success: 0,
                failure: 1,
                neutral: 2,
                skipped: 2,
                pending: 3,
                expected: 3
              }
              return (order[a.status] ?? 3) - (order[b.status] ?? 3)
            })
            .map((check, index) => (
              <CheckItemRow key={index} check={check} />
            ))}
          {reviewsRequired && (
            <div className="flex items-center gap-2 py-0.5">
              <div className="shrink-0">
                <CircleDotIcon className="h-4 w-4 text-yellow-500" />
              </div>
              <div className="truncate text-sm">Waiting for review</div>
            </div>
          )}
          {additionalBlockers.map((reason) => (
            <div key={reason} className="flex cursor-pointer items-center gap-2 py-0.5">
              <div className="shrink-0">
                {reason === 'not_off_trunk' ? (
                  <CircleSlashIcon className="text-muted-foreground h-4 w-4" />
                ) : (
                  <XCircleIcon className="h-4 w-4 text-red-500" />
                )}
              </div>
              <div className="truncate text-sm">{getBlockReasonLabel(reason)}</div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="border-border mt-2 border-t pt-2">
        {canMerge && onMerge ? (
          <button
            type="button"
            onClick={onMerge}
            disabled={isMerging}
            className="w-full cursor-pointer rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {isMerging ? 'Merging...' : mergeLabel}
          </button>
        ) : (
          <div className="text-muted-foreground hover:bg-muted/50 w-full cursor-default rounded-md border border-dashed px-3 py-1.5 text-center text-sm transition-colors">
            Cannot merge yet
          </div>
        )}
      </div>
    </>
  )
}

function CheckItemRow({ check }: { check: StatusCheck }): React.JSX.Element {
  const icon = getCheckStatusIcon(check.status)
  const content = (
    <div className="flex items-start gap-2 py-0.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{check.name}</div>
        {check.description && (
          <div className="text-muted-foreground truncate text-xs">{check.description}</div>
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
      return <CheckCircle2Icon className="h-4 w-4 text-green-500" />
    case 'failure':
      return <XCircleIcon className="h-4 w-4 text-red-500" />
    case 'pending':
      return <Loader2Icon className="h-4 w-4 animate-spin text-yellow-500" />
    case 'expected':
      return <CircleDotIcon className="h-4 w-4 text-yellow-500" />
    case 'neutral':
    case 'skipped':
      return <CircleDotIcon className="text-muted-foreground h-4 w-4" />
    default:
      return <CircleSlashIcon className="text-muted-foreground h-4 w-4" />
  }
}
