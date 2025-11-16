import React, { useRef, useEffect } from 'react'
import { cn } from '../utils/cn'
import type { UiStack, UiCommit, UiWorkingTreeFile } from '@shared/types'
import { useDragContext } from '../contexts/DragContext'
import { formatRelativeTime } from '../utils/format-relative-time'
import { RebaseStatusBadge } from './RebaseStatusBadge'
import { WorkingTreeView } from './WorkingTreeView'
import { CommitDot, SineCurve } from './SvgPaths'
import { BranchBadge } from './BranchBadge'

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

  return (
    <div className="pl-2 w-full">
      {hasSpinoffs && (
        <div className="flex w-full">
          <div className="w-[2px] h-auto border-border border-r-2" />
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
          <div className="w-[2px] h-auto border-border border-r-2" />
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
          'gap-2 flex items-center transition-colors -ml-[11px]',
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
        <div className="text-xs text-muted-foreground">{formatRelativeTime(data.timestampMs)}</div>
        {data.rebaseStatus && <RebaseStatusBadge status={data.rebaseStatus} />}
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
