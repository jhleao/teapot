import React, { useCallback, useEffect, useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

interface RenameBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
}

const containsInvalidGitBranchChars = (name: string): boolean => {
  // Avoid regex control ranges (eslint `no-control-regex`) while keeping behavior equivalent.
  // Matches the intent of: /[\x00-\x1f\x7f~^:?*[\]\\]/
  const forbidden = new Set(['~', '^', ':', '?', '*', '[', ']', '\\'])

  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
    if (forbidden.has(name[i])) return true
  }

  return false
}

const validateBranchName = (name: string): string | null => {
  if (!name || name.trim().length === 0) {
    return 'Branch name cannot be empty'
  }
  if (name.startsWith('-')) {
    return 'Branch name cannot start with a hyphen'
  }
  if (name.endsWith('.')) {
    return 'Branch name cannot end with a dot'
  }
  if (name.includes('..')) {
    return 'Branch name cannot contain ..'
  }
  if (containsInvalidGitBranchChars(name)) {
    return 'Branch name contains invalid characters'
  }
  if (name.includes(' ')) {
    return 'Branch name cannot contain spaces'
  }
  return null
}

export function RenameBranchDialog({ open, onOpenChange, branchName }: RenameBranchDialogProps) {
  const { renameBranch } = useUiStateContext()
  const [newName, setNewName] = useState(branchName)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setNewName(branchName)
      setError(null)
    }
  }, [open, branchName])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      const trimmedName = newName.trim()
      if (trimmedName === branchName) {
        onOpenChange(false)
        return
      }

      const validationError = validateBranchName(trimmedName)
      if (validationError) {
        setError(validationError)
        return
      }

      setIsPending(true)
      setError(null)

      try {
        await renameBranch({ oldBranchName: branchName, newBranchName: trimmedName })
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename branch')
      } finally {
        setIsPending(false)
      }
    },
    [newName, branchName, renameBranch, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="px-5 py-5 sm:max-w-[425px]">
        <DialogHeader className="sr-only">
          <DialogTitle>Rename Branch</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-2">
            <h4 className="text-sm leading-none font-medium">New branch name</h4>
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setError(null)
              }}
              placeholder={branchName}
              className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground flex w-full rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
              disabled={isPending}
            />
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
              disabled={isPending || !newName.trim() || newName.trim() === branchName}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-sm transition-colors disabled:opacity-50"
            >
              {isPending ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
