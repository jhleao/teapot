import type { UiWorktree } from '@shared/types'
import { CheckCircle2, ChevronDown, Plus } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useUiStateContext } from '../contexts/UiStateContext'
import { useUtilityModals } from '../contexts/UtilityModalsContext'
import { cn } from '../utils/cn'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'
import { Tooltip } from './Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface WorktreeSelectorProps {
  worktrees: UiWorktree[]
  activeWorktreePath: string | null
  repoPath: string
  isWorkingTreeDirty: boolean
}

export function WorktreeSelector({
  worktrees,
  activeWorktreePath,
  repoPath,
  isWorkingTreeDirty
}: WorktreeSelectorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const { switchWorktree, createWorktree, removeWorktree } = useUiStateContext()
  const { confirmationModal } = useUtilityModals()

  // The active worktree is either the one matching activeWorktreePath, or the main one
  const activeWorktree = worktrees.find((wt) =>
    activeWorktreePath ? wt.path === activeWorktreePath : wt.isMain
  )
  const triggerName = activeWorktree
    ? abbreviatePath(activeWorktree.path)
    : abbreviatePath(repoPath)

  const handleSwitch = useCallback(
    async (worktreePath: string) => {
      setIsOpen(false)
      await switchWorktree({ worktreePath })
    },
    [switchWorktree]
  )

  const handleCreateWorktree = useCallback(async () => {
    setIsOpen(false)
    const branchName = window.prompt('Branch name for new worktree:')
    if (!branchName) return

    const result = await createWorktree({ branch: branchName })
    if (result.success && result.worktreePath) {
      toast.success('Worktree created', { description: result.worktreePath })
    }
  }, [createWorktree])

  // Determine status dot color for the trigger
  const triggerDotColor = activeWorktree?.isStale
    ? 'bg-destructive'
    : isWorkingTreeDirty
      ? 'bg-yellow-500'
      : null

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip content={activeWorktree?.path ?? repoPath} side="bottom">
        <PopoverTrigger asChild>
          <button
            className="hover:bg-muted flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
            data-testid="worktree-selector-button"
          >
            <span className="text-foreground max-w-[160px] truncate text-sm font-medium">
              {triggerName}
            </span>
            {triggerDotColor && (
              <span
                className={cn('h-2 w-2 shrink-0 rounded-full', triggerDotColor)}
                aria-label={isWorkingTreeDirty ? 'Uncommitted changes' : 'Stale worktree'}
              />
            )}
            <ChevronDown
              className={cn(
                'text-muted-foreground h-3.5 w-3.5 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-80 overflow-hidden p-0"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="worktree-dropdown"
      >
        <div className="max-h-96 overflow-y-auto py-1">
          {worktrees.length === 0 ? (
            <div className="text-muted-foreground px-4 py-3 text-sm">No worktrees found</div>
          ) : (
            worktrees.map((wt) => (
              <WorktreeSelectorItem
                key={wt.path}
                worktree={wt}
                isActive={wt.path === (activeWorktreePath ?? repoPath)}
                repoPath={repoPath}
                onSwitch={handleSwitch}
                onRemove={removeWorktree}
                confirmationModal={confirmationModal}
              />
            ))
          )}
        </div>
        <div className="border-border border-t">
          <button
            onClick={handleCreateWorktree}
            className="hover:bg-muted text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors"
            data-testid="create-worktree-button"
          >
            <Plus className="text-muted-foreground h-4 w-4" />
            <span>Create New Worktree...</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WorktreeSelectorItem
// ─────────────────────────────────────────────────────────────────────────────

interface WorktreeSelectorItemProps {
  worktree: UiWorktree
  isActive: boolean
  repoPath: string
  onSwitch: (path: string) => void
  onRemove: (params: { worktreePath: string; force?: boolean }) => Promise<{ success: boolean }>
  confirmationModal: (opts: {
    title: string
    body: string
    confirmText: string
    variant?: 'destructive'
  }) => Promise<boolean>
}

function WorktreeSelectorItem({
  worktree,
  isActive,
  repoPath,
  onSwitch,
  onRemove,
  confirmationModal
}: WorktreeSelectorItemProps): React.JSX.Element {
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const displayName = abbreviatePath(worktree.path)
  const branchDisplay = worktree.branch ?? `${worktree.headSha.slice(0, 7)} (detached)`
  const isDirty = worktree.isDirty
  const isStale = worktree.isStale

  // Status dot color
  const dotColor = isStale
    ? 'bg-destructive'
    : isActive
      ? 'bg-green-500'
      : isDirty
        ? 'bg-yellow-500'
        : 'bg-muted-foreground/40'

  const statusText = isStale
    ? '(path no longer exists)'
    : isDirty
      ? `${branchDisplay} \u00b7 uncommitted changes`
      : `${branchDisplay} \u00b7 clean`

  const handleClick = () => {
    if (!isActive && !isStale) {
      onSwitch(worktree.path)
    } else if (isStale) {
      toast.error('This worktree no longer exists.', {
        action: {
          label: 'Remove',
          onClick: () => onRemove({ worktreePath: worktree.path })
        }
      })
    }
  }

  const handleOpenInEditor = useCallback(async () => {
    const result = await window.api.openWorktreeInEditor({ worktreePath: worktree.path })
    if (!result.success) {
      toast.error('Failed to open in editor', { description: result.error })
    }
  }, [worktree.path])

  const handleOpenInTerminal = useCallback(async () => {
    const result = await window.api.openWorktreeInTerminal({ worktreePath: worktree.path })
    if (!result.success) {
      toast.error('Failed to open terminal', { description: result.error })
    }
  }, [worktree.path])

  const handleCopyPath = useCallback(async () => {
    const result = await window.api.copyWorktreePath({ worktreePath: worktree.path })
    if (result.success) {
      toast.success('Path copied to clipboard')
    } else {
      toast.error('Failed to copy path', { description: result.error })
    }
  }, [worktree.path])

  const handleDiscard = useCallback(async () => {
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
      const result = await window.api.discardWorktreeChanges({ worktreePath: worktree.path })
      if (result.success) {
        toast.success('Changes discarded')
      } else {
        toast.error('Failed to discard changes', { description: result.error })
      }
    } finally {
      setIsDiscarding(false)
    }
  }, [worktree.path, isDiscarding, confirmationModal])

  const handleDelete = useCallback(async () => {
    if (isDeleting) return
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
      const result = await onRemove({ worktreePath: worktree.path, force: isDirty })
      if (result.success) {
        toast.success('Worktree deleted')
      } else {
        toast.error('Failed to delete worktree')
      }
    } finally {
      setIsDeleting(false)
    }
  }, [worktree.path, isDirty, isDeleting, onRemove, confirmationModal])

  const menuContent = (
    <>
      {!isStale && (
        <>
          <ContextMenuItem onClick={handleOpenInEditor}>Open in Editor</ContextMenuItem>
          <ContextMenuItem onClick={handleOpenInTerminal}>Open in Terminal</ContextMenuItem>
          <ContextMenuItem onClick={handleCopyPath}>Copy Path</ContextMenuItem>
        </>
      )}
      {isDirty && !isStale && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDiscard} disabled={isDiscarding}>
            {isDiscarding ? 'Discarding...' : 'Discard All Changes'}
          </ContextMenuItem>
        </>
      )}
      {!worktree.isMain && !isStale && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : isDirty ? 'Force Delete Worktree' : 'Delete Worktree'}
          </ContextMenuItem>
        </>
      )}
      {isStale && (
        <ContextMenuItem
          onClick={() => onRemove({ worktreePath: worktree.path })}
        >
          Remove from List
        </ContextMenuItem>
      )}
    </>
  )

  return (
    <ContextMenu content={menuContent}>
      <button
        onClick={handleClick}
        className={cn(
          'hover:bg-muted flex w-full items-start gap-3 px-4 py-2 text-left transition-colors',
          isActive && 'bg-accent/20'
        )}
        title={worktree.path}
      >
        <div className="mt-1.5 shrink-0">
          {isActive ? (
            <CheckCircle2 className="text-accent-foreground h-4 w-4" />
          ) : (
            <span className={cn('mt-0.5 block h-2 w-2 rounded-full', dotColor)} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'truncate text-sm font-medium',
                isActive ? 'text-accent-foreground' : 'text-foreground',
                isStale && 'text-destructive line-through'
              )}
            >
              {displayName}
            </span>
            {worktree.isMain && (
              <span className="text-muted-foreground text-xs">(main)</span>
            )}
          </div>
          <div className={cn('truncate text-xs', isStale ? 'text-destructive/70' : 'text-muted-foreground')}>
            {statusText}
          </div>
        </div>
      </button>
    </ContextMenu>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function abbreviatePath(fullPath: string): string {
  const parts = fullPath.split('/')
  return parts[parts.length - 1] || fullPath
}
