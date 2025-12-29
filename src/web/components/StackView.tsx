import type { UiCommit, UiStack, UiWorkingTreeFile, UiWorktreeBadge } from '@shared/types'
import { Loader2 } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDragContext } from '../contexts/DragContext'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { formatRelativeTime } from '../utils/format-relative-time'
import { BranchBadge } from './BranchBadge'
import { CreateBranchButton } from './CreateBranchButton'
import { GitForgeSection } from './GitForgeSection'
import { CommitDot, SineCurve } from './SvgPaths'
import { WorkingTreeView } from './WorkingTreeView'
import { WorktreeBadge } from './WorktreeBadge'

interface StackProps {
  data: UiStack
  className?: string
  workingTree: UiWorkingTreeFile[]
  /** The SHA of the trunk commit this stack branches off from. Empty for trunk stack. */
  baseSha?: string
  /** Whether this is the root/topmost stack (shows sync button) */
  isRoot?: boolean
}

interface CommitProps {
  data: UiCommit
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
  /** The SHA of the trunk commit this stack branches off from. Empty for trunk stack. */
  baseSha?: string
}

export function StackView({
  data,
  className,
  workingTree,
  baseSha = ''
}: StackProps): React.JSX.Element {
  // Display in reverse order: children first (higher index), parents last (lower index)
  const childrenFirst = [...data.commits].reverse()

  return (
    <div>
      {Boolean(data.isTrunk) && (
        <div className="mb-[-16px]">
          <SyncButton />
          <div className="border-border ml-2 h-14 w-[2px] border-r-2" />
        </div>
      )}
      <div className={cn('flex flex-col', className)}>
        {childrenFirst.map((commit, index) => (
          <CommitView
            key={`${commit.name}-${commit.timestampMs}-${index}`}
            data={commit}
            stack={data}
            workingTree={workingTree}
            baseSha={baseSha}
          />
        ))}
      </div>
    </div>
  )
}

export const CommitView = memo(function CommitView({
  data,
  stack,
  workingTree,
  baseSha = ''
}: CommitProps): React.JSX.Element {
  const isCurrent = data.isCurrent || data.branches.some((branch) => branch.isCurrent)
  const {
    handleCommitDotMouseDown,
    registerCommitRef,
    unregisterCommitRef,
    draggingCommitSha,
    pendingRebase
  } = useDragContext()
  const {
    confirmRebaseIntent,
    cancelRebaseIntent,
    uncommit,
    uiState,
    isRebasingWithConflicts,
    switchWorktree,
    repoPath
  } = useUiStateContext()
  const { refreshRepos } = useLocalStateContext()

  const trunkHeadSha = uiState?.trunkHeadSha ?? ''

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

  const showWorkingTree =
    isCurrent && workingTree && workingTree.length > 0 && !isRebasingWithConflicts

  const isTopOfStack = data.sha === stack.commits[stack.commits.length - 1].sha
  const isBeingDragged = useMemo(() => {
    const rebasingSha = draggingCommitSha || pendingRebase?.headSha
    if (!rebasingSha) return false
    return isPartOfDraggedStack(data.sha, rebasingSha, stack)
  }, [data.sha, draggingCommitSha, pendingRebase, stack])

  const hasSpinoffs = data.spinoffs.length > 0

  const [isCanceling, setIsCanceling] = useState(false)
  const [isUncommitting, setIsUncommitting] = useState(false)

  const handleConfirmRebase = useCallback(async (): Promise<void> => {
    await confirmRebaseIntent()
  }, [confirmRebaseIntent])

  const handleCancelRebase = useCallback(async (): Promise<void> => {
    setIsCanceling(true)
    try {
      await cancelRebaseIntent()
    } finally {
      setIsCanceling(false)
    }
  }, [cancelRebaseIntent])

  const handleUncommit = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (isUncommitting) return
      setIsUncommitting(true)
      try {
        await uncommit({ commitSha: data.sha })
      } finally {
        setIsUncommitting(false)
      }
    },
    [uncommit, data.sha, isUncommitting]
  )

  const handleSwitchWorktree = useCallback(
    async (worktreePath: string) => {
      await switchWorktree({ worktreePath })
      await refreshRepos()
    },
    [switchWorktree, refreshRepos]
  )

  const onCommitDotMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleCommitDotMouseDown(data.sha, e)
    },
    [handleCommitDotMouseDown, data.sha]
  )

  return (
    <div className={cn('w-full pl-2 whitespace-nowrap')}>
      {hasSpinoffs && (
        <div className={cn('border-border flex h-auto w-full border-l-2 pt-2')}>
          <div className="ml-[-2px] w-full">
            {data.spinoffs.map((spinoff, index) => (
              <div key={`spinoff-${data.name}-${index}`}>
                <StackView
                  className="ml-[12px]"
                  data={spinoff}
                  workingTree={workingTree}
                  baseSha={data.sha}
                />
                <SineCurve />
              </div>
            ))}
          </div>
        </div>
      )}

      {Boolean(showWorkingTree && !isTopOfStack) && (
        <div className="flex w-full">
          <div className="border-border h-auto w-[2px] border-r-2" />
          <div className="ml-[-2px] w-full pt-4">
            <WorkingTreeView className="ml-[8px]" files={workingTree} />
            <SineCurve className="text-accent" />
          </div>
        </div>
      )}

      {Boolean(showWorkingTree && isTopOfStack) && (
        <div className="flex w-full">
          <div className="border-accent h-auto w-[2px] border-r-2" />
          <div className="ml-[-22px] w-full pb-4">
            <WorkingTreeView className="ml-[8px]" files={workingTree} />
          </div>
        </div>
      )}

      <div
        ref={commitRef}
        data-commit-sha={data.sha}
        className={cn(
          'relative -ml-[11px] flex items-center gap-2 transition-colors select-none',
          isPartOfRebasePlan && 'bg-accent/30',
          isBeingDragged && 'bg-accent/10'
        )}
      >
        {/* Drop indicator - shown/hidden via direct DOM manipulation in DragContext */}
        <div className="drop-indicator bg-accent absolute -top-px left-0 hidden h-[3px] w-full" />
        <div className="flex items-center gap-2" onMouseDown={onCommitDotMouseDown}>
          <CommitDot
            top={showTopLine}
            bottom={showBottomLine}
            variant={isCurrent ? 'current' : 'default'}
            accentLines={showWorkingTree ? 'top' : 'none'}
          />
          {data.branches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.branches.map((branch, index) => (
                <BranchBadge key={`${branch.name}-${index}`} data={branch} />
              ))}
            </div>
          )}
          {data.branches.length === 0 && !stack.isTrunk && (
            <CreateBranchButton commitSha={data.sha} />
          )}
        </div>
        <div
          className={cn(
            'text-sm whitespace-nowrap',
            isCurrent && 'font-semibold',
            data.branches.some((b) => b.isMerged) && 'text-muted-foreground line-through'
          )}
        >
          {data.name}
        </div>
        <div className="text-muted-foreground text-xs">{formatRelativeTime(data.timestampMs)}</div>
        {data.rebaseStatus !== 'prompting' && data.rebaseStatus !== 'queued' && (
          <>
            <GitForgeSection
              branches={data.branches}
              isTrunk={stack.isTrunk}
              commitSha={data.sha}
              trunkHeadSha={trunkHeadSha}
              baseSha={baseSha}
            />
            {!stack.isTrunk && isCurrent && (
              <button
                onClick={handleUncommit}
                disabled={isUncommitting}
                className="text-muted-foreground bg-muted border-border hover:bg-muted-foreground/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
              >
                {isUncommitting ? 'Uncommitting...' : 'Uncommit'}
              </button>
            )}
            {/* Worktree badges - show for branches checked out in other worktrees */}
            {data.branches
              .filter((b): b is typeof b & { worktree: UiWorktreeBadge } => b.worktree != null)
              .map((branch, index) => (
                <WorktreeBadge
                  key={`wt-${branch.name}-${index}`}
                  data={branch.worktree}
                  onSwitch={handleSwitchWorktree}
                  repoPath={repoPath ?? undefined}
                />
              ))}
          </>
        )}
        {data.rebaseStatus === 'prompting' && (
          <div className="flex gap-2">
            <button
              onClick={handleCancelRebase}
              disabled={isCanceling}
              className="border-border bg-muted text-foreground hover:bg-muted/80 flex items-center gap-1 rounded border px-3 py-1 text-xs transition-colors disabled:opacity-50"
            >
              {isCanceling && <Loader2 className="h-3 w-3 animate-spin" />}
              Cancel
            </button>
            <button
              onClick={handleConfirmRebase}
              disabled={isCanceling}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-xs transition-colors disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

function SyncButton(): React.JSX.Element | null {
  const { syncTrunk } = useUiStateContext()
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSyncTrunk = async (): Promise<void> => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      await syncTrunk()
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="mb-[-6px] flex items-center">
      <div className="text-border">
        <svg
          className="mr-2 h-5 w-5"
          fill="transparent"
          stroke="currentColor"
          strokeWidth={1.7}
          viewBox="0 0 20 20"
        >
          <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" />
        </svg>
      </div>
      <button
        onClick={handleSyncTrunk}
        disabled={isSyncing}
        className="bg-muted/50 text-muted-foreground/80 border-border/50 hover:bg-muted hover:text-muted-foreground inline-flex cursor-pointer items-center rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-70"
        title="Sync trunk with origin"
      >
        {isSyncing ? 'pulling...' : 'git pull'}
      </button>
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

function isPartOfDraggedStack(
  commitSha: string,
  draggingCommitSha: string,
  stack: UiStack
): boolean {
  const draggingIdx = stack.commits.findIndex((c) => c.sha === draggingCommitSha)
  if (draggingIdx === -1) return false

  const commitIdx = stack.commits.findIndex((c) => c.sha === commitSha)
  if (commitIdx === -1) return false

  return commitIdx >= draggingIdx
}
