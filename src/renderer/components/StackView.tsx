import React, { useRef, useEffect } from 'react'
import { cn } from '../utils/cn'
import type { UiStack, UiCommit, UiBranch } from '@shared/types'
import { useGlobalCtx } from '../contexts/GlobalContext'

interface StackProps {
  data: UiStack
  className?: string
}

interface CommitProps {
  data: UiCommit
  stack: UiStack
}

interface BranchProps {
  data: UiBranch
}

export function StackView({ data, className }: StackProps): React.JSX.Element {
  // Display in reverse order: children first (higher index), parents last (lower index)
  const childrenFirst = [...data.commits].reverse()

  return (
    <div className={cn('flex flex-col', className)}>
      {childrenFirst.map((commit, index) => (
        <CommitView
          key={`${commit.name}-${commit.timestampMs}-${index}`}
          data={commit}
          stack={data}
        />
      ))}
    </div>
  )
}

export function CommitView({ data, stack }: CommitProps): React.JSX.Element {
  const isCurrent = data.branches.some((branch) => branch.isCurrent)
  const { setDraggingCommitSha, registerCommitRef, unregisterCommitRef, isInsideDraggingStack } =
    useGlobalCtx()

  const commitRef = useRef<HTMLDivElement>(null!)

  // Register/unregister this commit's ref
  useEffect(() => {
    registerCommitRef(data.sha, commitRef)
    return () => {
      unregisterCommitRef(data.sha)
    }
  }, [data.sha, registerCommitRef, unregisterCommitRef])

  const { showTopLine, showBottomLine } = getCommitDotLayout(data, stack)

  const shouldHighlight = isInsideDraggingStack(data.sha)

  return (
    <div>
      {/* Render spinoffs first with left margin */}
      {data.spinoffs.length > 0 && (
        <div className="flex items-stretch">
          <div className="w-[2px] bg-border ml-[11px]" />
          <div className="ml-[-2px]">
            {data.spinoffs.map((spinoff, index) => (
              <div key={`spinoff-${data.name}-${index}`}>
                <StackView className="ml-[9px]" data={spinoff} />
                <SineCurve />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render the actual commit */}
      <div
        ref={commitRef}
        className={cn(
          'gap-2 flex items-center transition-colors',
          shouldHighlight && 'bg-accent/30'
        )}
      >
        <CommitDot
          showTopLine={showTopLine}
          showBottomLine={showBottomLine}
          onClick={() => setDraggingCommitSha(data.sha)}
        />
        {data.branches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.branches.map((branch, index) => (
              <BranchView key={`${branch.name}-${index}`} data={branch} />
            ))}
          </div>
        )}
        <div className={cn('font-mono text-sm', isCurrent && 'font-semibold')}>{data.name}</div>
        <div className="text-xs text-muted-foreground">
          {new Date(data.timestampMs).toISOString()}
        </div>
      </div>
    </div>
  )
}

export function BranchView({ data }: BranchProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${
        data.isCurrent
          ? 'bg-accent text-accent-foreground border border-accent-border'
          : 'bg-muted text-muted-foreground border border-border'
      }`}
    >
      {data.isCurrent && (
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {data.name}
    </span>
  )
}

function SineCurve({ className }: { className?: string }) {
  return (
    <svg
      className={cn('relative bottom-0 mb-0', className)}
      width="22"
      height="32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21 0C 21 22, 0 7, 1 32"
        strokeWidth="2px"
        className="stroke-border "
        fill="transparent"
      ></path>
    </svg>
  )
}

function CommitDot({
  showTopLine,
  showBottomLine,
  onClick
}: {
  showTopLine: boolean
  showBottomLine: boolean
  onClick?: () => void
}) {
  return (
    <svg
      width="24px"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      onClick={onClick}
      className={onClick ? 'cursor-grab' : ''}
    >
      {showTopLine && (
        <path d="M12,0 L12,15" strokeWidth="2px" className="stroke-border fill-transparent"></path>
      )}
      <circle
        cx="12"
        cy="18"
        r="4"
        className="stroke-border fill-transparent"
        strokeWidth="2"
        strokeDasharray="0"
      ></circle>
      {showBottomLine && (
        <path
          d="M12,22 L12,36"
          strokeWidth="2px"
          className="stroke-border fill-transparent"
          strokeDasharray="0"
        ></path>
      )}
    </svg>
  )
}

function getCommitDotLayout(
  commit: UiCommit,
  stack: UiStack
): { showTopLine: boolean; showBottomLine: boolean } {
  // Array is ordered: parent first (lower index), child last (higher index)
  const commitIdx = stack.commits.indexOf(commit)

  let showTopLine = true
  let showBottomLine = true

  const hasSpinoffs = commit.spinoffs.length > 0
  // Last commit in array is the newest (head/child)
  const isNewestCommit = commitIdx === stack.commits.length - 1
  // First commit in array is the oldest (parent)
  const isOldestCommit = commitIdx === 0
  const isBaseStack = stack.isTrunk

  if (isBaseStack && isOldestCommit) showBottomLine = false
  if (isNewestCommit && !hasSpinoffs) showTopLine = false

  return { showTopLine, showBottomLine }
}
