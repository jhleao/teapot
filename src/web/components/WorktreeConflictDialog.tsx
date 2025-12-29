import type { WorktreeConflict } from '@shared/types'
import { AlertTriangle, FolderOpen, GitBranch } from 'lucide-react'
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
  onClose: () => void
}

export function WorktreeConflictDialog({
  open,
  conflicts,
  message,
  onClose
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
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

        <div className="text-muted-foreground text-xs">
          <p>To proceed with the rebase, either:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 pl-1">
            <li>Delete the worktree, or</li>
            <li>Checkout a different branch in that worktree</li>
          </ul>
        </div>

        <DialogFooter className="mt-4 sm:justify-end">
          <button
            onClick={onClose}
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-4 py-1.5 text-sm transition-colors"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
