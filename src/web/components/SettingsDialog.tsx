import { log } from '@shared/logger'
import { Moon, Sun } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const { toggleTheme, isDark } = useUiStateContext()
  const [pat, setPat] = useState('')
  const [editor, setEditor] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open) {
      loadSettings()
    }
  }, [open])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const [storedPat, storedEditor] = await Promise.all([
        window.api.getGithubPat(),
        window.api.getPreferredEditor()
      ])
      setPat(storedPat || '')
      setEditor(storedEditor || '')
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h4 className="text-sm leading-none font-medium">Appearance</h4>
              <p className="text-muted-foreground text-sm">Switch between light and dark mode</p>
            </div>
            <button
              onClick={toggleTheme}
              className="focus:ring-foreground bg-secondary hover:bg-secondary/80 flex h-10 w-10 cursor-pointer items-center justify-center rounded-md transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="text-foreground h-5 w-5" />
              ) : (
                <Moon className="text-foreground h-5 w-5" />
              )}
            </button>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
