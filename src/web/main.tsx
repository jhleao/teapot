import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DragProvider } from './contexts/DragContext'
import { LocalStateProvider } from './contexts/LocalStateContext'
import { UiStateProvider } from './contexts/UiStateContext'
import { useLocalStateContext } from './contexts/LocalStateContext'

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
    <LocalStateProvider>
      <AppWithProviders />
    </LocalStateProvider>
  </StrictMode>
)
