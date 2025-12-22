/**
 * Conflict marker detection utilities.
 *
 * Detects Git conflict markers in file contents to determine if a conflicted
 * file has been resolved (markers removed) without requiring git staging.
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

// Conflict markers must be at start of line
const CONFLICT_START = /^<{7} /m // <<<<<<< branch
const CONFLICT_SEP = /^={7}$/m // =======
const CONFLICT_END = /^>{7} /m // >>>>>>> branch

/**
 * Check if a file contains Git conflict markers.
 * Returns true if ALL three marker types are present (unresolved conflict).
 * Returns false if any markers are missing (resolved or not a conflict file).
 */
export async function hasConflictMarkers(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8')
    // All three markers must be present for an unresolved conflict
    return CONFLICT_START.test(content) && CONFLICT_SEP.test(content) && CONFLICT_END.test(content)
  } catch {
    // File doesn't exist or can't be read - treat as resolved
    return false
  }
}

/**
 * Check conflict resolution status for multiple files.
 * Returns a map of file path -> resolved status.
 * A file is "resolved" if it no longer contains conflict markers.
 */
export async function checkConflictResolution(
  repoPath: string,
  conflictedPaths: string[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>()

  await Promise.all(
    conflictedPaths.map(async (relativePath) => {
      const fullPath = join(repoPath, relativePath)
      const hasMarkers = await hasConflictMarkers(fullPath)
      results.set(relativePath, !hasMarkers) // resolved = no markers
    })
  )

  return results
}
