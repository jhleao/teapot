import { log } from '@shared/logger'
import type { UiCommit, UiStack, UiWorkingTreeFile, UiWorktreeBadge } from '@shared/types'
import { Loader2 } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDragContext } from '../contexts/DragContext'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { canHideCommit, computeCollapsibleBranches } from '../utils/collapse-commits'
import { getEditMessageState } from '../utils/edit-message-state'
import { formatRelativeTime } from '../utils/format-relative-time'
import { CollapsedCommits } from './CollapsedCommits'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { CreateBranchButton } from './CreateBranchButton'
import { EditCommitMessageDialog } from './EditCommitMessageDialog'
import { GitForgeSection } from './GitForgeSection'
import { MultiBranchBadge } from './MultiBranchBadge'
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
  /** Whether this commit is a non-head owned commit of a collapsible branch */
  isOwned?: boolean
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

  // Build a map from SHA to commit for quick lookups (used for spinoff checks)
  const commitBySha = useMemo(() => {
    const map = new Map<string, UiCommit>()
    for (const commit of data.commits) {
      map.set(commit.sha, commit)
    }
    return map
  }, [data.commits])

  // Build a map of branches that have multiple owned commits (for collapse/expand UI)
  // This only depends on data.commits, not on expandedBranches state
  // Only counts commits that can actually be hidden (no spinoffs)
  const collapsibleBranches = useMemo(() => {
    // Validation logging for local non-trunk branches
    for (const commit of data.commits) {
      for (const branch of commit.branches) {
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
      }
    }

    return computeCollapsibleBranches(data.commits, commitBySha)
  }, [data.commits, commitBySha])

  // For each collapsible branch, compute the ordered list of hideable owned commits
  // These are rendered inside CollapsedCommits when expanded, reversed for display order (children first)
  const ownedCommitsByBranch = useMemo(() => {
    const map = new Map<string, UiCommit[]>()
    for (const [branchName, info] of collapsibleBranches) {
      const shas = info.branch.ownedCommitShas
      if (shas) {
        const commits: UiCommit[] = []
        for (let i = 1; i < shas.length; i++) {
          if (canHideCommit(shas[i], commitBySha)) {
            const commit = commitBySha.get(shas[i])
            if (commit) commits.push(commit)
          }
        }
        if (commits.length > 0) {
          map.set(branchName, commits)
        }
      }
    }
    return map
  }, [collapsibleBranches, commitBySha])

  // All SHAs delegated to CollapsedCommits containers — skip them in the main loop
  const delegatedCommitShas = useMemo(() => {
    const shas = new Set<string>()
    for (const commits of ownedCommitsByBranch.values()) {
      for (const commit of commits) {
        shas.add(commit.sha)
      }
    }
    return shas
  }, [ownedCommitsByBranch])

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
          // Skip commits delegated to CollapsedCommits containers
          if (delegatedCommitShas.has(commit.sha)) {
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
                <div className="-mt-1 pl-2">
                  <CollapsedCommits
                    count={collapsibleInfo.hideableCount}
                    isExpanded={expandedBranches.has(collapsibleInfo.branch.name)}
                    onToggle={() => toggleBranchExpanded(collapsibleInfo.branch.name)}
                    ownedCommits={ownedCommitsByBranch.get(collapsibleInfo.branch.name) ?? []}
                    stack={data}
                    workingTree={workingTree}
                    draggedCommitSet={draggedCommitSet}
                  />
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
  draggedCommitSet,
  isOwned
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
    switchWorktree
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
  const isTailOfStack = data.sha === stack.commits[0].sha
  const isBeingDragged = isPartOfDraggedStack(data.sha, draggedCommitSet)

  const hasSpinoffs = data.spinoffs.length > 0

  const [isCanceling, setIsCanceling] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isUncommitting, setIsUncommitting] = useState(false)
  const [isEditMessageDialogOpen, setIsEditMessageDialogOpen] = useState(false)

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
        <div onMouseDown={onCommitDotMouseDown}>
          <CommitDot
            top={!isOwned && showTopLine}
            bottom={!isOwned && showBottomLine}
            variant={isHead ? 'current' : data.isIndependent ? 'independent' : 'default'}
            accentLines={showWorkingTree ? 'top' : 'none'}
            showCircle={!isOwned}
          />
        </div>
        <div className="flex items-center gap-2">
          {data.branches.length > 0 && <MultiBranchBadge branches={data.branches} />}
          {data.branches.length === 0 && !stack.isTrunk && (
            <CreateBranchButton commitSha={data.sha} />
          )}
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
          <div className="text-muted-foreground text-xs">
            {formatRelativeTime(data.timestampMs)}
          </div>
          {data.rebaseStatus !== 'prompting' && data.rebaseStatus !== 'queued' && (
            <>
              <GitForgeSection
                branches={data.branches}
                isTrunk={stack.isTrunk}
                commitSha={data.sha}
                trunkHeadSha={trunkHeadSha}
                canRebaseToTrunk={stack.canRebaseToTrunk && isTailOfStack}
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
      </div>
      <EditCommitMessageDialog
        open={isEditMessageDialogOpen}
        onOpenChange={setIsEditMessageDialogOpen}
        commitSha={data.sha}
      />
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
