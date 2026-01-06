import type { WorktreeConflict } from '@shared/types'
import { AlertTriangle, FolderOpen, GitBranch, Loader2 } from 'lucide-react'
import React from 'react'
import { cn } from '../utils/cn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './Dialog'

interface WorktreeConflictDialogProps {
  open: boolean
  conflicts: WorktreeConflict[]
  message: string
  isLoading: boolean
  onCancel: () => void
  onStashAndProceed: () => void
  onDeleteAndProceed: () => void
}

export function WorktreeConflictDialog({
  open,
  conflicts,
  message,
  isLoading,
  onCancel,
  onStashAndProceed,
  onDeleteAndProceed
}: WorktreeConflictDialogProps): React.JSX.Element | null {
  // Group conflicts by worktree path to show each worktree once
  const conflictsByWorktree = conflicts.reduce(
    (acc, conflict) => {
      if (!acc[conflict.worktreePath]) {
        acc[conflict.worktreePath] = {
          worktreePath: conflict.worktreePath,
          isDirty: conflict.isDirty,
          branches: []
        }
      }
      acc[conflict.worktreePath].branches.push(conflict.branch)
      return acc
    },
    {} as Record<string, { worktreePath: string; isDirty: boolean; branches: string[] }>
  )

  const worktreeGroups = Object.values(conflictsByWorktree)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !isLoading && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-warning h-5 w-5" />
            Worktree Conflict
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <div className="border-border bg-muted/30 my-2 max-h-64 overflow-y-auto rounded-md border">
          {worktreeGroups.map((group) => (
            <div key={group.worktreePath} className="border-border border-b p-3 last:border-b-0">
              <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs">
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{group.worktreePath}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.branches.map((branch) => (
                  <span
                    key={branch}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                      'bg-accent/20 text-accent-foreground'
                    )}
                  >
                    <GitBranch className="h-3 w-3" />
                    {branch}
                  </span>
                ))}
              </div>
              {group.isDirty && (
                <p className="text-warning mt-1.5 text-xs">
                  This worktree has uncommitted changes.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="text-muted-foreground space-y-1 text-xs">
          <p>These worktrees have uncommitted changes. Choose how to unblock the rebase:</p>
          <p>
            <span className="text-foreground font-medium">Stash and Proceed</span> will stash
            changes, temporarily detach the branch, and continue. We&apos;ll re-checkout the branch
            after rebasing.
          </p>
          <p>
            <span className="text-foreground font-medium">Delete Worktree</span> force-removes the
            worktree (all changes in it will be lost).
          </p>
        </div>

        <DialogFooter className="mt-4 sm:justify-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              onClick={onStashAndProceed}
              disabled={isLoading}
              className={cn(
                'bg-accent text-accent-foreground hover:bg-accent/90 flex items-center justify-center gap-2 rounded px-4 py-1.5 text-sm transition-colors',
                isLoading && 'cursor-not-allowed opacity-80'
              )}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Stash and Proceed
            </button>
            <button
              onClick={onDeleteAndProceed}
              disabled={isLoading}
              className={cn(
                'border-destructive text-destructive hover:bg-destructive/10 rounded border px-4 py-1.5 text-sm transition-colors',
                isLoading && 'cursor-not-allowed opacity-80'
              )}
            >
              Delete Worktree
            </button>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className={cn(
                'text-muted-foreground hover:bg-muted/60 rounded px-4 py-1.5 text-sm transition-colors',
                isLoading && 'cursor-not-allowed opacity-80'
              )}
            >
              Cancel
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
