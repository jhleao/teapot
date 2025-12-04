import type { UiBranch } from '@shared/types'
import React, { useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { log } from '@shared/logger'

interface GitForgeSectionProps {
  branches: UiBranch[]
  isTrunk: boolean
}

/**
 * This component is about anything regarding git forge within a given commit.
 */
export function GitForgeSection({
  branches,
  isTrunk
}: GitForgeSectionProps): React.JSX.Element | null {
  const { createPullRequest } = useUiStateContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isTrunk) return null
  if (branches.length === 0) return null

  // Pick the first PR associated with any branch associated with that commit.
  // If there's more than one branch with a PR, ignore the other one.
  // This is a known limitation where we only show one PR even if multiple branches on this commit have PRs.
  const branchWithPr = branches.find((b) => b.pullRequest)
  const pr = branchWithPr?.pullRequest

  if (pr) {
    return (
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'cursor-pointer text-sm hover:underline',
          pr.isInSync ? 'text-accent' : 'text-warning'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        #{pr.number}
        {!pr.isInSync && ' (Out of sync)'}
      </a>
    )
  }

  const handleCreatePr = async (e: React.MouseEvent): Promise<void> => {
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
      // Error dialog will be shown by the backend handler
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
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
        <span className="text-red-500 text-[10px] max-w-[200px] break-words" title={error}>
          {error.length > 50 ? `${error.substring(0, 50)}...` : error}
        </span>
      )}
    </div>
  )
}
