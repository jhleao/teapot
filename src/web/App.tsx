import { StackView } from './components/StackView'
import { useGlobalCtx } from './contexts/GlobalContext'

function App(): React.JSX.Element {
  const { toggleTheme, uiState } = useGlobalCtx()

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Git Stack</h1>
        <button
          onClick={toggleTheme}
          className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2"
          role="switch"
          aria-label="Toggle dark mode"
        >
          <span className="inline-block h-4 w-4 transform rounded-full bg-card-foreground transition-transform translate-x-1" />
        </button>
      </div>

      <div className="">
        {uiState?.stack ? (
          <StackView data={uiState.stack} workingTree={uiState.workingTree} />
        ) : (
          <div className="text-muted-foreground">Loading...</div>
        )}
      </div>
    </div>
  )
}

export default App
