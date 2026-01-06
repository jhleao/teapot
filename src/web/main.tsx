import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DragCursor } from './components/DragCursor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DragProvider } from './contexts/DragContext'
import { ForgeStateProvider } from './contexts/ForgeStateContext'
import { LocalStateProvider, useLocalStateContext } from './contexts/LocalStateContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { UiStateProvider } from './contexts/UiStateContext'
import { UtilityModalsProvider } from './contexts/UtilityModalsContext'

// eslint-disable-next-line react-refresh/only-export-components
function AppWithProviders(): React.JSX.Element {
  const { selectedRepo } = useLocalStateContext()
  const repoPath = selectedRepo?.path ?? null

  return (
    <ForgeStateProvider repoPath={repoPath}>
      <UiStateProvider selectedRepoPath={repoPath}>
        <UtilityModalsProvider>
          <DragProvider>
            <App />
            <DragCursor />
          </DragProvider>
        </UtilityModalsProvider>
      </UiStateProvider>
    </ForgeStateProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <LocalStateProvider>
          <AppWithProviders />
        </LocalStateProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
)
