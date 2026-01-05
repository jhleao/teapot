import { log } from '@shared/logger'
import React, { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog'

interface CloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloneComplete: (repoPath: string) => void
}

export function CloneDialog({
  open,
  onOpenChange,
  onCloneComplete
}: CloneDialogProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [isCloning, setIsCloning] = useState(false)

  const handleBrowse = async (): Promise<void> => {
    const selectedPath = await window.api.showFolderPicker()
    if (selectedPath) {
      setTargetPath(selectedPath)
    }
  }

  const handleClone = async (): Promise<void> => {
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
  }

  const handleClose = (): void => {
    setUrl('')
    setTargetPath('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Clone Repository</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor="clone-url" className="text-sm leading-none font-medium">
              Repository URL
            </label>
            <input
              id="clone-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isCloning}
              placeholder="https://github.com/user/repo.git"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
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
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
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
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleClone}
            disabled={isCloning || !url.trim() || !targetPath.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            {isCloning ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Cloning...
              </>
            ) : (
              'Clone'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
