import React, { useCallback, useEffect, useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

interface EditCommitMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commitSha: string
}

export function EditCommitMessageDialog({
  open,
  onOpenChange,
  commitSha
}: EditCommitMessageDialogProps) {
  const { amend, getCommitMessage } = useUiStateContext()
  const [message, setMessage] = useState('')
  const [originalMessage, setOriginalMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch full commit message when dialog opens
  useEffect(() => {
    if (open && commitSha) {
      setIsLoading(true)
      setError(null)
      getCommitMessage(commitSha)
        .then((fullMessage) => {
          setMessage(fullMessage)
          setOriginalMessage(fullMessage)
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to load commit message')
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [open, commitSha, getCommitMessage])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      const trimmedMessage = message.trim()
      if (trimmedMessage === originalMessage.trim()) {
        onOpenChange(false)
        return
      }

      if (!trimmedMessage) {
        setError('Commit message cannot be empty')
        return
      }

      setIsPending(true)
      setError(null)

      try {
        await amend({ message: trimmedMessage })
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update commit message')
      } finally {
        setIsPending(false)
      }
    },
    [message, originalMessage, amend, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="px-5 py-5 sm:max-w-[500px]">
        <DialogHeader className="sr-only">
          <DialogTitle>Edit Commit Message</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-2">
            <h4 className="text-sm leading-none font-medium">Commit message</h4>
            {isLoading ? (
              <div className="border-border bg-background flex h-24 w-full items-center justify-center rounded-md border">
                <span className="text-muted-foreground text-sm">Loading...</span>
              </div>
            ) : (
              <textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)
                  setError(null)
                }}
                placeholder="Enter commit message"
                rows={4}
                className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground flex w-full resize-none rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                autoFocus
                disabled={isPending}
              />
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isPending ||
                isLoading ||
                !message.trim() ||
                message.trim() === originalMessage.trim()
              }
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-sm transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
