import type { UiWorkingTreeFile } from '@shared/types'
import { AlertTriangle, CheckCircle, Clipboard, ExternalLink, Terminal } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { findRebasingBranchName } from '../utils/stack-utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader } from './Dialog'

export function ConflictResolutionDialog(): React.JSX.Element {
  const { continueRebase, abortRebase, uiState, repoPath } = useUiStateContext()
  const { selectedRepo, refreshRepos } = useLocalStateContext()
  const [isPending, setIsPending] = useState(false)
  const [executionPath, setExecutionPath] = useState<string | null>(null)

  // Fetch the execution path when dialog mounts
  // For Teapot-initiated rebases, this returns the temp worktree path
  // For external rebases, fall back to repoPath (the current worktree)
  useEffect(() => {
    if (!repoPath) return
    window.api.getRebaseExecutionPath({ repoPath }).then((result) => {
      if (result.path) {
        setExecutionPath(result.path)
      } else {
        // External rebase - use the current worktree path
        setExecutionPath(repoPath)
      }
    })
  }, [repoPath])

  // Derive conflicted files from workingTree
  const conflictedFiles = uiState?.workingTree.filter((f) => f.status === 'conflicted') ?? []
  const unresolvedFiles = conflictedFiles.filter((f) => !f.resolved)
  const allResolved = conflictedFiles.length === 0 || unresolvedFiles.length === 0
  const rebasingBranchName = uiState?.stack ? findRebasingBranchName(uiState.stack) : null

  const handleContinue = async (): Promise<void> => {
    if (isPending) return
    setIsPending(true)
    try {
      await continueRebase()
    } finally {
      setIsPending(false)
    }
  }

  const handleAbort = async (): Promise<void> => {
    if (isPending) return
    setIsPending(true)
    try {
      await abortRebase()
      // After aborting, switch back to the main worktree.
      // The temp worktree used for the rebase may have been cleaned up,
      // so staying on it would leave the user stuck.
      const mainRepoPath = selectedRepo?.path
      if (mainRepoPath) {
        await window.api.switchWorktree({
          repoPath: mainRepoPath,
          worktreePath: mainRepoPath
        })
        await refreshRepos()
      }
      toast.success('Rebase aborted', {
        description: rebasingBranchName
          ? `${rebasingBranchName} restored to its previous state`
          : 'Branch restored to its previous state'
      })
    } finally {
      setIsPending(false)
    }
  }

  const handleCopyPath = useCallback(async () => {
    if (!executionPath) return
    const result = await window.api.copyWorktreePath({ worktreePath: executionPath })
    if (result.success) {
      toast.success('Path copied to clipboard')
    } else {
      toast.error('Failed to copy path', { description: result.error })
    }
  }, [executionPath])

  const handleOpenInEditor = useCallback(async () => {
    if (!executionPath) return
    const result = await window.api.openWorktreeInEditor({ worktreePath: executionPath })
    if (!result.success) {
      toast.error('Failed to open in editor', { description: result.error })
    }
  }, [executionPath])

  const handleOpenInTerminal = useCallback(async () => {
    if (!executionPath) return
    const result = await window.api.openWorktreeInTerminal({ worktreePath: executionPath })
    if (!result.success) {
      toast.error('Failed to open in terminal', { description: result.error })
    }
  }, [executionPath])

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="px-4 pt-3">
          <DialogDescription>
            Rebasing{' '}
            <span className="font-mono font-semibold">{rebasingBranchName ?? 'branch'}</span> has
            conflicts.
            <br />
            Resolve conflicts in your editor and save.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'mt-4 overflow-y-auto border-y',
            allResolved ? 'border-green-500/30 bg-green-500/10' : 'border-border bg-muted/30'
          )}
        >
          <div className="flex flex-col gap-1 px-4 py-2">
            {conflictedFiles.length > 0 ? (
              conflictedFiles.map((file) => <ConflictFileItem key={file.path} file={file} />)
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>All conflicts resolved. Click continue to proceed.</span>
              </div>
            )}
          </div>
        </div>

        {conflictedFiles.length > 0 && (
          <div className="text-muted-foreground px-4 py-2 text-xs">
            {allResolved
              ? `All conflicts resolved. Click Continue to proceed.`
              : `${unresolvedFiles.length} of ${conflictedFiles.length} file${conflictedFiles.length > 1 ? 's' : ''} with conflicts remaining.`}
          </div>
        )}

        {executionPath && (
          <div className="border-border flex flex-col gap-2 border-t px-4 py-3">
            <button
              onClick={handleOpenInEditor}
              className="bg-accent text-accent-foreground hover:bg-accent/90 flex w-full items-center justify-center gap-2 rounded px-3 py-1.5 text-sm transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Editor
            </button>
            <div className="flex gap-2">
              <button
                onClick={handleOpenInTerminal}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex flex-1 items-center justify-center gap-2 rounded px-2 py-1 text-xs transition-colors"
              >
                <Terminal className="h-3.5 w-3.5" />
                Terminal
              </button>
              <button
                onClick={handleCopyPath}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex flex-1 items-center justify-center gap-2 rounded px-2 py-1 text-xs transition-colors"
              >
                <Clipboard className="h-3.5 w-3.5" />
                Copy Path
              </button>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 gap-1.5 px-4 pb-3 sm:gap-1.5">
          <button
            onClick={handleAbort}
            disabled={isPending}
            className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
          >
            Abort
          </button>
          <button
            onClick={handleContinue}
            disabled={isPending || !allResolved}
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-sm transition-colors disabled:opacity-50"
          >
            Continue
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConflictFileItem({ file }: { file: UiWorkingTreeFile }): React.JSX.Element {
  const lastSlashIndex = file.path.lastIndexOf('/')
  const directoryPath = lastSlashIndex >= 0 ? file.path.slice(0, lastSlashIndex + 1) : ''
  const filename = lastSlashIndex >= 0 ? file.path.slice(lastSlashIndex + 1) : file.path

  return (
    <div className="flex items-center gap-2 text-sm">
      {file.resolved ? (
        <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <AlertTriangle className="text-error h-4 w-4 shrink-0" />
      )}
      <span className="flex-1 truncate">
        {directoryPath && <span className="text-muted-foreground">{directoryPath}</span>}
        <span>{filename}</span>
      </span>
    </div>
  )
}
