import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DragCursor } from './components/DragCursor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DragProvider } from './contexts/DragContext'
import { ForgeStateProvider } from './contexts/ForgeStateContext'
import { LocalStateProvider, useLocalStateContext } from './contexts/LocalStateContext'
import { UiStateProvider } from './contexts/UiStateContext'

// eslint-disable-next-line react-refresh/only-export-components
function AppWithProviders(): React.JSX.Element {
  const { selectedRepo } = useLocalStateContext()
  const repoPath = selectedRepo?.path ?? null

  return (
    <ForgeStateProvider repoPath={repoPath}>
      <UiStateProvider selectedRepoPath={repoPath}>
        <DragProvider>
          <App />
          <DragCursor />
        </DragProvider>
      </UiStateProvider>
    </ForgeStateProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LocalStateProvider>
        <AppWithProviders />
      </LocalStateProvider>
    </ErrorBoundary>
  </StrictMode>
)
