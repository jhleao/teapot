import React from 'react'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { ForgeStatusIndicator } from './ForgeStatusIndicator'
import { RepoMetadata } from './RepoMetadata'
import { RepoSelector } from './RepoSelector'

export function Topbar(): React.JSX.Element {
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

      {/* Right side: Actions and status */}
      <div className="flex shrink-0 items-center gap-3">
        <ForgeStatusIndicator />
        <RepoSelector
          repos={repos}
          onSelectRepo={selectRepo}
          onAddRepo={handleAddRepo}
          onRemoveRepo={removeRepo}
        />
      </div>
    </div>
  )
}
