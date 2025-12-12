import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DragProvider } from './contexts/DragContext'
import { LocalStateProvider, useLocalStateContext } from './contexts/LocalStateContext'
import { UiStateProvider } from './contexts/UiStateContext'

// eslint-disable-next-line react-refresh/only-export-components
function AppWithProviders(): React.JSX.Element {
  const { selectedRepo } = useLocalStateContext()

  return (
    <UiStateProvider selectedRepoPath={selectedRepo?.path ?? null}>
      <DragProvider>
        <App />
      </DragProvider>
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
