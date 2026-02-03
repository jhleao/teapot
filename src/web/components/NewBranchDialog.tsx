import type { WorktreeInitConfig } from '@shared/types/repo'
import { Loader2, Settings } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useUiStateContext } from '../contexts/UiStateContext'
import { cn } from '../utils/cn'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

interface NewBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceBranch: string
  onOpenSettings?: () => void
}

const containsInvalidGitBranchChars = (name: string): boolean => {
  const forbidden = new Set(['~', '^', ':', '?', '*', '[', ']', '\\'])
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
    if (forbidden.has(name[i])) return true
  }
  return false
}

const validateBranchName = (name: string): string | null => {
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

// Generate a placeholder name for display (actual generation happens on backend)
function generatePlaceholderName(): string {
  const adjectives = ['quick', 'lazy', 'happy', 'calm', 'bold']
  const nouns = ['fox', 'dog', 'cat', 'owl', 'bear']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const num = Math.floor(Math.random() * 100)
  return `${adj}-${noun}-${num}`
}

export function NewBranchDialog({
  open,
  onOpenChange,
  sourceBranch,
  onOpenSettings
}: NewBranchDialogProps): React.JSX.Element {
  const { repoPath, createWorktreeWithBranch } = useUiStateContext()

  const [branchName, setBranchName] = useState('')
  const [createWorktree, setCreateWorktree] = useState(true)
  const [createWorkingCommit, setCreateWorkingCommit] = useState(false)
  const [runInitialization, setRunInitialization] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initConfig, setInitConfig] = useState<WorktreeInitConfig | null>(null)

  // Generate placeholder on dialog open
  const placeholderName = useMemo(() => (open ? generatePlaceholderName() : ''), [open])

  // Load repo config when dialog opens
  useEffect(() => {
    if (open && repoPath) {
      window.api.getWorktreeInitConfig({ repoPath }).then(setInitConfig)
      // Reset form state
      setBranchName('')
      setCreateWorktree(true)
      setRunInitialization(true)
      setError(null)
    }
  }, [open, repoPath])

  // Update default for working commit from config
  useEffect(() => {
    if (initConfig) {
      setCreateWorkingCommit(initConfig.createWorkingCommit)
    }
  }, [initConfig])

  const hasInitConfig =
    initConfig && (initConfig.filesToCopy.length > 0 || initConfig.setupCommands.length > 0)

  const trimmedName = branchName.trim()
  const validationError = trimmedName ? validateBranchName(trimmedName) : null

  const handleCreate = useCallback(async () => {
    if (!repoPath) return

    if (trimmedName && validationError) {
      setError(validationError)
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const result = await createWorktreeWithBranch({
        sourceBranch,
        newBranchName: trimmedName || undefined,
        createWorktree,
        createWorkingCommit: createWorktree && createWorkingCommit,
        runInitialization: createWorktree && runInitialization && !!hasInitConfig
      })

      if (result.success) {
        // Close dialog immediately
        onOpenChange(false)

        // Show success toast
        if (createWorktree && result.worktreePath) {
          const initMessage =
            runInitialization && hasInitConfig ? ' Initialization running in background.' : ''
          toast.success('Branch and worktree created', {
            description: `Branch ${result.branchName} at ${result.worktreePath}${initMessage}`
          })
        } else {
          toast.success('Branch created', {
            description: `Branch ${result.branchName} created from ${sourceBranch}`
          })
        }
      } else {
        setError(result.error || 'Failed to create branch')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch')
    } finally {
      setIsCreating(false)
    }
  }, [
    repoPath,
    sourceBranch,
    trimmedName,
    validationError,
    createWorktree,
    createWorkingCommit,
    runInitialization,
    hasInitConfig,
    createWorktreeWithBranch,
    onOpenChange
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isCreating && !validationError) {
        e.preventDefault()
        handleCreate()
      }
    },
    [isCreating, validationError, handleCreate]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="px-5 py-5 sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Branch</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Source branch info */}
          <p className="text-muted-foreground text-sm">
            Creating branch from{' '}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">{sourceBranch}</code>
          </p>

          {/* Branch name input */}
          <div className="space-y-2">
            <label htmlFor="branch-name" className="text-sm font-medium">
              Branch Name
            </label>
            <input
              id="branch-name"
              type="text"
              value={branchName}
              onChange={(e) => {
                setBranchName(e.target.value)
                setError(null)
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholderName}
              disabled={isCreating}
              autoFocus
              className="border-input bg-background placeholder:text-muted-foreground focus:border-foreground flex w-full rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {(error || validationError) && (
              <p className="text-destructive text-xs">{error || validationError}</p>
            )}
            {!branchName && !error && (
              <p className="text-muted-foreground text-xs">
                Leave empty to auto-generate: {placeholderName}
              </p>
            )}
          </div>

          {/* Create worktree checkbox */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={createWorktree}
              onChange={(e) => setCreateWorktree(e.target.checked)}
              disabled={isCreating}
              className="border-input bg-background h-4 w-4 shrink-0 rounded border accent-current disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div>
              <span className="text-sm">Create worktree</span>
              <p className="text-muted-foreground text-xs">
                Check out the branch in a new working directory
              </p>
            </div>
          </label>

          {/* Worktree-specific options (only shown when creating worktree) */}
          {createWorktree && (
            <div className="space-y-3">
              {/* Working commit checkbox */}
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={createWorkingCommit}
                  onChange={(e) => setCreateWorkingCommit(e.target.checked)}
                  disabled={isCreating}
                  className="border-input bg-background h-4 w-4 shrink-0 rounded border accent-current disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div>
                  <span className="text-sm">Create working commit</span>
                  <p className="text-muted-foreground text-xs">
                    Add an empty &quot;WIP&quot; commit as a starting point
                  </p>
                </div>
              </label>

              {/* Initialization toggle */}
              {hasInitConfig && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={runInitialization}
                    onChange={(e) => setRunInitialization(e.target.checked)}
                    disabled={isCreating}
                    className="border-input bg-background h-4 w-4 shrink-0 rounded border accent-current disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div>
                    <span className="text-sm">Run initialization</span>
                    <p className="text-muted-foreground text-xs">
                      Copy {initConfig.filesToCopy.length} file(s), run{' '}
                      {initConfig.setupCommands.length} command(s)
                    </p>
                  </div>
                </label>
              )}

              {!hasInitConfig && onOpenSettings && (
                <p className="text-muted-foreground text-xs">
                  No initialization configured.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenSettings()
                    }}
                    className="text-accent inline-flex items-center gap-1 hover:underline"
                  >
                    <Settings className="h-3 w-3" />
                    Configure in settings
                  </button>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
            className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || !!validationError}
            className={cn(
              'bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
              (isCreating || validationError) && 'cursor-not-allowed opacity-50'
            )}
          >
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
