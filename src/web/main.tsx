import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DragCursor } from './components/DragCursor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DragProvider } from './contexts/DragContext'
import { ForgeStateProvider } from './contexts/ForgeStateContext'
import { LocalStateProvider, useLocalStateContext } from './contexts/LocalStateContext'
import { ScrollViewportProvider } from './contexts/ScrollViewportContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { UiStateProvider } from './contexts/UiStateContext'
import { UtilityModalsProvider } from './contexts/UtilityModalsContext'

// eslint-disable-next-line react-refresh/only-export-components
function AppWithProviders(): React.JSX.Element {
  const { selectedRepo } = useLocalStateContext()
  // Use activeWorktreePath when in a worktree, otherwise use the main repo path
  const repoPath = selectedRepo?.activeWorktreePath ?? selectedRepo?.path ?? null

  return (
    <ForgeStateProvider repoPath={repoPath}>
      <UiStateProvider selectedRepoPath={repoPath}>
        <UtilityModalsProvider>
          <ScrollViewportProvider>
            <DragProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              <DragCursor />
            </DragProvider>
          </ScrollViewportProvider>
        </UtilityModalsProvider>
      </UiStateProvider>
    </ForgeStateProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LocalStateProvider>
        <AppWithProviders />
      </LocalStateProvider>
    </ThemeProvider>
  </StrictMode>
)
