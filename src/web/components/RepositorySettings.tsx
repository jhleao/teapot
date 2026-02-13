import { log } from '@shared/logger'
import type { WorktreeInitConfig } from '@shared/types/repo'
import { DEFAULT_WORKTREE_INIT_CONFIG } from '@shared/types/repo'
import { X } from 'lucide-react'
import React, { useEffect, useState } from 'react'

interface RepositorySettingsProps {
  repoPath: string
}

export function RepositorySettings({ repoPath }: RepositorySettingsProps): React.JSX.Element {
  const [config, setConfig] = useState<WorktreeInitConfig>(DEFAULT_WORKTREE_INIT_CONFIG)
  const [isLoading, setIsLoading] = useState(true)
  const [newFile, setNewFile] = useState('')
  const [newCommand, setNewCommand] = useState('')

  // Load config on mount
  useEffect(() => {
    setIsLoading(true)
    window.api
      .getWorktreeInitConfig({ repoPath })
      .then((loadedConfig) => {
        setConfig(loadedConfig)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [repoPath])

  async function updateConfig(updates: Partial<WorktreeInitConfig>): Promise<void> {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    try {
      await window.api.setWorktreeInitConfig({ repoPath, config: newConfig })
    } catch (error) {
      log.error('Failed to save worktree init config:', error)
      setConfig(config) // Revert optimistic update
    }
  }

  function addItem(
    value: string,
    list: string[],
    key: 'filesToCopy' | 'setupCommands',
    clear: () => void
  ): void {
    const trimmed = value.trim()
    if (!trimmed || list.includes(trimmed)) {
      clear()
      return
    }
    updateConfig({ [key]: [...list, trimmed] })
    clear()
  }

  function removeItem(index: number, list: string[], key: 'filesToCopy' | 'setupCommands'): void {
    updateConfig({ [key]: list.filter((_, i) => i !== index) })
  }

  const addFile = () => addItem(newFile, config.filesToCopy, 'filesToCopy', () => setNewFile(''))
  const addCommand = () =>
    addItem(newCommand, config.setupCommands, 'setupCommands', () => setNewCommand(''))
  const removeFile = (index: number) => removeItem(index, config.filesToCopy, 'filesToCopy')
  const removeCommand = (index: number) => removeItem(index, config.setupCommands, 'setupCommands')

  if (isLoading) {
    return <div className="text-muted-foreground py-8 text-center text-sm">Loading...</div>
  }

  const hasConfig = config.filesToCopy.length > 0 || config.setupCommands.length > 0

  return (
    <div className="space-y-6">
      {/* Introduction */}
      {!hasConfig && (
        <div className="bg-muted/30 text-muted-foreground rounded-md p-3 text-sm">
          Configure worktree initialization to automatically copy files and run commands when
          creating new worktrees.
        </div>
      )}

      {/* Files to copy section */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-medium">Files to Copy</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            These files will be copied from the main worktree to new worktrees (e.g., .env,
            config/local.json).
          </p>
        </div>

        {config.filesToCopy.length > 0 && (
          <div className="space-y-1.5">
            {config.filesToCopy.map((file, index) => (
              <div
                key={file}
                className="bg-muted/30 border-input flex items-center justify-between gap-2 rounded border px-3 py-2"
              >
                <code className="text-foreground text-xs">{file}</code>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Remove ${file}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newFile}
            onChange={(e) => setNewFile(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFile()}
            placeholder=".env, .env.local, config/local.json..."
            className="border-input bg-background placeholder:text-muted-foreground focus:border-foreground flex-1 rounded-md border px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={addFile}
            disabled={!newFile.trim()}
            className="border-input bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-2 text-sm transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Setup commands section */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-medium">Setup Commands</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            Commands to run after creating a worktree (e.g., install dependencies). Commands run in
            background with a 5-minute timeout.
          </p>
        </div>

        {config.setupCommands.length > 0 && (
          <div className="space-y-1.5">
            {config.setupCommands.map((command, index) => (
              <div
                key={command}
                className="bg-muted/30 border-input flex items-center justify-between gap-2 rounded border px-3 py-2"
              >
                <code className="text-foreground font-mono text-xs">{command}</code>
                <button
                  type="button"
                  onClick={() => removeCommand(index)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Remove ${command}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCommand()}
            placeholder="pnpm install, npm ci, yarn..."
            className="border-input bg-background placeholder:text-muted-foreground focus:border-foreground flex-1 rounded-md border px-3 py-2 font-mono text-sm outline-none"
          />
          <button
            type="button"
            onClick={addCommand}
            disabled={!newCommand.trim()}
            className="border-input bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-2 text-sm transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Default options section */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Default Options</h4>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={config.createWorkingCommit}
            onChange={(e) => updateConfig({ createWorkingCommit: e.target.checked })}
            className="border-input bg-background h-4 w-4 shrink-0 rounded border accent-current disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div>
            <span className="text-sm">Create working commit by default</span>
            <p className="text-muted-foreground text-xs">
              New worktrees will start with an empty &quot;WIP&quot; commit
            </p>
          </div>
        </label>
      </div>
    </div>
  )
}
