import React from 'react'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { RepoMetadata } from './RepoMetadata'
import { RepoSelector } from './RepoSelector'

export function Topbar({ onToggleTheme }: { onToggleTheme: () => void }): React.JSX.Element {
  const { repos, selectedRepo, selectRepo, addRepo, removeRepo } = useLocalStateContext()

  const handleAddRepo = async (): Promise<void> => {
    const selectedPath = await window.api.showFolderPicker()
    if (selectedPath) {
      await addRepo(selectedPath)
    }
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      {/* Left side: Repository metadata */}
      <div className="min-w-0 flex-1">
        {selectedRepo ? (
          <RepoMetadata repo={selectedRepo} />
        ) : (
          <div className="text-muted-foreground text-sm">No repository selected</div>
        )}
      </div>

      {/* Right side: Actions */}
      <div className="flex shrink-0 items-center gap-3">
        <RepoSelector
          repos={repos}
          onSelectRepo={selectRepo}
          onAddRepo={handleAddRepo}
          onRemoveRepo={removeRepo}
        />

        {/* Theme toggle button */}
        <button
          onClick={onToggleTheme}
          className="bg-muted focus:ring-foreground relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
          role="switch"
          aria-label="Toggle dark mode"
        >
          <span className="bg-card-foreground inline-block h-4 w-4 translate-x-1 transform rounded-full transition-transform" />
        </button>
      </div>
    </div>
  )
}
