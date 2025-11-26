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
    try {
      await createPullRequest({ headBranch: branch.name })
    } catch (error) {
      log.error('Failed to create PR:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <button
      onClick={handleCreatePr}
      disabled={isLoading}
      className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors"
    >
      {isLoading ? 'Creating PR...' : 'Create PR'}
    </button>
  )
}
