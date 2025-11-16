import { StackView } from './components/StackView'
import { TitleBar } from './components/TitleBar'
import { Topbar } from './components/Topbar'
import { useLocalStateContext } from './contexts/LocalStateContext'
import { useUiStateContext } from './contexts/UiStateContext'

function App(): React.JSX.Element {
  const { toggleTheme, uiState } = useUiStateContext()
  const { selectedRepo, addRepo } = useLocalStateContext()

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
        <Topbar onToggleTheme={toggleTheme} />

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
          ) : uiState?.stack ? (
            <StackView data={uiState.stack} workingTree={uiState.workingTree} />
          ) : (
            <div className="text-muted-foreground">Loading...</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
