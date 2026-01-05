/**
 * GitUrlParser - Pure functions for parsing Git URLs
 *
 * This module provides deterministic parsing of Git repository URLs
 * without any I/O operations.
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
 * Detects if a Git error message indicates an authentication failure.
 *
 * @param errorMessage - The error message from a git operation
 * @returns An object indicating if it's an auth error and a user-friendly message
 */
export function parseGitCloneError(
  errorMessage: string,
  url: string
): { isAuthError: boolean; userMessage: string } {
  const lowerMessage = errorMessage.toLowerCase()
  const isHttps = url.startsWith('https://')
  const isSsh = url.startsWith('git@')

  // Authentication failures
  if (
    lowerMessage.includes('authentication failed') ||
    lowerMessage.includes('could not read username')
  ) {
    return {
      isAuthError: true,
      userMessage: isHttps
        ? 'Authentication failed. For private repos, try using an SSH URL (git@github.com:...) or configure Git credentials.'
        : 'Authentication failed. Check your Git credentials.'
    }
  }

  // SSH key issues
  if (lowerMessage.includes('permission denied (publickey)')) {
    return {
      isAuthError: true,
      userMessage:
        'SSH key authentication failed. Ensure your SSH key is added to your Git provider and ssh-agent is running.'
    }
  }

  // Repository not found (could be private repo without access)
  if (lowerMessage.includes('repository not found')) {
    return {
      isAuthError: false,
      userMessage:
        'Repository not found. Check the URL is correct, or if private, ensure you have access.'
    }
  }

  // Host key verification (first time connecting to host)
  if (lowerMessage.includes('host key verification failed')) {
    return {
      isAuthError: true,
      userMessage: isSsh
        ? 'Host key verification failed. Try running "ssh -T git@github.com" in terminal first.'
        : 'Host key verification failed.'
    }
  }

  // Default: return original message
  return {
    isAuthError: false,
    userMessage: errorMessage
  }
}
