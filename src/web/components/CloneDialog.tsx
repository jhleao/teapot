import { extractRepoName, isValidGitUrl, validateFolderName } from '@shared/git-url'
import { log } from '@shared/logger'
import { Clipboard, Loader2 } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog'

interface CloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloneComplete: (repoPath: string) => void
}

/**
 * Validates a Git URL and returns a user-friendly error message.
 * Returns null if valid, error message if invalid.
 */
function validateGitUrlWithHints(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return null // Empty is not an error, just incomplete
  }

  if (isValidGitUrl(trimmed)) {
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
  const [folderName, setFolderName] = useState('')
  const [folderNameModified, setFolderNameModified] = useState(false)
  const [isCloning, setIsCloning] = useState(false)
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)
  const [folderExists, setFolderExists] = useState(false)
  const [folderSuggestion, setFolderSuggestion] = useState<string | null>(null)
  const [isCheckingFolder, setIsCheckingFolder] = useState(false)
  const [targetPathError, setTargetPathError] = useState<string | null>(null)
  const [isCheckingTargetPath, setIsCheckingTargetPath] = useState(false)
  const checkFolderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkTargetPathTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const urlError = validateGitUrlWithHints(url)
  const folderNameError = validateFolderName(folderName)
  const isValidUrl = url.trim() && !urlError
  const isValidFolderName = folderName.trim() && !folderNameError && !folderExists
  const isValidTargetPath = targetPath.trim() && !targetPathError
  const canSubmit =
    isValidUrl &&
    isValidTargetPath &&
    isValidFolderName &&
    !isCloning &&
    !isCheckingFolder &&
    !isCheckingTargetPath

  // Auto-populate folder name from URL when URL changes (unless user manually modified it)
  useEffect(() => {
    if (!folderNameModified) {
      const extracted = extractRepoName(url)
      setFolderName(extracted || '')
    }
  }, [url, folderNameModified])

  // Check if folder exists with debounce
  useEffect(() => {
    // Clear previous timeout
    if (checkFolderTimeoutRef.current) {
      clearTimeout(checkFolderTimeoutRef.current)
    }

    // Reset state if missing required fields or invalid folder name
    if (!targetPath.trim() || !folderName.trim() || folderNameError) {
      setFolderExists(false)
      setFolderSuggestion(null)
      setIsCheckingFolder(false)
      return
    }

    // Show checking state immediately
    setIsCheckingFolder(true)

    // Debounce the check
    checkFolderTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.api.checkCloneFolderName({
          targetPath: targetPath.trim(),
          folderName: folderName.trim()
        })
        setFolderExists(result.exists)
        setFolderSuggestion(result.suggestion || null)
      } catch {
        setFolderExists(false)
        setFolderSuggestion(null)
      } finally {
        setIsCheckingFolder(false)
      }
    }, 300)

    return () => {
      if (checkFolderTimeoutRef.current) {
        clearTimeout(checkFolderTimeoutRef.current)
      }
    }
  }, [targetPath, folderName, folderNameError])

  // Check if target path exists and is accessible with debounce
  useEffect(() => {
    // Clear previous timeout
    if (checkTargetPathTimeoutRef.current) {
      clearTimeout(checkTargetPathTimeoutRef.current)
    }

    // Reset state if empty
    if (!targetPath.trim()) {
      setTargetPathError(null)
      setIsCheckingTargetPath(false)
      return
    }

    // Show checking state immediately
    setIsCheckingTargetPath(true)

    // Debounce the check
    checkTargetPathTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.api.checkTargetPath({ targetPath: targetPath.trim() })
        setTargetPathError(result.error || null)
      } catch {
        setTargetPathError(null)
      } finally {
        setIsCheckingTargetPath(false)
      }
    }, 300)

    return () => {
      if (checkTargetPathTimeoutRef.current) {
        clearTimeout(checkTargetPathTimeoutRef.current)
      }
    }
  }, [targetPath])

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
        if (trimmed && isValidGitUrl(trimmed) && trimmed !== url) {
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
    setFolderName('')
    setFolderNameModified(false)
    setFolderExists(false)
    setFolderSuggestion(null)
    setIsCheckingFolder(false)
    setTargetPathError(null)
    setIsCheckingTargetPath(false)
    onOpenChange(false)
  }, [onOpenChange])

  const handleUseSuggestion = useCallback((): void => {
    if (folderSuggestion) {
      setFolderName(folderSuggestion)
      setFolderNameModified(true)
    }
  }, [folderSuggestion])

  const handleClone = useCallback(async (): Promise<void> => {
    if (!url.trim()) {
      toast.error('Please enter a repository URL')
      return
    }

    if (!targetPath.trim()) {
      toast.error('Please select a target folder')
      return
    }

    if (!folderName.trim()) {
      toast.error('Please enter a folder name')
      return
    }

    setIsCloning(true)
    try {
      const result = await window.api.cloneRepository({
        url: url.trim(),
        targetPath: targetPath.trim(),
        folderName: folderName.trim()
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
  }, [url, targetPath, folderName, onCloneComplete, handleClose])

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
                  aria-invalid={!!urlError && !!url.trim()}
                  aria-describedby="clone-url-hint"
                  className={`border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    urlError && url.trim() ? 'border-destructive' : ''
                  }`}
                />
                {clipboardUrl && !url && (
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
                    aria-label={`Paste Git URL from clipboard: ${clipboardUrl}`}
                  >
                    <Clipboard className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p
                id="clone-url-hint"
                className={
                  urlError && url.trim()
                    ? 'text-destructive text-xs'
                    : 'text-muted-foreground text-xs'
                }
              >
                {urlError && url.trim()
                  ? urlError
                  : 'Supports HTTPS and SSH URLs (e.g., git@github.com:user/repo.git)'}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="clone-folder" className="text-sm leading-none font-medium">
                Folder Name
              </label>
              <div className="relative">
                <input
                  id="clone-folder"
                  type="text"
                  value={folderName}
                  onChange={(e) => {
                    setFolderName(e.target.value)
                    setFolderNameModified(true)
                  }}
                  disabled={isCloning}
                  placeholder="my-repo"
                  aria-invalid={!!folderNameError || folderExists}
                  aria-describedby="clone-folder-hint"
                  className={`border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    folderNameError || folderExists ? 'border-destructive' : ''
                  }`}
                />
                {isCheckingFolder && (
                  <Loader2
                    className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin"
                    aria-label="Checking folder availability"
                  />
                )}
              </div>
              <p
                id="clone-folder-hint"
                className={
                  folderNameError || folderExists
                    ? 'text-destructive text-xs'
                    : 'text-muted-foreground text-xs'
                }
              >
                {folderNameError ? (
                  folderNameError
                ) : folderExists ? (
                  <>
                    Folder already exists.{' '}
                    {folderSuggestion && (
                      <button
                        type="button"
                        onClick={handleUseSuggestion}
                        className="text-accent hover:underline"
                        aria-label={`Use suggested folder name: ${folderSuggestion}`}
                      >
                        Use &ldquo;{folderSuggestion}&rdquo; instead
                      </button>
                    )}
                  </>
                ) : (
                  'Auto-filled from URL. Edit to customize.'
                )}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="clone-path" className="text-sm leading-none font-medium">
                Target Location
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="clone-path"
                    type="text"
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    disabled={isCloning}
                    placeholder="Select a folder..."
                    aria-invalid={!!targetPathError}
                    aria-describedby="clone-path-hint"
                    className={`border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                      targetPathError ? 'border-destructive' : ''
                    }`}
                  />
                  {isCheckingTargetPath && (
                    <Loader2
                      className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin"
                      aria-label="Checking target location"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleBrowse}
                  disabled={isCloning}
                  aria-label="Browse for target folder"
                  className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50"
                >
                  Browse
                </button>
              </div>
              <p
                id="clone-path-hint"
                className={
                  targetPathError
                    ? 'text-destructive text-xs'
                    : 'text-muted-foreground truncate text-xs'
                }
              >
                {targetPathError
                  ? targetPathError
                  : targetPath && folderName
                    ? `Will clone to: ${targetPath}/${folderName}`
                    : 'Select the parent folder where the repository will be cloned'}
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
