import { log } from '@shared/logger'
import type {
  BranchCollisionResolution,
  SquashPreview,
  UiBranch,
  UiCommit,
  UiStack,
  UiWorkingTreeFile,
  UiWorktreeBadge
} from '@shared/types'
import { Loader2 } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useDragContext } from '../contexts/DragContext'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { getEditMessageState } from '../utils/edit-message-state'
import { formatRelativeTime } from '../utils/format-relative-time'
import { CollapsedCommits } from './CollapsedCommits'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { CreateBranchButton } from './CreateBranchButton'
import { EditCommitMessageDialog } from './EditCommitMessageDialog'
import { GitForgeSection } from './GitForgeSection'
import { MultiBranchBadge } from './MultiBranchBadge'
import { SquashConfirmDialog } from './SquashConfirmDialog'
import { CommitDot, SineCurve } from './SvgPaths'
import { WorkingTreeView } from './WorkingTreeView'
import { WorktreeBadge } from './WorktreeBadge'

interface StackProps {
  data: UiStack
  className?: string
  workingTree: UiWorkingTreeFile[]
  /** Whether this is the root/topmost stack (shows sync button) */
  isRoot?: boolean
  /** Pre-computed set of commit SHAs that are part of the current drag/rebase operation (passed from parent) */
  parentDraggedCommitSet?: Set<string> | null
}

interface CommitProps {
  data: UiCommit
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
  /** Pre-computed set of commit SHAs that are part of the current drag/rebase operation */
  draggedCommitSet: Set<string> | null
}

export function StackView({
  data,
  className,
  workingTree,
  parentDraggedCommitSet
}: StackProps): React.JSX.Element {
  const { draggingCommitSha, pendingRebase } = useDragContext()

  // Track which branches have their owned commits expanded
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set())

  // Clean up stale branch names from expandedBranches when branches are deleted
  useEffect(() => {
    const currentBranchNames = new Set<string>()
    for (const commit of data.commits) {
      for (const branch of commit.branches) {
        currentBranchNames.add(branch.name)
      }
    }

    setExpandedBranches((prev) => {
      const filtered = new Set([...prev].filter((name) => currentBranchNames.has(name)))
      // Only update if something was actually removed (avoids unnecessary re-renders)
      return filtered.size === prev.size ? prev : filtered
    })
  }, [data.commits])

  // Build the set of commits that will be affected by the current drag/rebase operation
  // If we have a parent set (from root StackView), use that. Otherwise compute for this stack.
  // The root StackView builds a set that includes all spinoffs recursively.
  const rebasingSha = draggingCommitSha || pendingRebase?.headSha
  const draggedCommitSet = useMemo(() => {
    // If parent already computed the set, use it (avoids recomputation in nested StackViews)
    if (parentDraggedCommitSet !== undefined) {
      return parentDraggedCommitSet
    }
    // Only compute when there's actually a drag/rebase in progress
    if (!rebasingSha) return null
    return buildDraggedCommitSet(rebasingSha, data)
  }, [parentDraggedCommitSet, rebasingSha, data])

  const toggleBranchExpanded = useCallback((branchName: string) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(branchName)) {
        next.delete(branchName)
      } else {
        next.add(branchName)
      }
      return next
    })
  }, [])

  // Build a map of branches that have multiple owned commits (for collapse/expand UI)
  // This only depends on data.commits, not on expandedBranches state
  const collapsibleBranches = useMemo(() => {
    const collapsible = new Map<string, { branch: UiBranch; ownedCount: number }>()

    for (const commit of data.commits) {
      for (const branch of commit.branches) {
        // Validation: local non-trunk branches should always have ownedCommitShas with at least 1 entry
        if (!branch.isRemote && !branch.isTrunk) {
          if (!branch.ownedCommitShas) {
            log.warn('[StackView] Branch is missing ownedCommitShas', {
              branchName: branch.name,
              hint: 'This may indicate a bug in UiStateBuilder'
            })
          } else if (branch.ownedCommitShas.length === 0) {
            log.warn('[StackView] Branch has empty ownedCommitShas array', {
              branchName: branch.name,
              hint: 'This may indicate incomplete commit data'
            })
          }
        }

        const ownedShas = branch.ownedCommitShas
        if (ownedShas && ownedShas.length > 1) {
          // This branch owns multiple commits (head + parents)
          collapsible.set(branch.name, { branch, ownedCount: ownedShas.length - 1 })
        }
      }
    }

    return collapsible
  }, [data.commits])

  // Compute which commits should be hidden based on expansion state
  // This depends on both collapsibleBranches and expandedBranches
  const hiddenCommitShas = useMemo(() => {
    const hidden = new Set<string>()

    for (const [branchName, info] of collapsibleBranches) {
      // If not expanded, hide all owned commits except the head
      if (!expandedBranches.has(branchName)) {
        const ownedShas = info.branch.ownedCommitShas
        if (ownedShas) {
          for (let i = 1; i < ownedShas.length; i++) {
            hidden.add(ownedShas[i])
          }
        }
      }
    }

    return hidden
  }, [collapsibleBranches, expandedBranches])

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
        {childrenFirst.map((commit) => {
          // Skip hidden commits (owned by a collapsed branch)
          if (hiddenCommitShas.has(commit.sha)) {
            return null
          }

          // Find if this commit's branch has collapsible owned commits
          const branchWithOwnedCommits = commit.branches.find((b) =>
            collapsibleBranches.has(b.name)
          )
          const collapsibleInfo = branchWithOwnedCommits
            ? collapsibleBranches.get(branchWithOwnedCommits.name)
            : null

          return (
            <React.Fragment key={commit.sha}>
              <CommitView
                data={commit}
                stack={data}
                workingTree={workingTree}
                draggedCommitSet={draggedCommitSet}
              />
              {collapsibleInfo && (
                <div className="pl-2">
                  <div className="border-border flex border-l-2">
                    <CollapsedCommits
                      count={collapsibleInfo.ownedCount}
                      isExpanded={expandedBranches.has(collapsibleInfo.branch.name)}
                      onToggle={() => toggleBranchExpanded(collapsibleInfo.branch.name)}
                      className="ml-2"
                    />
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

export const CommitView = memo(function CommitView({
  data,
  stack,
  workingTree,
  draggedCommitSet
}: CommitProps): React.JSX.Element {
  const isHead = data.isCurrent || data.branches.some((branch) => branch.isCurrent)
  const editMessageState = getEditMessageState({ isHead, isTrunk: stack.isTrunk })
  const { handleCommitDotMouseDown, registerCommitRef, unregisterCommitRef } = useDragContext()
  const {
    confirmRebaseIntent,
    cancelRebaseIntent,
    uncommit,
    uiState,
    isRebasingWithConflicts,
    switchWorktree,
    getSquashPreview,
    squashIntoParent
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
    isHead && workingTree && workingTree.length > 0 && !isRebasingWithConflicts

  const isTopOfStack = data.sha === stack.commits[stack.commits.length - 1].sha
  const isBeingDragged = isPartOfDraggedStack(data.sha, draggedCommitSet)

  const hasSpinoffs = data.spinoffs.length > 0

  const [isCanceling, setIsCanceling] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isUncommitting, setIsUncommitting] = useState(false)
  const [isEditMessageDialogOpen, setIsEditMessageDialogOpen] = useState(false)
  const [isSquashDialogOpen, setIsSquashDialogOpen] = useState(false)
  const [squashPreviewData, setSquashPreviewData] = useState<SquashPreview | null>(null)
  const [isLoadingSquashPreview, setIsLoadingSquashPreview] = useState(false)
  const [isSquashing, setIsSquashing] = useState(false)

  const handleConfirmRebase = useCallback(async (): Promise<void> => {
    setIsConfirming(true)
    try {
      await confirmRebaseIntent()
    } finally {
      setIsConfirming(false)
    }
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

  const handleCopyCommitSha = useCallback(() => {
    navigator.clipboard.writeText(data.sha)
  }, [data.sha])

  // Squash handlers
  const handleOpenSquashDialog = useCallback(async () => {
    setIsLoadingSquashPreview(true)
    try {
      const preview = await getSquashPreview({ commitSha: data.sha })
      if (!preview.canSquash) {
        toast.error(preview.errorDetail || 'Cannot squash into trunk')
        return
      }
      setSquashPreviewData(preview)
      setIsSquashDialogOpen(true)
    } catch (error) {
      toast.error('Failed to load squash preview', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsLoadingSquashPreview(false)
    }
  }, [data.sha, getSquashPreview])

  const handleConfirmSquash = useCallback(
    async (commitMessage: string, branchResolution?: BranchCollisionResolution) => {
      if (!squashPreviewData) return
      setIsSquashing(true)
      try {
        const result = await squashIntoParent({
          commitSha: data.sha,
          commitMessage,
          branchResolution
        })
        if (result?.success || result?.localSuccess) {
          setIsSquashDialogOpen(false)
          setSquashPreviewData(null)
        }
      } finally {
        setIsSquashing(false)
      }
    },
    [data.sha, squashIntoParent, squashPreviewData]
  )

  // Determine if squash should be enabled (not on trunk, not parent on trunk)
  const canSquash = !stack.isTrunk

  return (
    <div className={cn('w-full pl-2 whitespace-nowrap')}>
      {hasSpinoffs && (
        <div className={cn('border-border flex h-auto w-full border-l-2 pt-2')}>
          <div className="ml-[-2px] w-full">
            {data.spinoffs.map((spinoff) => {
              // Use branch name as key (more stable across rebases), fallback to SHA
              const firstCommit = spinoff.commits[0]
              const branchName = firstCommit?.branches.find((b) => !b.isRemote)?.name
              const stableKey = branchName ?? firstCommit?.sha ?? 'empty'
              return (
                <div key={`spinoff-${stableKey}`}>
                  <StackView
                    className="ml-[12px]"
                    data={spinoff}
                    workingTree={workingTree}
                    parentDraggedCommitSet={draggedCommitSet}
                  />
                  <SineCurve />
                </div>
              )
            })}
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
            variant={isHead ? 'current' : 'default'}
            accentLines={showWorkingTree ? 'top' : 'none'}
          />
          {data.branches.length > 0 && (
            <MultiBranchBadge branches={data.branches} commitSha={data.sha} />
          )}
          {data.branches.length === 0 && !stack.isTrunk && (
            <CreateBranchButton commitSha={data.sha} />
          )}
        </div>
        <ContextMenu
          content={
            <>
              <ContextMenuItem
                onClick={() => setIsEditMessageDialogOpen(true)}
                disabled={!editMessageState.canEdit}
                disabledReason={editMessageState.disabledReason}
              >
                Amend message
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleOpenSquashDialog}
                disabled={isLoadingSquashPreview || !canSquash}
                disabledReason={!canSquash ? 'Cannot squash into trunk' : undefined}
              >
                {isLoadingSquashPreview ? 'Checking...' : 'Squash into parent'}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleCopyCommitSha}>Copy commit SHA</ContextMenuItem>
            </>
          }
        >
          <div
            className={cn(
              'text-sm whitespace-nowrap',
              isHead && 'font-semibold',
              data.branches.some((b) => b.isMerged) && 'text-muted-foreground line-through'
            )}
          >
            {data.name}
          </div>
        </ContextMenu>
        <div className="text-muted-foreground text-xs">{formatRelativeTime(data.timestampMs)}</div>
        {data.rebaseStatus !== 'prompting' && data.rebaseStatus !== 'queued' && (
          <>
            <GitForgeSection
              branches={data.branches}
              isTrunk={stack.isTrunk}
              commitSha={data.sha}
              trunkHeadSha={trunkHeadSha}
              canRebaseToTrunk={stack.canRebaseToTrunk}
            />
            {!stack.isTrunk && isHead && (
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
              .map((branch) => (
                <WorktreeBadge
                  key={`wt-${branch.name}`}
                  data={branch.worktree}
                  onSwitch={handleSwitchWorktree}
                />
              ))}
          </>
        )}
        {data.rebaseStatus === 'prompting' && (
          <div className="flex gap-2">
            <button
              onClick={handleCancelRebase}
              disabled={isCanceling || isConfirming}
              className="border-border bg-muted text-foreground hover:bg-muted/80 flex items-center gap-1 rounded border px-3 py-1 text-xs transition-colors disabled:opacity-50"
            >
              {isCanceling && <Loader2 className="h-3 w-3 animate-spin" />}
              Cancel
            </button>
            <button
              onClick={handleConfirmRebase}
              disabled={isCanceling || isConfirming}
              className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-1 rounded px-3 py-1 text-xs transition-colors disabled:opacity-50"
            >
              {isConfirming && <Loader2 className="h-3 w-3 animate-spin" />}
              Confirm
            </button>
          </div>
        )}
      </div>
      <EditCommitMessageDialog
        open={isEditMessageDialogOpen}
        onOpenChange={setIsEditMessageDialogOpen}
        commitSha={data.sha}
      />
      {squashPreviewData && (
        <SquashConfirmDialog
          open={isSquashDialogOpen}
          onOpenChange={(open) => {
            setIsSquashDialogOpen(open)
            if (!open) setSquashPreviewData(null)
          }}
          preview={squashPreviewData}
          onConfirm={handleConfirmSquash}
          isSubmitting={isSquashing}
        />
      )}
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

/**
 * Builds a set of all commit SHAs that would be affected when dragging from a given commit.
 * This includes commits at or after the drag point, plus all commits owned by branches at the drag point.
 * Searches recursively through spinoffs to find the drag point in nested stacks.
 */
function buildDraggedCommitSet(draggingCommitSha: string, stack: UiStack): Set<string> | null {
  const draggedShas = new Set<string>()

  // Try to find the dragging commit in this stack or its spinoffs
  const found = findAndCollectDraggedCommits(draggingCommitSha, stack, draggedShas)

  return found ? draggedShas : null
}

/**
 * Recursively searches for the dragging commit and collects all affected SHAs.
 * Returns true if the dragging commit was found in this stack or its spinoffs.
 */
function findAndCollectDraggedCommits(
  draggingCommitSha: string,
  stack: UiStack,
  draggedShas: Set<string>
): boolean {
  // Check if the dragging commit is in this stack
  const draggingIdx = stack.commits.findIndex((c) => c.sha === draggingCommitSha)

  if (draggingIdx !== -1) {
    // Found the commit in this stack - collect all commits at or after this point
    // and all their spinoffs (child branches that will also move)
    for (let i = draggingIdx; i < stack.commits.length; i++) {
      const commit = stack.commits[i]
      draggedShas.add(commit.sha)

      // Include all commits owned by branches at this commit
      for (const branch of commit.branches) {
        if (branch.ownedCommitShas) {
          for (const sha of branch.ownedCommitShas) {
            draggedShas.add(sha)
          }
        }
      }

      // Include all spinoffs of this commit (child branches that will move with the rebase)
      for (const spinoff of commit.spinoffs) {
        collectAllCommitsInStack(spinoff, draggedShas)
      }
    }
    return true
  }

  // Not found in this stack - search spinoffs of each commit
  for (const commit of stack.commits) {
    for (const spinoff of commit.spinoffs) {
      if (findAndCollectDraggedCommits(draggingCommitSha, spinoff, draggedShas)) {
        return true
      }
    }
  }

  return false
}

/**
 * Collects all commit SHAs from a stack and its spinoffs recursively.
 * Used to include all child branches when dragging a parent branch.
 */
function collectAllCommitsInStack(stack: UiStack, draggedShas: Set<string>): void {
  for (const commit of stack.commits) {
    draggedShas.add(commit.sha)

    // Include owned commits from branches
    for (const branch of commit.branches) {
      if (branch.ownedCommitShas) {
        for (const sha of branch.ownedCommitShas) {
          draggedShas.add(sha)
        }
      }
    }

    // Recurse into spinoffs
    for (const spinoff of commit.spinoffs) {
      collectAllCommitsInStack(spinoff, draggedShas)
    }
  }
}

function isPartOfDraggedStack(commitSha: string, draggedCommitSet: Set<string> | null): boolean {
  if (!draggedCommitSet) return false
  return draggedCommitSet.has(commitSha)
}
