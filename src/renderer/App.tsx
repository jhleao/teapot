import { useEffect } from 'react'
import type { UiStack as StackType, UiCommit } from '@shared/types'
import { StackView } from './components/StackView'
import { useGlobalCtx } from './contexts/GlobalContext'

// Helper to find commit by SHA in nested stack structure
function findCommitBySha(stack: StackType | null, sha: string | null): UiCommit | null {
  if (!stack || !sha) return null

  for (const commit of stack.commits) {
    if (commit.sha === sha) return commit

    // Recursively search spinoffs
    for (const spinoff of commit.spinoffs) {
      const found = findCommitBySha(spinoff, sha)
      if (found) return found
    }
  }

  return null
}

function App(): React.JSX.Element {
  const { toggleTheme, draggingCommitSha, commitBelowMouse, setStacks, getEffectiveStacks } =
    useGlobalCtx()

  useEffect(() => {
    window.api.getRepo().then(setStacks)
  }, [setStacks])

  const { stacks: effectiveStacks, isOptimistic } = getEffectiveStacks()
  const draggingCommit = findCommitBySha(effectiveStacks, draggingCommitSha)
  const belowCommit = findCommitBySha(effectiveStacks, commitBelowMouse)

  console.log(effectiveStacks)

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
          <span className="inline-block h-4 w-4 transform rounded-full bg-card-foreground transition-transform translate-x-1 dark:translate-x-6" />
        </button>
      </div>

      {/* Debug display */}
      <div className="mb-4 p-3 bg-muted rounded-lg text-sm font-mono">
        <div>
          <span className="text-muted-foreground">Dragging: </span>
          <span className="font-semibold">{draggingCommit?.name || 'null'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Below mouse: </span>
          <span className="font-semibold">{belowCommit?.name || 'null'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Optimistic: </span>
          <span className="font-semibold">{isOptimistic ? 'true' : 'false'}</span>
        </div>
      </div>

      <div className="">
        {effectiveStacks ? (
          <StackView data={effectiveStacks} />
        ) : (
          <div className="text-muted-foreground">Loading...</div>
        )}
      </div>
    </div>
  )
}

export default App
