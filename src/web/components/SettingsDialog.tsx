import { log } from '@shared/logger'
import type { FileLogLevel } from '@shared/types'
import type { MergeStrategy } from '@shared/types/git-forge'
import { ExternalLink } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

const FILE_LOG_LEVEL_OPTIONS: ReadonlyArray<{
  value: FileLogLevel
  label: string
  description: string
}> = [
  { value: 'off', label: 'Off', description: 'No logs will be written to disk' },
  { value: 'standard', label: 'Standard', description: 'Info, warnings, and errors' },
  { value: 'verbose', label: 'Verbose', description: 'Standard + debug messages' },
  { value: 'everything', label: 'All', description: 'All logs including performance traces' }
]

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const { preference, setPreference } = useTheme()
  const [pat, setPat] = useState('')
  const [editor, setEditor] = useState('')
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('rebase')
  const [fileLogLevel, setFileLogLevel] = useState<FileLogLevel>('off')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open) {
      loadSettings()
    }
  }, [open])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const [storedPat, storedEditor, storedStrategy, storedFileLogLevel] = await Promise.all([
        window.api.getGithubPat(),
        window.api.getPreferredEditor(),
        window.api.getMergeStrategy(),
        window.api.getFileLogLevel()
      ])
      setPat(storedPat || '')
      setEditor(storedEditor || '')
      setMergeStrategy(storedStrategy)
      setFileLogLevel(storedFileLogLevel)
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

  const handleFileLogLevelChange = async (level: FileLogLevel) => {
    setFileLogLevel(level)
    try {
      await window.api.setFileLogLevel({ level })
    } catch (error) {
      log.error('Failed to save file log level setting:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="settings-dialog">
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
              <option value="rebase">Rebase & Merge</option>
              <option value="squash">Squash & Merge</option>
              <option value="merge">Merge</option>
              <option value="fast-forward">Fast-forward (no merge commit)</option>
            </select>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm leading-none font-medium">Debug Logging</h4>
            <div className="text-muted-foreground text-sm">
              <p>Capture logs for troubleshooting</p>
              <p className="mt-1">
                Saved per repository in{' '}
                <button
                  type="button"
                  onClick={async () => {
                    const result = await window.api.showDebugLogFile()
                    if (!result.success && result.error) {
                      log.warn('Could not show debug log file:', result.error)
                    }
                  }}
                  className="bg-muted inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono hover:underline"
                >
                  .git/teapot-debug.log
                  <ExternalLink className="h-3 w-3" />
                </button>
              </p>
            </div>
            <div className="space-y-2">
              <div
                className="bg-muted/30 flex w-full rounded-lg p-1"
                role="radiogroup"
                aria-label="Log level"
              >
                {FILE_LOG_LEVEL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={fileLogLevel === option.value}
                    disabled={isLoading}
                    onClick={() => handleFileLogLevelChange(option.value)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      fileLogLevel === option.value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground min-h-[1.25rem] text-xs">
                {FILE_LOG_LEVEL_OPTIONS.find((o) => o.value === fileLogLevel)?.description}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
