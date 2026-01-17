import { log } from '@shared/logger'
import type { MergeStrategy } from '@shared/types/git-forge'
import React, { useEffect, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const { preference, setPreference } = useTheme()
  const [pat, setPat] = useState('')
  const [editor, setEditor] = useState('')
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('rebase')
  const [debugLogging, setDebugLogging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open) {
      loadSettings()
    }
  }, [open])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const [storedPat, storedEditor, storedStrategy, storedDebugLogging] = await Promise.all([
        window.api.getGithubPat(),
        window.api.getPreferredEditor(),
        window.api.getMergeStrategy(),
        window.api.getDebugLogging()
      ])
      setPat(storedPat || '')
      setEditor(storedEditor || '')
      setMergeStrategy(storedStrategy)
      setDebugLogging(storedDebugLogging)
    } catch (error) {
      log.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePatChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setPat(newValue)
    try {
      await window.api.setGithubPat({ token: newValue })
    } catch (error) {
      log.error('Failed to save PAT:', error)
    }
  }

  const handleEditorChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setEditor(newValue)
    try {
      await window.api.setPreferredEditor({ editor: newValue })
    } catch (error) {
      log.error('Failed to save editor preference:', error)
    }
  }

  const handleMergeStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStrategy = e.target.value as MergeStrategy
    setMergeStrategy(newStrategy)
    try {
      await window.api.setMergeStrategy({ strategy: newStrategy })
    } catch (error) {
      log.error('Failed to save merge strategy:', error)
    }
  }

  const handleDebugLoggingChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked
    setDebugLogging(enabled)
    try {
      await window.api.setDebugLogging({ enabled })
    } catch (error) {
      log.error('Failed to save debug logging setting:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="space-y-2">
            <label htmlFor="theme-select" className="text-sm leading-none font-medium">
              Appearance
            </label>
            <p className="text-muted-foreground text-sm">Choose your preferred color scheme</p>
            <select
              id="theme-select"
              value={preference}
              onChange={(e) => setPreference(e.target.value as 'light' | 'dark' | 'system')}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <option value="system">System (follow OS preference)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm leading-none font-medium">Preferred Editor</h4>
            <p className="text-muted-foreground text-sm">
              Command to open worktrees in your editor. Leave empty for VS Code.
            </p>
            <input
              type="text"
              value={editor}
              onChange={handleEditorChange}
              disabled={isLoading}
              placeholder="code, cursor, subl, vim..."
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm leading-none font-medium">GitHub Personal Access Token</h4>
            <p className="text-muted-foreground text-sm">
              Create or revoke your token in{' '}
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                https://github.com/settings/tokens
              </a>
            </p>
            <p className="text-muted-foreground text-xs">
              This PAT needs &quot;repo&quot; scope to function properly.
            </p>
            <input
              type="password"
              value={pat}
              onChange={handlePatChange}
              disabled={isLoading}
              placeholder="ghp_..."
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm leading-none font-medium">PR Merge Strategy</h4>
            <p className="text-muted-foreground text-sm">
              How pull requests are merged when using Ship It
            </p>
            <select
              value={mergeStrategy}
              onChange={handleMergeStrategyChange}
              disabled={isLoading}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="rebase">Rebase (linear history, no merge commit)</option>
              <option value="squash">Squash (single commit)</option>
              <option value="merge">Merge commit (preserve branch history)</option>
            </select>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm leading-none font-medium">Debug Logging</h4>
            <p className="text-muted-foreground text-sm">
              Capture detailed logs for troubleshooting. Each repository has its own log file at{' '}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">.git/teapot-debug.log</code>,
              cleared when Teapot starts.
            </p>
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={debugLogging}
                  onChange={handleDebugLoggingChange}
                  disabled={isLoading}
                  className="accent-accent h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">Enable debug logging</span>
              </label>
              <button
                type="button"
                onClick={async () => {
                  const result = await window.api.showDebugLogFile()
                  if (!result.success && result.error) {
                    log.warn('Could not show debug log file:', result.error)
                  }
                }}
                className="text-accent text-sm hover:underline"
              >
                Show log file
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
