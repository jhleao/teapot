import { log } from '@shared/logger'
import { Clipboard, Loader2 } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog'

interface CloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloneComplete: (repoPath: string) => void
}

/**
 * Simple client-side URL validation matching the backend patterns.
 * Returns null if valid, error message if invalid.
 */
function validateGitUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return null // Empty is not an error, just incomplete
  }

  // HTTPS URL pattern
  if (/^https?:\/\/[^/]+\/.+/.test(trimmed)) {
    return null
  }

  // SSH URL pattern (git@host:path)
  if (/^git@[^:]+:.+/.test(trimmed)) {
    return null
  }

  // Git protocol pattern
  if (/^git:\/\/[^/]+\/.+/.test(trimmed)) {
    return null
  }

  // File protocol pattern (for local repos)
  if (/^file:\/\/.+/.test(trimmed)) {
    return null
  }

  // Provide helpful hints based on what user typed
  if (trimmed.includes('github.com') || trimmed.includes('gitlab.com')) {
    if (!trimmed.startsWith('http') && !trimmed.startsWith('git@')) {
      return 'Add https:// or use SSH format (git@...)'
    }
  }

  return 'Enter a valid Git URL (HTTPS or SSH)'
}

export function CloneDialog({
  open,
  onOpenChange,
  onCloneComplete
}: CloneDialogProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [isCloning, setIsCloning] = useState(false)
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)

  const urlError = validateGitUrl(url)
  const isValidUrl = url.trim() && !urlError
  const canSubmit = isValidUrl && targetPath.trim() && !isCloning

  // Load last clone path and check clipboard when dialog opens
  useEffect(() => {
    if (open) {
      // Load last used clone path
      window.api.getLastClonePath().then((lastPath) => {
        if (lastPath && !targetPath) {
          setTargetPath(lastPath)
        }
      })

      // Check clipboard for Git URL
      window.api.readClipboardText().then((text) => {
        const trimmed = text.trim()
        if (trimmed && !validateGitUrl(trimmed) && trimmed !== url) {
          setClipboardUrl(trimmed)
        }
      })
    } else {
      setClipboardUrl(null)
    }
  }, [open, targetPath, url])

  const handlePasteFromClipboard = useCallback(() => {
    if (clipboardUrl) {
      setUrl(clipboardUrl)
      setClipboardUrl(null)
    }
  }, [clipboardUrl])

  const handleBrowse = async (): Promise<void> => {
    const selectedPath = await window.api.showFolderPicker()
    if (selectedPath) {
      setTargetPath(selectedPath)
    }
  }

  const handleClose = useCallback((): void => {
    setUrl('')
    setTargetPath('')
    onOpenChange(false)
  }, [onOpenChange])

  const handleClone = useCallback(async (): Promise<void> => {
    if (!url.trim()) {
      toast.error('Please enter a repository URL')
      return
    }

    if (!targetPath.trim()) {
      toast.error('Please select a target folder')
      return
    }

    setIsCloning(true)
    try {
      const result = await window.api.cloneRepository({
        url: url.trim(),
        targetPath: targetPath.trim()
      })
      if (result.success && result.repoPath) {
        toast.success('Repository cloned successfully')
        onCloneComplete(result.repoPath)
        handleClose()
      } else {
        toast.error(result.error || 'Failed to clone repository')
      }
    } catch (error) {
      log.error('Failed to clone repository:', error)
      toast.error('Failed to clone repository')
    } finally {
      setIsCloning(false)
    }
  }, [url, targetPath, onCloneComplete, handleClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && canSubmit) {
        e.preventDefault()
        handleClone()
      }
    },
    [canSubmit, handleClone]
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <div role="presentation" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>Clone Repository</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label htmlFor="clone-url" className="text-sm leading-none font-medium">
                Repository URL
              </label>
              <div className="relative">
                <input
                  id="clone-url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isCloning}
                  placeholder="https://github.com/user/repo.git"
                  autoFocus
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                {clipboardUrl && !url && (
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
                    title="Paste Git URL from clipboard"
                  >
                    <Clipboard className="h-4 w-4" />
                  </button>
                )}
              </div>
              {urlError && url.trim() && <p className="text-destructive text-xs">{urlError}</p>}
              {!urlError && (
                <p className="text-muted-foreground text-xs">
                  Supports HTTPS and SSH URLs (e.g., git@github.com:user/repo.git)
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="clone-path" className="text-sm leading-none font-medium">
                Target Folder
              </label>
              <div className="flex gap-2">
                <input
                  id="clone-path"
                  type="text"
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                  disabled={isCloning}
                  placeholder="Select a folder..."
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  disabled={isCloning}
                  className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
                >
                  Browse
                </button>
              </div>
              <p className="text-muted-foreground text-xs">
                The repository will be cloned into a new folder at this location
              </p>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={handleClose}
              disabled={isCloning}
              className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClone}
              disabled={!canSubmit}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded px-3 py-1 text-sm transition-colors disabled:opacity-50"
            >
              {isCloning ? (
                <>
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                'Clone'
              )}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
