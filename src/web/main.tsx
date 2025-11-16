import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { UiStateProvider } from './contexts/UiStateContext'
import { DragProvider } from './contexts/DragContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiStateProvider>
      <DragProvider>
        <App />
      </DragProvider>
    </UiStateProvider>
  </StrictMode>
)
