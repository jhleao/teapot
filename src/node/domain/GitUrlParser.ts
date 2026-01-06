/**
 * GitUrlParser - Pure functions for parsing Git URLs
 *
 * This module re-exports shared utilities and adds backend-specific
 * error parsing functionality.
 */

// Re-export shared utilities
export { extractRepoName, isValidGitUrl, validateFolderName } from '@shared/git-url'

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
