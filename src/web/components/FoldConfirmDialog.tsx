import type { SquashPreview } from '@shared/types'
import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog'

type FoldConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: SquashPreview
  onConfirm: (commitMessage: string) => Promise<void> | void
  isSubmitting?: boolean
}

export function FoldConfirmDialog({
  open,
  onOpenChange,
  preview,
  onConfirm,
  isSubmitting = false
}: FoldConfirmDialogProps): React.JSX.Element {
  const defaultCommitMessage = useMemo(() => {
    const parent = preview.parentCommitMessage ?? ''
    const child = preview.commitMessage ?? ''
    if (!parent && !child) return ''
    if (!parent) return child
    if (!child) return parent
    return `${parent}\n\n---\n\n${child}`
  }, [preview.commitMessage, preview.parentCommitMessage])

  const [commitMessage, setCommitMessage] = useState(defaultCommitMessage)

  useEffect(() => {
    if (open) {
      setCommitMessage(defaultCommitMessage)
    }
  }, [open, defaultCommitMessage])

  const handleConfirm = async () => {
    await onConfirm(commitMessage)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[560px] max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>
            Fold {preview.targetBranch} into {preview.parentBranch}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!preview.isEmpty && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Combined commit message
              </label>
              <textarea
                className="border-border bg-background text-foreground focus:border-foreground w-full resize-none rounded-md border px-3 py-2 text-sm shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                rows={8}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          )}

          {preview.isEmpty && (
            <div className="bg-muted text-foreground border-border rounded-md border px-3 py-2 text-sm">
              This branch&apos;s changes are already present in{' '}
              <span className="font-semibold">{preview.parentBranch}</span>. Descendants will be
              rebased and the branch will be deleted.
            </div>
          )}

          {preview.descendantBranches && preview.descendantBranches.length > 0 && (
            <div className="bg-muted/40 text-foreground border-border rounded-md border px-3 py-2 text-sm">
              <div className="font-medium">Will rebase</div>
              <div className="text-muted-foreground mt-1">
                {preview.descendantBranches.join(', ')}
              </div>
            </div>
          )}

          {preview.hasPr && (
            <div className="bg-amber-500/10 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-500 rounded-md border px-3 py-2 text-sm">
              Closing PR #{preview.prNumber} and deleting {preview.targetBranch} after fold.
            </div>
          )}
        </div>

        <DialogFooter className="mt-6 gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-2 text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || (!preview.isEmpty && commitMessage.trim().length === 0)}
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Folding...' : 'Fold'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
