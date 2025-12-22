import { GitBranch } from 'lucide-react'
import React, { useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './Dialog'

interface ResumeQueueDialogProps {
  queuedBranches: string[]
}

export function ResumeQueueDialog({ queuedBranches }: ResumeQueueDialogProps): React.JSX.Element {
  const { resumeRebaseQueue, dismissRebaseQueue } = useUiStateContext()
  const [isPending, setIsPending] = useState(false)

  const handleResume = async () => {
    if (isPending) return
    setIsPending(true)
    try {
      await resumeRebaseQueue()
    } finally {
      setIsPending(false)
    }
  }

  const handleDismiss = async () => {
    if (isPending) return
    setIsPending(true)
    try {
      await dismissRebaseQueue()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="px-4 pt-5">
          <DialogTitle>Resume Rebase Queue?</DialogTitle>
          <DialogDescription>
            A rebase was completed externally. There {queuedBranches.length === 1 ? 'is' : 'are'}{' '}
            {queuedBranches.length} remaining branch{queuedBranches.length > 1 ? 'es' : ''} to
            rebase.
          </DialogDescription>
        </DialogHeader>

        <div className="border-border bg-muted/30 mt-4 border-y px-4 py-2">
          <div className="text-muted-foreground mb-2 text-xs">Pending branches:</div>
          <div className="flex flex-col gap-1">
            {queuedBranches.map((branch) => (
              <div key={branch} className="flex items-center gap-2 text-sm">
                <GitBranch className="text-muted-foreground h-3 w-3" />
                <span className="font-mono">{branch}</span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="mt-4 gap-1.5 px-4 pb-3 sm:gap-1.5">
          <button
            onClick={handleDismiss}
            disabled={isPending}
            className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={handleResume}
            disabled={isPending}
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-sm transition-colors disabled:opacity-50"
          >
            Continue
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
