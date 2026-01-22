import { log } from '@shared/logger'
import type { UiBranch } from '@shared/types'
import { Loader2Icon } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { getMergedBranchToCleanup } from '../utils/get-merged-branch-to-cleanup'
import { getPrStateStyles } from '../utils/pr-state-styles'
import { StatusChecksDisplay } from './StatusChecksDisplay'
import { Tooltip } from './Tooltip'

interface GitForgeSectionProps {
  branches: UiBranch[]
  isTrunk: boolean
  /** The SHA of the commit being displayed (used for rebase headSha) */
  commitSha: string
  /** The SHA of the current trunk head commit (used for rebase target) */
  trunkHeadSha: string
  /** Whether this stack can be rebased to trunk (computed by backend) */
  canRebaseToTrunk: boolean
}

/**
 * This component is about anything regarding git forge within a given commit.
 */
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
    isWorkingTreeDirty
  } = useUiStateContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shipItError, setShipItError] = useState<string | null>(null)

  // Memoize derived values
  const mergedBranchToCleanup = useMemo(() => getMergedBranchToCleanup(branches), [branches])
  const branchWithPr = useMemo(() => branches.find((b) => b.pullRequest), [branches])
  const pr = branchWithPr?.pullRequest
  const isMerged = useMemo(() => branches.some((b) => b.isMerged), [branches])
  // Backend computes canRebaseToTrunk - parallel mode allows rebasing with dirty worktree
  const showRebaseButton = canRebaseToTrunk

  // Whether this branch can be shipped (directly off trunk + PR targets trunk)
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

  const handleShipIt = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading || !branchWithPr) return

      setIsLoading(true)
      setShipItError(null)
      try {
        await shipIt({ branchName: branchWithPr.name, canShip: branchWithPr.canShip })
      } catch (error) {
        log.error('Failed to ship it:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        setShipItError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, branchWithPr, shipIt]
  )

  const handleCreatePr = useCallback(
    async (e?: React.MouseEvent): Promise<void> => {
      e?.stopPropagation()
      if (isLoading) return

      // Pick the first available branch on the commit as requested.
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

  // For trunk commits, only show cleanup button for merged branches
  if (isTrunk) {
    if (!mergedBranchToCleanup) return null

    return (
      <button
        type="button"
        onClick={handleCleanup}
        disabled={isLoading}
        className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
      >
        {isLoading ? 'Cleaning...' : 'Clean up'}
      </button>
    )
  }

  if (pr) {
    const prIsMerged = pr.state === 'merged'
    const prIsClosed = pr.state === 'closed'
    const prIsActive = pr.state === 'open' || pr.state === 'draft'
    const mergeReadiness = pr.mergeReadiness
    const blockers = mergeReadiness?.blockers ?? []
    const checksStatus = mergeReadiness?.checksStatus ?? 'none'

    // Derive Ship It button state
    const isComputing = blockers.includes('computing')
    const checksRunning = blockers.includes('checks_pending')
    const checksFailed = blockers.includes('checks_failed')
    const hasConflicts = blockers.includes('conflicts')
    const reviewsRequired = blockers.includes('reviews_required')

    // PR link styling
    const prStyles = getPrStateStyles(pr.state)
    const showOutOfSync = prIsActive && !pr.isInSync

    // Ship It area visible when: active PR, in sync, no stale target, and branch can ship
    const showShipItArea =
      prIsActive &&
      !prIsMerged &&
      !prIsClosed &&
      pr.isInSync &&
      !branchWithPr?.hasStaleTarget &&
      branchCanShip

    // Determine button label and style
    const getShipItConfig = (): { label: string; style: string; disabled: boolean } => {
      if (isLoading) {
        return {
          label: 'Shipping...',
          style: 'border-green-700 bg-green-600 text-white',
          disabled: true
        }
      }
      if (shipItError) {
        return {
          label: 'Failed - Retry',
          style: 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500/20',
          disabled: false
        }
      }
      if (isWorkingTreeDirty && branchWithPr?.isCurrent) {
        return {
          label: 'Uncommitted changes',
          style: 'border-border bg-muted text-muted-foreground',
          disabled: true
        }
      }
      if (isComputing && checksStatus === 'none') {
        // Just created PR, no checks yet
        return {
          label: 'Checks incoming...',
          style: 'border-border bg-muted text-muted-foreground',
          disabled: true
        }
      }
      if (isComputing) {
        return {
          label: 'Computing...',
          style: 'border-border bg-muted text-muted-foreground',
          disabled: true
        }
      }
      if (checksFailed) {
        return {
          label: 'Checks failed',
          style: 'border-red-500 bg-red-500/10 text-red-500',
          disabled: true
        }
      }
      if (checksRunning) {
        return {
          label: 'Checks running...',
          style: 'border-yellow-500 bg-yellow-500/10 text-yellow-500',
          disabled: true
        }
      }
      if (hasConflicts) {
        return {
          label: 'Has conflicts',
          style: 'border-red-500 bg-red-500/10 text-red-500',
          disabled: true
        }
      }
      if (reviewsRequired) {
        return {
          label: 'Reviews pending',
          style: 'border-orange-500 bg-orange-500/10 text-orange-500',
          disabled: true
        }
      }
      if (pr.isMergeable) {
        return {
          label: 'Ship it!',
          style: 'border-green-700 bg-green-600 text-white hover:bg-green-700',
          disabled: false
        }
      }
      // Fallback for any other non-mergeable state
      return {
        label: 'Not ready',
        style: 'border-border bg-muted text-muted-foreground',
        disabled: true
      }
    }

    const shipItConfig = showShipItArea ? getShipItConfig() : null

    return (
      <div className="flex items-center gap-2">
        {showRebaseButton && prIsActive && (
          <button
            type="button"
            onClick={handleRebase}
            disabled={isLoading}
            className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
          >
            Rebase
          </button>
        )}
        {/* PR link with state-based coloring */}
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'cursor-pointer text-sm hover:underline',
            showOutOfSync ? 'text-warning' : prStyles.textClass
          )}
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
          {prStyles.label}
          {showOutOfSync && ' (Out of sync)'}
        </a>
        {/* Warning badge when multiple open PRs exist for same branch */}
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
        {/* Status checks display - hide when there are conflicts (irrelevant noise) */}
        {prIsActive && mergeReadiness && !hasConflicts && (
          <StatusChecksDisplay mergeReadiness={mergeReadiness} />
        )}
        {/* Update PR button - only show for active PRs that are out of sync */}
        {prIsActive && !pr.isInSync && (
          <button
            onClick={handleUpdatePr}
            disabled={isLoading}
            className="border-warning/50 bg-warning/20 text-warning hover:bg-warning/10 inline-flex cursor-pointer items-center rounded-lg border px-2 py-1 text-xs font-medium transition-colors select-none disabled:opacity-50"
            title="Local branch is ahead/behind remote. Click to force push."
          >
            {isLoading ? 'Updating...' : 'Update PR'}
          </button>
        )}
        {/* Ship It button with enhanced states */}
        {shipItConfig && (
          <Tooltip
            content={
              hasConflicts ? (
                <span>
                  PR has conflicts with the target branch.
                  <br />
                  Resolve on GitHub or rebase locally.
                </span>
              ) : undefined
            }
            disabled={!hasConflicts}
          >
            <button
              type="button"
              onClick={handleShipIt}
              disabled={shipItConfig.disabled || isLoading}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed',
                shipItConfig.style
              )}
              title={shipItError || undefined}
            >
              {checksRunning && <Loader2Icon className="h-3 w-3 animate-spin" />}
              {shipItConfig.label}
            </button>
          </Tooltip>
        )}
        {shipItError && (
          <span
            className="max-w-[200px] text-[10px] wrap-break-word text-red-500"
            title={shipItError}
          >
            {shipItError.length > 50 ? `${shipItError.substring(0, 50)}...` : shipItError}
          </span>
        )}
        {prIsActive && branchWithPr?.hasStaleTarget && (
          <span
            className="border-warning/50 bg-warning/20 text-warning inline-flex items-center rounded-lg border px-2 py-1 text-xs font-medium"
            title="PR target branch has been merged. Update the PR target first."
          >
            Stale target
          </span>
        )}
        {/* Show cleanup button for merged PRs, and also for closed PRs */}
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
        {/* Show "Create PR" button for closed PRs (not merged) - more discoverable than context menu */}
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

  // If any branch is merged (locally detected) but has no PR, show merged indicator and cleanup button
  if (isMerged) {
    return (
      <div className="flex items-center gap-2">
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

  return (
    <div className="flex items-center gap-2">
      {showRebaseButton && (
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
