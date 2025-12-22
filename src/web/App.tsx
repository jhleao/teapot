import { Settings } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { ConflictResolutionDialog } from './components/ConflictResolutionDialog'
import { EmptyState } from './components/EmptyState'
import { SettingsDialog } from './components/SettingsDialog'
import { StackView } from './components/StackView'
import { TitleBar } from './components/TitleBar'
import { Toaster } from './components/Toaster'
import { Topbar } from './components/Topbar'
import { useForgeStateContext } from './contexts/ForgeStateContext'
import { useLocalStateContext } from './contexts/LocalStateContext'
import { useUiStateContext } from './contexts/UiStateContext'
import { enrichStackWithForge } from './utils/enrich-stack-with-forge'

function App(): React.JSX.Element {
  const { uiState, repoError, isRebasingWithConflicts } = useUiStateContext()
  const { forgeState } = useForgeStateContext()
  const { selectedRepo, addRepo } = useLocalStateContext()

  // Merge forge state (PR data) into the UI stack at render time
  // This allows local data to display immediately while forge state loads asynchronously
  const enrichedStack = useMemo(
    () => enrichStackWithForge(uiState?.stack ?? null, forgeState),
    [uiState?.stack, forgeState]
  )
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const handleAddRepo = async (): Promise<void> => {
    const selectedPath = await window.api.showFolderPicker()
    if (selectedPath) {
      await addRepo(selectedPath)
    }
  }

  return (
    <div className="flex flex-col">
      <TitleBar />
      <div className="px-6 py-2">
        <Topbar />

        <div className="">
          {!selectedRepo ? (
            <EmptyState variant="no-repo" onAction={handleAddRepo} />
          ) : repoError ? (
            <EmptyState variant="error" errorMessage={repoError} />
          ) : enrichedStack ? (
            <StackView data={enrichedStack} workingTree={uiState?.workingTree ?? []} />
          ) : (
            <EmptyState variant="loading" />
          )}
        </div>
      </div>

      <button
        onClick={() => setIsSettingsOpen(true)}
        className="focus:ring-foreground bg-secondary text-secondary-foreground hover:bg-secondary/80 fixed right-6 bottom-6 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full shadow-lg transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
        aria-label="Settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      {isRebasingWithConflicts && <ConflictResolutionDialog />}
      <Toaster />
    </div>
  )
}

export default App
