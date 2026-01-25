import React, { useState } from 'react'
import { useLocalStateContext } from '../contexts/LocalStateContext'
import { CloneDialog } from './CloneDialog'
import { RepoSelectorHeader } from './RepoSelectorHeader'

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
    <>
      <RepoSelectorHeader
        repo={selectedRepo}
        repos={repos}
        onSelectRepo={selectRepo}
        onAddRepo={handleAddRepo}
        onRemoveRepo={removeRepo}
        onCloneRepo={() => setIsCloneDialogOpen(true)}
      />

      <CloneDialog
        open={isCloneDialogOpen}
        onOpenChange={setIsCloneDialogOpen}
        onCloneComplete={handleCloneComplete}
      />
    </>
  )
}
