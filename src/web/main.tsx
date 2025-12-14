import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
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
    <UiStateProvider selectedRepoPath={repoPath}>
      <ForgeStateProvider repoPath={repoPath}>
        <DragProvider>
          <App />
        </DragProvider>
      </ForgeStateProvider>
    </UiStateProvider>
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
