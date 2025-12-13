# Issue: "useUiStateContext must be used within a UiStateProvider" on Crash

## Observed Behavior

When an error occurs during a rebase operation (or other git operations), the app shows:

```
Something went wrong
useUiStateContext must be used within a UiStateProvider
[Reload]
```

## Root Cause Analysis

### Component Hierarchy

```
ErrorBoundary                    ← catches errors, renders fallback
  └─ LocalStateProvider
       └─ UiStateProvider        ← provides git state + theme
            └─ DragProvider
                 └─ App
                      ├─ StackView
                      ├─ SettingsDialog
                      └─ Toaster  ← calls useUiStateContext() for isDark
```

### The Problem

1. An error occurs somewhere inside `UiStateProvider` or its children (e.g., during rebase)
2. React's error boundary catches it and unmounts the failed subtree
3. `ErrorBoundary` renders its fallback UI
4. The error message displayed is the **original thrown error**

But wait - why does the error say "useUiStateContext must be used within a UiStateProvider"?

### Hypothesis A: Error During Initial Mount

If `UiStateProvider` itself throws during initialization (e.g., in `useGitWatcher`, `refreshRepo`, or an effect), the context is never established. Any child component trying to use `useUiStateContext()` will throw this error.

Looking at `UiStateContext.tsx`:
```typescript
export function UiStateProvider({ ... }) {
  // These could throw:
  const refreshRepo = useCallback(async () => {
    const uiState = await window.api.getRepo({ repoPath })  // IPC call
    // ...
  }, [repoPath])

  useEffect(() => {
    refreshRepo()  // Called on mount - if this throws synchronously...
  }, [refreshRepo])

  useGitWatcher({  // This hook could throw
    repoPath,
    onRepoChange: refreshRepo,
    // ...
  })
  // ...
}
```

### Hypothesis B: Toaster Renders Outside Provider After Error

The `Toaster` component is rendered inside `App`:
```typescript
function App() {
  const { uiState, repoError } = useUiStateContext()  // ← throws if no provider
  // ...
  return (
    <div>
      {/* ... */}
      <Toaster />  {/* Also uses useUiStateContext for isDark */}
    </div>
  )
}
```

When an error bubbles up, React may attempt to re-render components in an inconsistent state.

## Is This a Bug?

**Yes, architecturally.** The issue is that:

1. **Theme is coupled to git state**: `Toaster` only needs `isDark` for styling, but it's forced to depend on the entire `UiStateContext` which includes git operations
2. **Error boundary placement**: The boundary is outside the provider, so provider failures leave children without context
3. **No graceful degradation**: When git operations fail, the entire UI crashes instead of showing an error state

## Proposed Solutions

### Option 1: Extract ThemeProvider (Recommended)

**Rationale**: Theme is a global UI concern unrelated to git state. It should survive provider failures.

```
ThemeProvider                    ← provides isDark, toggleTheme
  └─ ErrorBoundary
       └─ LocalStateProvider
            └─ UiStateProvider   ← provides git state only
                 └─ DragProvider
                      └─ App
                           └─ Toaster  ← uses ThemeProvider directly
```

**New file: `src/web/contexts/ThemeContext.tsx`**
```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface ThemeContextValue {
  isDark: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    const html = document.documentElement
    if (isDark) html.classList.add('dark')
    else html.classList.remove('dark')
  }, [isDark])

  const toggleTheme = () => setIsDark((prev) => !prev)

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
```

**Changes to `main.tsx`**:
```typescript
import { ThemeProvider } from './contexts/ThemeContext'

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
```

**Changes to `Toaster.tsx`**:
```typescript
import { useTheme } from '../contexts/ThemeContext'

const Toaster = ({ ...props }: ToasterProps) => {
  const { isDark } = useTheme()  // No longer depends on UiStateContext
  // ...
}
```

**Changes to `UiStateContext.tsx`**:
- Remove `isDark`, `toggleTheme` state and effects
- Import and re-export from ThemeContext for backward compatibility (or update all consumers)

**Pros**:
- Clean separation of concerns
- Theme survives any provider failure
- ErrorBoundary can render themed fallback
- Foundation for future preferences (font size, etc.)

**Cons**:
- More files/providers
- Migration effort for existing consumers

---

### Option 2: Move Toaster Outside Provider Chain

**Rationale**: Toaster doesn't need React context for theming - it can use CSS custom properties.

**Changes to `main.tsx`**:
```typescript
function AppWithProviders() {
  const { selectedRepo } = useLocalStateContext()

  return (
    <>
      <UiStateProvider selectedRepoPath={selectedRepo?.path ?? null}>
        <DragProvider>
          <App />
        </DragProvider>
      </UiStateProvider>
      <Toaster />  {/* Outside provider, uses CSS for theme */}
    </>
  )
}
```

**Changes to `Toaster.tsx`**:
```typescript
const Toaster = ({ ...props }: ToasterProps) => {
  // Use CSS custom properties instead of context
  // The dark class on <html> already sets these
  return (
    <Sonner
      theme="system"  // Or detect from CSS/media query
      // ...
    />
  )
}
```

**Pros**:
- Minimal changes
- No new providers

**Cons**:
- Theme detection is less React-idiomatic
- Harder to sync with other themed components

---

### Option 3: Add Error Boundary Inside UiStateProvider

**Rationale**: Catch errors closer to where they occur, show git-specific error UI while keeping context alive.

```typescript
export function UiStateProvider({ children, selectedRepoPath }) {
  // ... state setup ...

  return (
    <UiStateContext.Provider value={...}>
      <UiStateErrorBoundary onError={setRepoError}>
        {children}
      </UiStateErrorBoundary>
    </UiStateContext.Provider>
  )
}
```

**Pros**:
- Context remains available during error state
- Can show contextual error UI

**Cons**:
- Doesn't help if provider itself fails to initialize
- More complex error handling logic

---

## Recommendation

**Option 1 (ThemeProvider)** is the cleanest architectural solution because:

1. It correctly models the domain: theme ≠ git state
2. It's future-proof for other global preferences
3. It allows the error boundary to render themed fallbacks
4. It follows React best practices for context composition

The implementation is straightforward and the migration path is clear.

## Test Cases to Verify Fix

1. Trigger an error during rebase → should show themed error page, not context error
2. Toggle theme → should persist across provider remounts
3. Git operation failure → should show error in UI, not crash entire app
4. Reload after error → should restore normal operation
