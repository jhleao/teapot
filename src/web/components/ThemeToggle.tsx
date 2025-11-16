import { Moon, Sun } from 'lucide-react'
import React from 'react'
import { useUiStateContext } from '../contexts/UiStateContext'

export function ThemeToggle(): React.JSX.Element {
  const { toggleTheme, isDark } = useUiStateContext()

  return (
    <button
      onClick={toggleTheme}
      className="focus:ring-foreground fixed bottom-6 right-6 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun className="h-5 w-5 text-foreground" />
      ) : (
        <Moon className="h-5 w-5 text-foreground" />
      )}
    </button>
  )
}

