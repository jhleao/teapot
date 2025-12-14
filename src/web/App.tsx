import { Settings } from 'lucide-react'
import React, { useMemo, useState } from 'react'
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
  const { uiState, repoError } = useUiStateContext()
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
            <div className="flex min-h-[400px] items-center justify-center">
              <div className="text-center">
                <svg
                  className="text-muted-foreground mx-auto mb-4 h-16 w-16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <h2 className="text-foreground mb-2 text-xl font-semibold">
                  No Repository Selected
                </h2>
                <p className="text-muted-foreground mb-6 text-sm">
                  Select a repository to get started with your Git workflow
                </p>
                <button
                  onClick={handleAddRepo}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 focus:ring-accent inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span>Select Repository</span>
                </button>
              </div>
            </div>
          ) : repoError ? (
            <div className="flex min-h-[400px] items-center justify-center">
              <div className="text-center">
                <svg
                  className="text-muted-foreground mx-auto mb-4 h-16 w-16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <h2 className="text-foreground mb-2 text-xl font-semibold">
                  Failed to load repository
                </h2>
                <p className="text-muted-foreground mx-auto mb-6 max-w-md text-sm">{repoError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 focus:ring-accent inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
                >
                  <span>Reload</span>
                </button>
              </div>
            </div>
          ) : enrichedStack ? (
            <StackView data={enrichedStack} workingTree={uiState?.workingTree ?? []} />
          ) : (
            <div className="text-muted-foreground">Loading...</div>
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
      <Toaster />
    </div>
  )
}

export default App
