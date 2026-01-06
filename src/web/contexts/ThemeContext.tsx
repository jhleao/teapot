import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'

type ThemePreference = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  /** The user's preference: light, dark, or system */
  preference: ThemePreference
  /** The resolved theme after applying system preference */
  theme: ResolvedTheme
  /** Convenience boolean for conditional styling */
  isDark: boolean
  /** Set explicit preference */
  setPreference: (preference: ThemePreference) => void
}

const STORAGE_KEY = 'teapot-theme'

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/**
 * Subscribe to system color scheme changes.
 */
function subscribeToSystemTheme(callback: () => void): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredPreference(): ThemePreference | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return null
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return getSystemTheme()
  }
  return preference
}

function applyThemeToDOM(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

// Apply theme immediately on module load to prevent flash
const initialPreference = getStoredPreference() ?? 'system'
const initialResolved = resolveTheme(initialPreference)
if (typeof document !== 'undefined') {
  applyThemeToDOM(initialResolved)
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)

  // Subscribe to system theme changes using useSyncExternalStore for proper React 18 concurrent mode support
  const systemTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemTheme,
    () => 'dark' as const // Server snapshot
  )

  const resolvedTheme: ResolvedTheme = preference === 'system' ? systemTheme : preference

  // Sync to DOM and localStorage
  useEffect(() => {
    applyThemeToDOM(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference)
  }, [preference])

  const setPreference = useCallback((newPreference: ThemePreference) => {
    setPreferenceState(newPreference)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme: resolvedTheme,
      isDark: resolvedTheme === 'dark',
      setPreference
    }),
    [preference, resolvedTheme, setPreference]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
