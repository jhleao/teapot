import type { UiWorkingTreeFile } from '@shared/types'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import React, { useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { findRebasingBranchName } from '../utils/stack-utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader } from './Dialog'

export function ConflictResolutionDialog(): React.JSX.Element {
  const { continueRebase, abortRebase, uiState } = useUiStateContext()
  const [isPending, setIsPending] = useState(false)

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
    } finally {
      setIsPending(false)
    }
  }

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
