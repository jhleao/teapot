import type { UiWorktreeBadge } from '@shared/types'
import React, { memo, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useUtilityModals } from '../contexts/UtilityModalsContext'
import { cn } from '../utils/cn'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { TreeIcon } from './icons'

/**
 * Badge indicating a branch is checked out in another worktree.
 *
 * Color coding:
 * - Green: currently active worktree
 * - Yellow: worktree has uncommitted changes (branch is blocked)
 * - Gray: worktree is clean (not active)
 * - Red/muted: worktree path no longer exists (stale)
 *
 * Double-click to switch to that worktree (only for non-active, non-stale worktrees).
 * Right-click for context menu with worktree actions.
 */
export const WorktreeBadge = memo(function WorktreeBadge({
  data,
  onSwitch,
  repoPath
}: {
  data: UiWorktreeBadge
  onSwitch?: (worktreePath: string) => void
  repoPath?: string
}): React.JSX.Element {
  const { confirmationModal } = useUtilityModals()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  // Determine styling based on status
  const statusStyles = {
    active: 'bg-green-500/20 text-green-600 border-green-500/50',
    dirty: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/50',
    clean: 'bg-muted/50 text-muted-foreground/70 border-border/50',
    stale: 'bg-destructive/20 text-destructive border-destructive/50'
  }

  const statusLabels = {
    active: 'Active worktree',
    dirty: 'Has uncommitted changes',
    clean: 'Clean',
    stale: 'Path no longer exists'
  }

  // Can switch only if not active and not stale
  const canSwitch = data.status !== 'active' && data.status !== 'stale' && onSwitch != null
  const isActive = data.status === 'active'
  const isDirty = data.status === 'dirty'
  const isStale = data.status === 'stale'

  const handleDoubleClick = useCallback(() => {
    if (canSwitch) {
      onSwitch?.(data.path)
    }
  }, [canSwitch, onSwitch, data.path])

  const handleOpenInEditor = useCallback(async () => {
    const result = await window.api.openWorktreeInEditor({ worktreePath: data.path })
    if (!result.success) {
      toast.error('Failed to open in editor', { description: result.error })
    }
  }, [data.path])

  const handleOpenInTerminal = useCallback(async () => {
    const result = await window.api.openWorktreeInTerminal({ worktreePath: data.path })
    if (!result.success) {
      toast.error('Failed to open terminal', { description: result.error })
    }
  }, [data.path])

  const handleCopyPath = useCallback(async () => {
    const result = await window.api.copyWorktreePath({ worktreePath: data.path })
    if (result.success) {
      toast.success('Path copied to clipboard')
    } else {
      toast.error('Failed to copy path', { description: result.error })
    }
  }, [data.path])

  const handleDeleteClick = useCallback(async () => {
    if (!repoPath || isDeleting) return

    const confirmed = await confirmationModal({
      title: isDirty ? 'Force Delete Worktree?' : 'Delete Worktree?',
      body: isDirty
        ? 'This worktree has uncommitted changes that will be permanently lost. This action cannot be undone.'
        : 'This will remove the worktree directory. The branch will not be deleted.',
      confirmText: isDirty ? 'Force Delete' : 'Delete',
      variant: 'destructive'
    })

    if (!confirmed) return

    setIsDeleting(true)
    try {
      const result = await window.api.removeWorktree({
        repoPath,
        worktreePath: data.path,
        force: isDirty
      })
      if (result.success) {
        toast.success('Worktree deleted')
      } else {
        toast.error('Failed to delete worktree', { description: result.error })
      }
    } finally {
      setIsDeleting(false)
    }
  }, [repoPath, data.path, isDeleting, isDirty, confirmationModal])

  const handleDiscardClick = useCallback(async () => {
    if (isDiscarding) return

    const confirmed = await confirmationModal({
      title: 'Discard All Changes?',
      body: 'This will reset all tracked files and remove all untracked files in this worktree. This action cannot be undone.',
      confirmText: 'Discard Changes',
      variant: 'destructive'
    })

    if (!confirmed) return

    setIsDiscarding(true)
    try {
      const result = await window.api.discardWorktreeChanges({
        worktreePath: data.path
      })
      if (result.success) {
        toast.success('Changes discarded')
      } else {
        toast.error('Failed to discard changes', { description: result.error })
      }
    } finally {
      setIsDiscarding(false)
    }
  }, [data.path, isDiscarding, confirmationModal])

  // Abbreviate the path for display
  const displayPath = abbreviatePath(data.path)

  // Build tooltip text
  const switchHint = canSwitch ? '\nDouble-click to switch' : ''
  const tooltipText = `Worktree: ${data.path}\n${statusLabels[data.status]}${data.isMain ? ' (main worktree)' : ''}${switchHint}`

  const menuContent = (
    <>
      {/* Always available */}
      <ContextMenuItem onClick={handleOpenInEditor}>Open in Editor</ContextMenuItem>
      <ContextMenuItem onClick={handleOpenInTerminal}>Open in Terminal</ContextMenuItem>
      <ContextMenuItem onClick={handleCopyPath}>Copy Path</ContextMenuItem>

      {/* Not available for active or stale worktrees */}
      {!isActive && !isStale && (
        <>
          <ContextMenuSeparator />
          {isDirty && (
            <ContextMenuItem onClick={handleDiscardClick} disabled={isDiscarding}>
              {isDiscarding ? 'Discarding...' : 'Discard All Changes'}
            </ContextMenuItem>
          )}
          {!data.isMain && (
            <ContextMenuItem onClick={handleDeleteClick} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : isDirty ? 'Force Delete Worktree' : 'Delete Worktree'}
            </ContextMenuItem>
          )}
        </>
      )}
    </>
  )

  return (
    <ContextMenu content={menuContent} disabled={isStale}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
          statusStyles[data.status],
          canSwitch && 'cursor-pointer hover:brightness-110'
        )}
        title={tooltipText}
        onDoubleClick={handleDoubleClick}
      >
        <TreeIcon className="h-3.5 w-3.5" />
        {displayPath}
        {data.isMain && ' (main)'}
      </span>
    </ContextMenu>
  )
})

/**
 * Abbreviate a path for display, showing just the last directory name.
 */
function abbreviatePath(fullPath: string): string {
  const parts = fullPath.split('/')
  const lastPart = parts[parts.length - 1]
  return lastPart || fullPath
}
