import React, { useState } from 'react'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { CloneDialog } from './CloneDialog'
import { ForgeStatusIndicator } from './ForgeStatusIndicator'
import { RepoMetadata } from './RepoMetadata'
import { RepoSelector } from './RepoSelector'

export function Topbar(): React.JSX.Element {
  const { repos, selectedRepo, selectRepo, addRepo, removeRepo } = useLocalStateContext()
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false)

  const handleAddRepo = async (): Promise<void> => {
    const selectedPath = await window.api.showFolderPicker()
    if (selectedPath) {
      await addRepo(selectedPath)
    }
  }

  const handleCloneComplete = async (repoPath: string): Promise<void> => {
    await selectRepo(repoPath)
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-4" data-testid="topbar">
      {/* Left side: Repository metadata */}
      <div className="min-w-0 flex-1" data-testid="repo-metadata-container">
        {selectedRepo ? (
          <RepoMetadata repo={selectedRepo} />
        ) : (
          <div className="text-muted-foreground text-sm" data-testid="no-repo-message">No repository selected</div>
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
          onCloneRepo={() => setIsCloneDialogOpen(true)}
        />
      </div>

      <CloneDialog
        open={isCloneDialogOpen}
        onOpenChange={setIsCloneDialogOpen}
        onCloneComplete={handleCloneComplete}
      />
    </div>
  )
}
