/**
 * Shared Git URL utilities - used by both frontend and backend
 */

/**
 * Extracts the repository name from a Git URL.
 *
 * Handles URLs like:
 * - https://github.com/user/repo.git
 * - https://github.com/user/repo
 * - git@github.com:user/repo.git
 * - git@github.com:user/repo
 *
 * @param url - The Git repository URL
 * @returns The repository name, or null if it cannot be extracted
 */
export function extractRepoName(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return null
  }

  // Remove trailing .git if present
  const withoutGit = trimmed.replace(/\.git$/, '')

  // Extract last path segment
  const lastSlash = withoutGit.lastIndexOf('/')
  const lastColon = withoutGit.lastIndexOf(':')
  const lastSeparator = Math.max(lastSlash, lastColon)

  if (lastSeparator === -1) {
    return null
  }

  const repoName = withoutGit.slice(lastSeparator + 1)
  return repoName || null
}

/**
 * Validates if a string looks like a valid Git URL.
 *
 * Checks for common Git URL patterns:
 * - HTTPS: https://host/path
 * - SSH: git@host:path
 * - Git protocol: git://host/path
 * - File protocol: file:///path (for local repos)
 *
 * @param url - The URL to validate
 * @returns true if the URL appears to be a valid Git URL
 */
export function isValidGitUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) {
    return false
  }

  // HTTPS URL pattern
  if (/^https?:\/\/[^/]+\/.+/.test(trimmed)) {
    return true
  }

  // SSH URL pattern (git@host:path)
  if (/^git@[^:]+:.+/.test(trimmed)) {
    return true
  }

  // Git protocol pattern
  if (/^git:\/\/[^/]+\/.+/.test(trimmed)) {
    return true
  }

  // File protocol pattern (for local repos)
  if (/^file:\/\/.+/.test(trimmed)) {
    return true
  }

  return false
}

/**
 * Invalid characters for folder names across Windows, macOS, and Linux.
 * Windows is the most restrictive, so we use its rules.
 * Includes: < > : " / \ | ? * and control characters (0x00-0x1F)
 */
// eslint-disable-next-line no-control-regex
const INVALID_FOLDER_CHARS = /[<>:"/\\|?*\x00-\x1f]/

/**
 * Reserved names on Windows that cannot be used as folder names.
 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Validates a folder name for use as a clone target.
 * Returns null if valid, or an error message if invalid.
 */
export function validateFolderName(name: string): string | null {
  const trimmed = name.trim()

  if (!trimmed) {
    return null // Empty is handled separately as "incomplete"
  }

  // Check for invalid characters
  if (INVALID_FOLDER_CHARS.test(trimmed)) {
    return 'Folder name contains invalid characters'
  }

  // Check for Windows reserved names
  if (WINDOWS_RESERVED_NAMES.test(trimmed)) {
    return 'This name is reserved by the system'
  }

  // Check for names that start or end with spaces or dots (problematic on Windows)
  if (trimmed !== name || trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return 'Folder name cannot end with a dot or space'
  }

  // Check for reasonable length (most filesystems limit to 255 bytes)
  if (trimmed.length > 255) {
    return 'Folder name is too long'
  }

  return null
}
