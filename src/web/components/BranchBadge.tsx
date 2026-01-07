import type { SquashPreview, UiBranch } from '@shared/types'
import React, { memo, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useUiStateContext } from '../contexts/UiStateContext'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { FoldConfirmDialog } from './FoldConfirmDialog'
import { RenameBranchDialog } from './RenameBranchDialog'

export const BranchBadge = memo(function BranchBadge({
  data
}: {
  data: UiBranch
}): React.JSX.Element {
  const {
    checkout,
    deleteBranch,
    isWorkingTreeDirty,
    createWorktree,
    getFoldPreview,
    foldIntoParent,
    repoPath
  } = useUiStateContext()
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false)
  const [isFoldDialogOpen, setIsFoldDialogOpen] = useState(false)
  const [foldPreviewData, setFoldPreviewData] = useState<SquashPreview | null>(null)
  const [isLoadingFoldPreview, setIsLoadingFoldPreview] = useState(false)
  const [isFolding, setIsFolding] = useState(false)

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

  const handleOpenFoldDialog = useCallback(async () => {
    if (isWorkingTreeDirty) {
      toast.error('Cannot fold while working tree has changes')
      return
    }
    if (data.isRemote || data.isTrunk) {
      toast.error('Cannot fold this branch')
      return
    }

    setIsLoadingFoldPreview(true)
    try {
      const preview = await getFoldPreview({ branchName: data.name })
      if (!preview.canSquash) {
        toast.error(preview.errorDetail || 'Cannot fold this branch')
        return
      }
      setFoldPreviewData(preview)
      setIsFoldDialogOpen(true)
    } catch (error) {
      toast.error('Failed to load fold preview', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsLoadingFoldPreview(false)
    }
  }, [data.isRemote, data.isTrunk, data.name, getFoldPreview, isWorkingTreeDirty])

  const handleConfirmFold = useCallback(
    async (commitMessage: string) => {
      if (!foldPreviewData) return
      setIsFolding(true)
      try {
        const result = await foldIntoParent({ branchName: data.name, commitMessage })
        if (result?.success || result?.localSuccess) {
          setIsFoldDialogOpen(false)
          setFoldPreviewData(null)
        }
      } finally {
        setIsFolding(false)
      }
    },
    [data.name, foldIntoParent, foldPreviewData]
  )

  // Can't create worktree for branch that already has one
  const hasWorktree = data.worktree != null
  // Show "Open in..." options if we have an openable path
  const canOpen = openablePath != null

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
            <ContextMenuItem onClick={handleRename} disabled={data.isRemote}>
              Rename branch
            </ContextMenuItem>
            <ContextMenuItem onClick={handleDelete} disabled={data.isCurrent}>
              Delete branch
            </ContextMenuItem>
            {!data.isRemote && !data.isTrunk && (
              <ContextMenuItem onClick={handleOpenFoldDialog} disabled={isLoadingFoldPreview}>
                {isLoadingFoldPreview ? 'Checking...' : 'Fold into parent'}
              </ContextMenuItem>
            )}
            {!data.isRemote && !data.isTrunk && (
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
          </>
        }
      >
        <span
          onDoubleClick={handleDoubleClick}
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
        </span>
      </ContextMenu>
      <RenameBranchDialog
        open={isRenameDialogOpen}
        onOpenChange={setIsRenameDialogOpen}
        branchName={data.name}
      />
      {foldPreviewData && (
        <FoldConfirmDialog
          open={isFoldDialogOpen}
          onOpenChange={(open) => {
            setIsFoldDialogOpen(open)
            if (!open) setFoldPreviewData(null)
          }}
          preview={foldPreviewData}
          onConfirm={handleConfirmFold}
          isSubmitting={isFolding}
        />
      )}
    </>
  )
})
