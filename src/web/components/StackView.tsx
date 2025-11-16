import type { UiCommit, UiStack, UiWorkingTreeFile } from '@shared/types'
import React, { useEffect, useRef } from 'react'
import { useDragContext } from '../contexts/DragContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { formatRelativeTime } from '../utils/format-relative-time'
import { BranchBadge } from './BranchBadge'
import { RebaseStatusBadge } from './RebaseStatusBadge'
import { CommitDot, SineCurve } from './SvgPaths'
import { WorkingTreeView } from './WorkingTreeView'

interface StackProps {
  data: UiStack
  className?: string
  workingTree: UiWorkingTreeFile[]
}

interface CommitProps {
  data: UiCommit
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
}

export function StackView({ data, className, workingTree }: StackProps): React.JSX.Element {
  // Display in reverse order: children first (higher index), parents last (lower index)
  const childrenFirst = [...data.commits].reverse()

  return (
    <div className={cn('flex flex-col', className)}>
      {childrenFirst.map((commit, index) => (
        <CommitView
          key={`${commit.name}-${commit.timestampMs}-${index}`}
          data={commit}
          stack={data}
          workingTree={workingTree}
        />
      ))}
    </div>
  )
}

export function CommitView({ data, stack, workingTree }: CommitProps): React.JSX.Element {
  const isCurrent = data.isCurrent || data.branches.some((branch) => branch.isCurrent)
  const { handleCommitDotMouseDown, registerCommitRef, unregisterCommitRef } = useDragContext()
  const { setUiState } = useUiStateContext()

  const commitRef = useRef<HTMLDivElement>(null!)

  // Register/unregister this commit's ref
  useEffect(() => {
    registerCommitRef(data.sha, commitRef)
    return () => {
      unregisterCommitRef(data.sha)
    }
  }, [data.sha, registerCommitRef, unregisterCommitRef])

  const { showTopLine, showBottomLine } = getCommitDotLayout(data, stack, workingTree)

  const isPartOfRebasePlan = Boolean(data.rebaseStatus)

  const showWorkingTree = isCurrent && workingTree && workingTree.length > 0

  const isTopOfStack = data.sha === stack.commits[stack.commits.length - 1].sha

  const hasSpinoffs = data.spinoffs.length > 0

  const handleConfirmRebase = async (): Promise<void> => {
    const newUiState = await window.api.confirmRebaseIntent()
    if (!newUiState) return
    setUiState(newUiState)
  }

  const handleCancelRebase = async (): Promise<void> => {
    const newUiState = await window.api.cancelRebaseIntent()
    if (!newUiState) return
    setUiState(newUiState)
  }

  return (
    <div className="w-full pl-2">
      {hasSpinoffs && (
        <div className="flex w-full">
          <div className="border-border h-auto w-[2px] border-r-2" />
          <div className="ml-[-2px] w-full">
            {data.spinoffs.map((spinoff, index) => (
              <div key={`spinoff-${data.name}-${index}`}>
                <StackView className="ml-[12px]" data={spinoff} workingTree={workingTree} />
                <SineCurve />
              </div>
            ))}
          </div>
        </div>
      )}

      {Boolean(showWorkingTree && !isTopOfStack) && (
        <div className="flex w-full">
          <div className="border-border h-auto w-[2px] border-r-2" />
          <div className="ml-[-2px] w-full">
            <WorkingTreeView className="ml-[8px]" files={workingTree} />
            <SineCurve className="text-accent" />
          </div>
        </div>
      )}

      {Boolean(showWorkingTree && isTopOfStack) && (
        <WorkingTreeView className="-ml-[12px]" files={workingTree} />
      )}

      {/* Render the actual commit */}
      <div
        ref={commitRef}
        className={cn(
          '-ml-[11px] flex items-center gap-2 transition-colors',
          isPartOfRebasePlan && 'bg-accent/30'
        )}
      >
        <CommitDot
          top={showTopLine}
          bottom={showBottomLine}
          variant={isCurrent ? 'current' : 'default'}
          accentLines={showWorkingTree ? 'top' : 'none'}
          onMouseDown={() => handleCommitDotMouseDown(data.sha)}
        />
        {data.branches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.branches.map((branch, index) => (
              <BranchBadge key={`${branch.name}-${index}`} data={branch} />
            ))}
          </div>
        )}
        <div className={cn('font-mono text-sm', isCurrent && 'font-semibold')}>{data.name}</div>
        <div className="text-muted-foreground text-xs">{formatRelativeTime(data.timestampMs)}</div>
        {data.rebaseStatus && <RebaseStatusBadge status={data.rebaseStatus} />}
        {data.rebaseStatus === 'prompting' && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleCancelRebase}
              className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmRebase}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-xs transition-colors"
            >
              Confirm
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function getCommitDotLayout(
  commit: UiCommit,
  stack: UiStack,
  workingTree: UiWorkingTreeFile[]
): { showTopLine: boolean; showBottomLine: boolean } {
  // Array is ordered: parent first (lower index), child last (higher index)
  const commitIdx = stack.commits.indexOf(commit)

  let showTopLine = true
  let showBottomLine = true

  const isCurrentCommit = commit.isCurrent
  const hasFilesChanged = workingTree.length > 0
  const hasSpinoffs = commit.spinoffs.length > 0
  const isNewestCommit = commitIdx === stack.commits.length - 1
  const isOldestCommit = commitIdx === 0
  const isBaseStack = stack.isTrunk

  const isCommitShowingFiles = isCurrentCommit && hasFilesChanged

  if (isBaseStack && isOldestCommit) showBottomLine = false
  if (isNewestCommit && !hasSpinoffs && !isCommitShowingFiles) showTopLine = false

  return { showTopLine, showBottomLine }
}
