import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject
} from 'react'

interface ScrollViewportContextValue {
  viewportRef: RefObject<HTMLElement | null>
  setViewportRef: (element: HTMLElement | null) => void
}

const ScrollViewportContext = createContext<ScrollViewportContextValue | undefined>(undefined)

export function ScrollViewportProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const viewportRef = useRef<HTMLElement | null>(null)

  const setViewportRef = useCallback((element: HTMLElement | null): void => {
    viewportRef.current = element
  }, [])

  const value = useMemo(
    () => ({ viewportRef, setViewportRef }),
    [setViewportRef]
  )

  return (
    <ScrollViewportContext.Provider value={value}>
      {children}
    </ScrollViewportContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useScrollViewport(): ScrollViewportContextValue {
  const context = useContext(ScrollViewportContext)
  if (context === undefined) {
    throw new Error('useScrollViewport must be used within a ScrollViewportProvider')
  }
  return context
}
