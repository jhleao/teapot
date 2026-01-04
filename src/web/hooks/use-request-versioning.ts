import { useCallback, useRef } from 'react'

interface RequestVersioning {
  /** Increment version and return the new value. Call at start of any async operation. */
  acquireVersion: () => number
  /** Check if the given version is still current. Call before applying state. */
  checkVersion: (version: number) => boolean
}

/**
 * Hook to prevent race conditions in async state updates.
 * Each call to this hook creates an independent version counter.
 *
 * Usage:
 * ```ts
 * const { acquireVersion, checkVersion } = useRequestVersioning()
 *
 * const refresh = useCallback(async () => {
 *   const version = acquireVersion()
 *   const result = await fetchData()
 *   if (!checkVersion(version)) return // stale, discard
 *   setState(result)
 * }, [acquireVersion, checkVersion])
 * ```
 */
export function useRequestVersioning(): RequestVersioning {
  const versionRef = useRef(0)

  const acquireVersion = useCallback(() => ++versionRef.current, [])
  const checkVersion = useCallback((v: number) => v === versionRef.current, [])

  return { acquireVersion, checkVersion }
}
