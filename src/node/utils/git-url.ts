/**
 * Extracts the repository name from a Git URL.
 *
 * Handles URLs like:
 * - https://github.com/user/repo.git
 * - https://github.com/user/repo
 * - git@github.com:user/repo.git
 * - git@github.com:user/repo
 */
export function extractRepoName(url: string): string | null {
  const trimmed = url.trim()

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
