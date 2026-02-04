import {
  getCreateWorktreePermission,
  getDeleteBranchPermission,
  getRenameBranchPermission
} from '@shared/permissions'
import type { BranchChoice, SquashPreview, UiBranch } from '@shared/types'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useUiStateContext } from '../contexts/UiStateContext'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { RenameBranchDialog } from './RenameBranchDialog'
import { SquashConfirmDialog } from './SquashConfirmDialog'

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
    getSquashPreview,
    squashIntoParent,
    repoPath,
    createPullRequest
  } = useUiStateContext()
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false)
  const [isSquashDialogOpen, setIsSquashDialogOpen] = useState(false)
  const [squashPreviewData, setSquashPreviewData] = useState<SquashPreview | null>(null)
  const [isLoadingSquashPreview, setIsLoadingSquashPreview] = useState(false)
  const [isSquashing, setIsSquashing] = useState(false)
  const [isRecreatingPr, setIsRecreatingPr] = useState(false)

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

  const renamePermission = useMemo(
    () => getRenameBranchPermission({ isTrunk: data.isTrunk, isRemote: data.isRemote }),
    [data.isTrunk, data.isRemote]
  )

  const worktreePermission = useMemo(
    () =>
      getCreateWorktreePermission({
        isTrunk: data.isTrunk,
        isRemote: data.isRemote,
        hasWorktree
      }),
    [data.isTrunk, data.isRemote, hasWorktree]
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
            {!data.isRemote && (
              <ContextMenuItem
                onClick={handleRename}
                disabled={!renamePermission.allowed}
                disabledReason={renamePermission.deniedReason}
              >
                Rename branch
              </ContextMenuItem>
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
            {!data.isRemote && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={handleCreateWorktree}
                  disabled={!worktreePermission.allowed || isCreatingWorktree}
                  disabledReason={worktreePermission.deniedReason}
                >
                  {isCreatingWorktree ? 'Creating...' : 'New worktree here'}
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
