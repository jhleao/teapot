import React, { useState } from 'react'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { useUiStateContext } from '../contexts/UiStateContext'
import { CloneDialog } from './CloneDialog'
import { ForgeStatusIndicator } from './ForgeStatusIndicator'
import { RepoSelectorHeader } from './RepoSelectorHeader'
import { WorktreeSelector } from './WorktreeSelector'

export function Topbar(): React.JSX.Element {
  const { repos, selectedRepo, selectRepo, addRepo, removeRepo } = useLocalStateContext()
  const { uiState, isWorkingTreeDirty } = useUiStateContext()
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
    <>
      <div className="flex items-center gap-1" data-testid="topbar">
        <RepoSelectorHeader
          repo={selectedRepo}
          repos={repos}
          onSelectRepo={selectRepo}
          onAddRepo={handleAddRepo}
          onRemoveRepo={removeRepo}
          onCloneRepo={() => setIsCloneDialogOpen(true)}
        />
        {selectedRepo && (
          <>
            <span className="text-muted-foreground/50 text-sm">/</span>
            <WorktreeSelector
              worktrees={uiState?.worktrees ?? []}
              activeWorktreePath={selectedRepo.activeWorktreePath}
              repoPath={selectedRepo.path}
              isWorkingTreeDirty={isWorkingTreeDirty}
            />
          </>
        )}
        <ForgeStatusIndicator />
      </div>

      <CloneDialog
        open={isCloneDialogOpen}
        onOpenChange={setIsCloneDialogOpen}
        onCloneComplete={handleCloneComplete}
      />
    </>
  )
}
