import { log } from '@shared/logger'
import type { UiBranch } from '@shared/types'
import { hasChildPrs } from '@shared/types/git-forge'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useForgeStateContext } from '../contexts/ForgeStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { canRebase } from '../utils/can-rebase'
import { cn } from '../utils/cn'
import { getMergedBranchToCleanup } from '../utils/get-merged-branch-to-cleanup'

interface GitForgeSectionProps {
  branches: UiBranch[]
  isTrunk: boolean
  /** The SHA of the commit being displayed (used for rebase headSha) */
  commitSha: string
  /** The SHA of the current trunk head commit */
  trunkHeadSha: string
  /** The SHA of the trunk commit this spinoff branches off from. Used to determine if rebase is needed. */
  baseSha: string
}

/**
 * This component is about anything regarding git forge within a given commit.
 */
export const GitForgeSection = memo(function GitForgeSection({
  branches,
  isTrunk,
  commitSha,
  trunkHeadSha,
  baseSha
}: GitForgeSectionProps): React.JSX.Element | null {
  const {
    createPullRequest,
    updatePullRequest,
    submitRebaseIntent,
    cleanupBranch,
    shipIt,
    isWorkingTreeDirty
  } = useUiStateContext()
  const { forgeState } = useForgeStateContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shipItError, setShipItError] = useState<string | null>(null)

  // Memoize derived values
  const mergedBranchToCleanup = useMemo(() => getMergedBranchToCleanup(branches), [branches])
  const branchWithPr = useMemo(() => branches.find((b) => b.pullRequest), [branches])
  const pr = branchWithPr?.pullRequest
  const isMerged = useMemo(() => branches.some((b) => b.isMerged), [branches])
  const showRebaseButton = useMemo(
    () => canRebase({ baseSha, trunkHeadSha, isWorkingTreeDirty }),
    [baseSha, trunkHeadSha, isWorkingTreeDirty]
  )

  /**
   * Determines if this branch is at the bottom of a PR stack.
   * A branch is at the bottom if no other open/draft PRs target it as their base.
   * Ship It should only be available for bottom-of-stack branches to prevent
   * shipping a branch that would leave orphaned child PRs.
   */
  const isBottomOfStack = useMemo(() => {
    if (!branchWithPr || !forgeState?.pullRequests) return false
    return !hasChildPrs(branchWithPr.name, forgeState.pullRequests)
  }, [branchWithPr, forgeState?.pullRequests])

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
      } catch (error) {
        log.error('Failed to update PR:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, branchWithPr, updatePullRequest]
  )

  const handleRebase = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading || isWorkingTreeDirty) return

      setIsLoading(true)
      try {
        await submitRebaseIntent({ headSha: commitSha, baseSha: trunkHeadSha })
      } catch (error) {
        log.error('Failed to initiate rebase:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, isWorkingTreeDirty, submitRebaseIntent, commitSha, trunkHeadSha]
  )

  const handleShipIt = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isLoading || !branchWithPr) return

      setIsLoading(true)
      setShipItError(null)
      try {
        await shipIt({ branchName: branchWithPr.name })
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
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
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
    return (
      <div className="flex items-center gap-2">
        {showRebaseButton && !prIsMerged && (
          <button
            type="button"
            onClick={handleRebase}
            disabled={isLoading}
            className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
          >
            Rebase
          </button>
        )}
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'cursor-pointer text-sm hover:underline',
            prIsMerged ? 'text-muted-foreground' : pr.isInSync ? 'text-accent' : 'text-warning'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
          {prIsMerged && ' (Merged)'}
          {!prIsMerged && !pr.isInSync && ' (Out of sync)'}
        </a>
        {!prIsMerged && !pr.isInSync && (
          <button
            onClick={handleUpdatePr}
            disabled={isLoading}
            className="border-warning/50 bg-warning/20 text-warning hover:bg-warning/10 inline-flex cursor-pointer items-center rounded-lg border px-2 py-1 text-xs font-medium transition-colors select-none disabled:opacity-50"
            title="Local branch is ahead/behind remote. Click to force push."
          >
            {isLoading ? 'Updating...' : 'Update PR'}
          </button>
        )}
        {/* Ship It button - only show when:
            1. PR is not merged
            2. PR is in sync with local branch
            3. PR is mergeable (no conflicts, checks pass)
            4. Working tree is clean
            5. PR target is not stale (target branch hasn't been merged)
            6. Branch is at bottom of stack (no child PRs targeting this branch)
        */}
        {!prIsMerged &&
          pr.isInSync &&
          pr.isMergeable &&
          !isWorkingTreeDirty &&
          !branchWithPr?.hasStaleTarget &&
          isBottomOfStack && (
            <button
              type="button"
              onClick={handleShipIt}
              disabled={isLoading}
              className={cn(
                'cursor-pointer rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                shipItError
                  ? 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500/20'
                  : 'border-green-700 bg-green-600 text-white hover:bg-green-700'
              )}
              title={shipItError || undefined}
            >
              {isLoading ? 'Shipping...' : shipItError ? 'Failed - Retry' : 'Ship it!'}
            </button>
          )}
        {shipItError && (
          <span
            className="max-w-[200px] text-[10px] wrap-break-word text-red-500"
            title={shipItError}
          >
            {shipItError.length > 50 ? `${shipItError.substring(0, 50)}...` : shipItError}
          </span>
        )}
        {!prIsMerged && branchWithPr?.hasStaleTarget && (
          <span
            className="border-warning/50 bg-warning/20 text-warning inline-flex items-center rounded-lg border px-2 py-1 text-xs font-medium"
            title="PR target branch has been merged. Update the PR target first."
          >
            Stale target
          </span>
        )}
        {prIsMerged && mergedBranchToCleanup && (
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
