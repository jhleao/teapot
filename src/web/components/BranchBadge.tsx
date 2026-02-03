import { getDeleteBranchPermission } from '@shared/permissions'
import type { BranchChoice, SquashPreview, UiBranch, UiStack } from '@shared/types'
import { ArrowDown, ArrowUp, Download, Loader2 } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { RenameBranchDialog } from './RenameBranchDialog'
import { Tooltip } from './Tooltip'
import { SquashConfirmDialog } from './SquashConfirmDialog'

export const BranchBadge = memo(function BranchBadge({
  data,
  stack
}: {
  data: UiBranch
  stack?: UiStack
}): React.JSX.Element {
  const {
    checkout,
    deleteBranch,
    isWorkingTreeDirty,
    createWorktree,
    getSquashPreview,
    squashIntoParent,
    repoPath,
    createPullRequest,
    pullStack
  } = useUiStateContext()
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false)
  const [isSquashDialogOpen, setIsSquashDialogOpen] = useState(false)
  const [squashPreviewData, setSquashPreviewData] = useState<SquashPreview | null>(null)
  const [isLoadingSquashPreview, setIsLoadingSquashPreview] = useState(false)
  const [isSquashing, setIsSquashing] = useState(false)
  const [isRecreatingPr, setIsRecreatingPr] = useState(false)
  const [isForcePulling, setIsForcePulling] = useState(false)

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isWorkingTreeDirty) return
      e.stopPropagation()
      checkout({ ref: data.name })
    },
    [isWorkingTreeDirty, checkout, data.name]
  )

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(data.name)
  }, [data.name])

  const handleDelete = useCallback(() => {
    deleteBranch({ branchName: data.name })
  }, [deleteBranch, data.name])

  const handleRename = useCallback(() => {
    setIsRenameDialogOpen(true)
  }, [])

  const handleCreateWorktree = useCallback(async () => {
    if (isCreatingWorktree) return

    setIsCreatingWorktree(true)
    try {
      const result = await createWorktree({ branch: data.name })
      if (result.success) {
        toast.success(`Worktree created at ${result.worktreePath}`)
      } else {
        toast.error('Failed to create worktree')
      }
    } finally {
      setIsCreatingWorktree(false)
    }
  }, [createWorktree, data.name, isCreatingWorktree])

  // Path for "Open in..." actions: use worktree path if available, or repoPath if this is the current branch
  const openablePath = data.worktree?.path ?? (data.isCurrent ? repoPath : null)

  const handleOpenInEditor = useCallback(async () => {
    if (!openablePath) return
    const result = await window.api.openWorktreeInEditor({ worktreePath: openablePath })
    if (!result.success) {
      toast.error('Failed to open in editor', { description: result.error })
    }
  }, [openablePath])

  const handleOpenInTerminal = useCallback(async () => {
    if (!openablePath) return
    const result = await window.api.openWorktreeInTerminal({ worktreePath: openablePath })
    if (!result.success) {
      toast.error('Failed to open terminal', { description: result.error })
    }
  }, [openablePath])

  const handleCopyPath = useCallback(async () => {
    if (!openablePath) return
    const result = await window.api.copyWorktreePath({ worktreePath: openablePath })
    if (result.success) {
      toast.success('Path copied to clipboard')
    } else {
      toast.error('Failed to copy path', { description: result.error })
    }
  }, [openablePath])

  const handleRecreatePr = useCallback(async () => {
    if (isRecreatingPr) return
    setIsRecreatingPr(true)
    try {
      await createPullRequest({ headBranch: data.name })
      toast.success('PR created')
    } catch (error) {
      toast.error('Failed to create PR', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsRecreatingPr(false)
    }
  }, [createPullRequest, data.name, isRecreatingPr])

  const handlePullStack = useCallback(async () => {
    if (isForcePulling || !stack) return
    setIsForcePulling(true)
    try {
      const branchNames = collectBranchesFromStack(data.name, stack)
      if (branchNames.length === 0) {
        toast.warning('No branches to pull')
        return
      }
      await pullStack({ branchNames })
    } finally {
      setIsForcePulling(false)
    }
  }, [data.name, isForcePulling, pullStack, stack])

  const handleOpenSquashDialog = useCallback(async () => {
    // Only block dirty worktree if this is the current branch
    if (data.isCurrent && isWorkingTreeDirty) {
      toast.error('Cannot squash while working tree has changes')
      return
    }

    setIsLoadingSquashPreview(true)
    try {
      const preview = await getSquashPreview({ branchName: data.name })
      if (!preview.canSquash) {
        toast.error(preview.errorDetail || 'Cannot squash this branch')
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
  }, [data.isCurrent, data.name, getSquashPreview, isWorkingTreeDirty])

  const handleConfirmSquash = useCallback(
    async (commitMessage: string, branchChoice?: BranchChoice) => {
      if (!squashPreviewData) return
      setIsSquashing(true)
      try {
        const result = await squashIntoParent({
          branchName: data.name,
          commitMessage,
          branchChoice
        })
        if (result?.success || result?.localSuccess) {
          setIsSquashDialogOpen(false)
          setSquashPreviewData(null)
        }
      } finally {
        setIsSquashing(false)
      }
    },
    [data.name, squashIntoParent, squashPreviewData]
  )

  // Can't create worktree for branch that already has one
  const hasWorktree = data.worktree != null
  // Show "Open in..." options if we have an openable path
  const canOpen = openablePath != null

  const deletePermission = useMemo(
    () => getDeleteBranchPermission({ isTrunk: data.isTrunk, isCurrent: data.isCurrent }),
    [data.isTrunk, data.isCurrent]
  )

  return (
    <>
      <ContextMenu
        content={
          <>
            <ContextMenuItem onClick={handleCopy}>Copy branch name</ContextMenuItem>
            {canOpen && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleOpenInEditor}>Open in Editor</ContextMenuItem>
                <ContextMenuItem onClick={handleOpenInTerminal}>Open in Terminal</ContextMenuItem>
                <ContextMenuItem onClick={handleCopyPath}>Copy Path</ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {data.canRename && (
              <ContextMenuItem onClick={handleRename}>Rename branch</ContextMenuItem>
            )}
            {!data.isRemote && (
              <ContextMenuItem
                onClick={handleDelete}
                disabled={!deletePermission.allowed}
                disabledReason={deletePermission.deniedReason}
              >
                Delete branch
              </ContextMenuItem>
            )}
            {!data.isRemote && !data.isTrunk && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={handleOpenSquashDialog}
                  disabled={!data.canSquash || isLoadingSquashPreview}
                  disabledReason={data.squashDisabledReason}
                >
                  {isLoadingSquashPreview ? 'Checking...' : 'Squash into parent'}
                </ContextMenuItem>
              </>
            )}
            {data.canCreateWorktree && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={handleCreateWorktree}
                  disabled={hasWorktree || isCreatingWorktree}
                >
                  {isCreatingWorktree ? 'Creating...' : 'New worktree here'}
                </ContextMenuItem>
              </>
            )}
            {!data.isRemote && !data.isTrunk && stack && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={handlePullStack}
                  disabled={isForcePulling || (data.isCurrent && isWorkingTreeDirty)}
                  disabledReason={
                    data.isCurrent && isWorkingTreeDirty
                      ? 'Cannot pull with uncommitted changes'
                      : undefined
                  }
                >
                  {isForcePulling ? (
                    <>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Pulling...
                    </>
                  ) : (
                    <>
                      <Download className="mr-1 h-3 w-3" />
                      Pull from here up
                    </>
                  )}
                </ContextMenuItem>
              </>
            )}
            {data.canRecreatePr && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleRecreatePr} disabled={isRecreatingPr}>
                  {isRecreatingPr ? 'Creating...' : 'Recreate PR'}
                </ContextMenuItem>
              </>
            )}
          </>
        }
      >
        <span
          onDoubleClick={handleDoubleClick}
          data-testid={`branch-badge-${data.name}`}
          className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap select-none ${
            data.isCurrent
              ? 'bg-accent text-accent-foreground border-accent-border border'
              : data.isRemote
                ? 'bg-muted/50 text-muted-foreground/80 border-border/50 border border-dashed'
                : 'bg-muted text-muted-foreground border-border border'
          }`}
        >
          {data.isCurrent && (
            <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          )}
          {data.name}
          <AheadBehindIndicator ahead={data.commitsAhead} behind={data.commitsBehind} isRemote={data.isRemote} />
        </span>
      </ContextMenu>
      <RenameBranchDialog
        open={isRenameDialogOpen}
        onOpenChange={setIsRenameDialogOpen}
        branchName={data.name}
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
    </>
  )
})

function getAheadBehindTooltip(ahead: number, behind: number): string {
  const parts: string[] = []
  if (ahead > 0) parts.push(`${ahead} ahead`)
  if (behind > 0) parts.push(`${behind} behind`)
  return parts.join(', ') + ' of remote'
}

function getAheadBehindColor(ahead: number, behind: number): string {
  if (ahead > 0 && behind > 0) return 'text-red-600'
  if (behind > 0) return 'text-amber-600'
  return 'text-blue-600'
}

function formatCount(count: number): string {
  return count > 9 ? '9+' : String(count)
}

function AheadBehindIndicator({
  ahead = 0,
  behind = 0,
  isRemote
}: {
  ahead?: number
  behind?: number
  isRemote?: boolean
}): React.JSX.Element | null {
  if (isRemote || (ahead === 0 && behind === 0)) return null

  return (
    <Tooltip content={getAheadBehindTooltip(ahead, behind)}>
      <span className={cn('ml-1 flex items-center gap-0.5 text-[10px] font-medium', getAheadBehindColor(ahead, behind))}>
        {ahead > 0 && (
          <>
            <ArrowUp className="h-3 w-3" />
            {formatCount(ahead)}
          </>
        )}
        {behind > 0 && (
          <>
            <ArrowDown className="h-3 w-3" />
            {formatCount(behind)}
          </>
        )}
      </span>
    </Tooltip>
  )
}

/**
 * Collects all local branch names from the selected branch upward through ancestor branches.
 * Walks up the stack structure to find all branches that would be affected by a pull operation.
 * Excludes remote and trunk branches.
 */
function collectBranchesFromStack(startBranchName: string, stack: UiStack): string[] {
  const branchNames: string[] = []

  // Find the commit containing the start branch and collect branches from there up
  function findAndCollect(s: UiStack): boolean {
    for (const commit of s.commits) {
      // Check if this commit has the target branch
      const hasBranch = commit.branches.some((b) => b.name === startBranchName)
      if (hasBranch) {
        // Found the start branch - collect all local non-trunk branches from here up
        collectFromCommitUp(s, commit)
        return true
      }

      // Search in spinoffs
      for (const spinoff of commit.spinoffs) {
        if (findAndCollect(spinoff)) {
          // Found in spinoff - also collect branches from this level up
          collectFromCommitUp(s, commit)
          return true
        }
      }
    }
    return false
  }

  // Collect all local non-trunk branches from a commit position upward
  function collectFromCommitUp(s: UiStack, startCommit: { sha: string }): void {
    const startIdx = s.commits.findIndex((c) => c.sha === startCommit.sha)
    if (startIdx === -1) return

    // Walk from start commit to the top of this stack (higher index = children)
    for (let i = startIdx; i < s.commits.length; i++) {
      const commit = s.commits[i]
      for (const branch of commit.branches) {
        if (!branch.isRemote && !branch.isTrunk && !branchNames.includes(branch.name)) {
          branchNames.push(branch.name)
        }
      }
    }
  }

  findAndCollect(stack)
  return branchNames
}
