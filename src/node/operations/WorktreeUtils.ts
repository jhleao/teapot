/**
 * WorktreeUtils - Utilities for worktree management
 *
 * Centralizes stale worktree detection and pruning logic to ensure
 * consistent handling across the codebase.
 */

import * as fs from 'fs'
import * as path from 'path'

import { log } from '@shared/logger'

import { getGitAdapter } from '../adapters/git'

// ===========================================================================
// Git Directory Resolution
// ===========================================================================

/**
 * Cache for resolved git directories to avoid repeated I/O.
 * Maps repoPath -> resolved git directory path.
 */
const gitDirCache: Map<string, string> = new Map()

/**
 * Resolve the actual git directory path for a repository.
 *
 * In a regular git repository, .git is a directory containing the git data.
 * In a linked worktree, .git is a file containing "gitdir: /path/to/actual/git/dir".
 *
 * This function handles both cases and returns the path where git stores its data
 * (lock files, context files, worktree directories, etc.).
 *
 * Results are cached per repoPath since the git directory doesn't change during execution.
 *
 * @param repoPath - Path to the repository (or worktree)
 * @returns The resolved git directory path
 */
export async function resolveGitDir(repoPath: string): Promise<string> {
  // Check cache first
  const cached = gitDirCache.get(repoPath)
  if (cached) {
    return cached
  }

  const gitPath = path.join(repoPath, '.git')

  try {
    const stat = await fs.promises.stat(gitPath)
    if (stat.isDirectory()) {
      gitDirCache.set(repoPath, gitPath)
      return gitPath
    }

    // It's a file - read the gitdir pointer
    const content = await fs.promises.readFile(gitPath, 'utf-8')
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (match) {
      const linkedGitDir = match[1].trim()
      const resolvedDir = path.isAbsolute(linkedGitDir)
        ? linkedGitDir
        : path.resolve(repoPath, linkedGitDir)
      gitDirCache.set(repoPath, resolvedDir)
      return resolvedDir
    }

    // Fallback if format doesn't match
    gitDirCache.set(repoPath, gitPath)
    return gitPath
  } catch {
    // If we can't stat, assume it's a directory
    gitDirCache.set(repoPath, gitPath)
    return gitPath
  }
}

/**
 * Synchronous version of resolveGitDir for use in exit handlers.
 * Does NOT use the cache since this is only called during process exit.
 *
 * @param repoPath - Path to the repository (or worktree)
 * @returns The resolved git directory path
 */
export function resolveGitDirSync(repoPath: string): string {
  const gitPath = path.join(repoPath, '.git')

  try {
    const stat = fs.statSync(gitPath)
    if (stat.isDirectory()) {
      return gitPath
    }

    // It's a file - read the gitdir pointer
    const content = fs.readFileSync(gitPath, 'utf-8')
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (match) {
      const linkedGitDir = match[1].trim()
      return path.isAbsolute(linkedGitDir) ? linkedGitDir : path.resolve(repoPath, linkedGitDir)
    }

    return gitPath
  } catch {
    return gitPath
  }
}

/**
 * Clear the git directory cache. Useful for testing.
 */
export function clearGitDirCache(): void {
  gitDirCache.clear()
}

// ===========================================================================
// Stale Rebase File Cleanup
// ===========================================================================

/**
 * Files that git may leave behind after a rebase completes or aborts.
 * These don't prevent `detectRebase()` from returning false (it only checks
 * for `rebase-merge/` and `rebase-apply/` dirs), but they can interfere
 * with other git operations like worktree switching.
 */
const STALE_REBASE_FILES = ['AUTO_MERGE', 'REBASE_HEAD', 'ORIG_HEAD']

/**
 * Remove stale rebase-related files from a git directory.
 *
 * After `git rebase --continue` or `--abort`, git removes the `rebase-merge/`
 * and `rebase-apply/` directories but may leave behind `AUTO_MERGE`,
 * `REBASE_HEAD`, and `ORIG_HEAD`. These leftover files can block worktree
 * switching and other operations.
 *
 * This function only removes the files when no active rebase is in progress
 * (i.e., neither `rebase-merge/` nor `rebase-apply/` directories exist).
 *
 * @param gitDir - The resolved git directory path (from `resolveGitDir()`)
 */
export async function cleanupStaleRebaseFiles(gitDir: string): Promise<void> {
  // Don't clean up if a rebase is actually in progress
  const rebaseMerge = path.join(gitDir, 'rebase-merge')
  const rebaseApply = path.join(gitDir, 'rebase-apply')

  const rebaseActive = await fs.promises
    .access(rebaseMerge)
    .then(
      () => true,
      () => false
    )
    .then(async (mergeExists) => {
      if (mergeExists) return true
      return fs.promises.access(rebaseApply).then(
        () => true,
        () => false
      )
    })

  if (rebaseActive) return

  // Remove stale files, ignoring errors for missing files
  await Promise.all(
    STALE_REBASE_FILES.map((file) =>
      fs.promises.unlink(path.join(gitDir, file)).catch(() => {
        /* file doesn't exist — fine */
      })
    )
  )
}

// ===========================================================================
// Stale Worktree Detection
// ===========================================================================

/**
 * Result of checking whether a worktree is stale
 */
export type StaleCheckResult = {
  isStale: boolean
  reason?: 'marked_prunable' | 'directory_missing'
}

/**
 * Result of pruning stale worktrees
 */
export type PruneResult = {
  pruned: boolean
  error?: string
}

/**
 * Normalizes a path by resolving symlinks where possible.
 *
 * If the path exists, returns the fully resolved real path.
 * If the path doesn't exist, attempts to resolve the parent directory
 * and reconstruct the path. This handles cases where a worktree directory
 * was deleted but we still need to match it against git's worktree list.
 *
 * This is important on systems with symlinked directories (e.g., macOS
 * where /var -> /private/var, or /tmp -> /private/tmp).
 *
 * @param inputPath - The path to normalize
 * @returns The normalized path with symlinks resolved
 */
export async function normalizePath(inputPath: string): Promise<string> {
  // First, try to resolve the full path
  try {
    return await fs.promises.realpath(inputPath)
  } catch {
    // Path doesn't exist - try to resolve parent directories
    // and reconstruct the path
  }

  // Walk up the directory tree to find the deepest existing ancestor
  const segments: string[] = []
  let currentPath = inputPath

  while (currentPath !== path.dirname(currentPath)) {
    segments.unshift(path.basename(currentPath))
    currentPath = path.dirname(currentPath)

    try {
      const resolvedParent = await fs.promises.realpath(currentPath)
      // Reconstruct the path with the resolved parent
      return path.join(resolvedParent, ...segments)
    } catch {
      // Parent doesn't exist either, continue walking up
    }
  }

  // Could not resolve any parent - return original path
  return inputPath
}

/**
 * Options for isWorktreeStale
 */
export type IsWorktreeStaleOptions = {
  /** Pre-fetched worktrees list to avoid redundant git calls */
  worktrees?: Array<{ path: string; isStale?: boolean }>
}

/**
 * Checks if a worktree path refers to a stale (orphaned) worktree.
 *
 * A worktree is considered stale if:
 * 1. Git marks it as "prunable" (isStale flag from listWorktrees)
 * 2. The worktree directory doesn't exist on disk
 *
 * @param repoPath - Path to the repository
 * @param worktreePath - Path to the worktree to check
 * @param options - Optional configuration including pre-fetched worktrees
 * @returns StaleCheckResult indicating if the worktree is stale and why
 */
export async function isWorktreeStale(
  repoPath: string,
  worktreePath: string,
  options: IsWorktreeStaleOptions = {}
): Promise<StaleCheckResult> {
  // Use pre-fetched worktrees if provided, otherwise fetch them
  let worktrees = options.worktrees
  if (!worktrees) {
    const git = getGitAdapter()
    worktrees = await git.listWorktrees(repoPath, { skipDirtyCheck: true })
  }

  // Normalize the input path to handle symlinks (e.g., /var -> /private/var on macOS)
  const normalizedPath = await normalizePath(worktreePath)

  // Check if the path actually exists on disk
  const pathExists = await fs.promises.access(worktreePath).then(
    () => true,
    () => false
  )

  // Find the worktree in git's list by normalized path
  const worktree = worktrees.find((wt) => wt.path === normalizedPath)

  if (!worktree) {
    // Not in git's list - not stale, just doesn't exist as a worktree
    return { isStale: false }
  }

  // Check if git already marked it as stale/prunable
  if (worktree.isStale) {
    return { isStale: true, reason: 'marked_prunable' }
  }

  // Check if directory is missing (git may not always mark as prunable immediately)
  if (!pathExists) {
    return { isStale: true, reason: 'directory_missing' }
  }

  return { isStale: false }
}

/**
 * Prunes stale worktree references from git's registry.
 *
 * This is safe to call even if there are no stale worktrees - git will
 * simply do nothing in that case.
 *
 * Handles potential race conditions gracefully by catching and logging
 * errors rather than throwing.
 *
 * @param repoPath - Path to the repository
 * @returns PruneResult indicating success or failure
 */
export async function pruneStaleWorktrees(repoPath: string): Promise<PruneResult> {
  const git = getGitAdapter()

  try {
    await git.pruneWorktrees(repoPath)
    return { pruned: true }
  } catch (error) {
    // Prune can fail if another process modified worktrees concurrently
    // This is not fatal - log and continue
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`[WorktreeUtils] Failed to prune worktrees (may have been modified concurrently):`, {
      error: message
    })
    return { pruned: false, error: message }
  }
}

/**
 * Checks if a worktree is stale and prunes if necessary.
 *
 * Convenience function that combines isWorktreeStale and pruneStaleWorktrees
 * for the common case of "check and prune if needed".
 *
 * @param repoPath - Path to the repository
 * @param worktreePath - Path to the worktree to check
 * @returns Object indicating if the worktree was stale and if pruning succeeded
 */
export async function pruneIfStale(
  repoPath: string,
  worktreePath: string
): Promise<{ wasStale: boolean; pruned: boolean; reason?: string }> {
  const staleCheck = await isWorktreeStale(repoPath, worktreePath)

  if (!staleCheck.isStale) {
    return { wasStale: false, pruned: false }
  }

  log.info(`[WorktreeUtils] Worktree ${worktreePath} is stale (${staleCheck.reason}), pruning`)

  const pruneResult = await pruneStaleWorktrees(repoPath)

  return {
    wasStale: true,
    pruned: pruneResult.pruned,
    reason: staleCheck.reason
  }
}

/**
 * Parses a git error message to extract worktree conflict information.
 *
 * Git errors for worktree conflicts look like:
 * - "fatal: 'branch' is already used by worktree at '/path'"
 * - "fatal: cannot checkout 'branch': checked out in worktree at '/path'"
 *
 * @param error - Error message or Error object
 * @returns Object with branch and worktreePath if it's a worktree conflict, null otherwise
 */
export function parseWorktreeConflictError(
  error: unknown
): { branch?: string; worktreePath: string } | null {
  const message = error instanceof Error ? error.message : String(error)

  // Match: "already used by worktree at '/path'"
  const alreadyUsedMatch = message.match(/already used by worktree at '([^']+)'/)
  if (alreadyUsedMatch) {
    return { worktreePath: alreadyUsedMatch[1] }
  }

  // Match: "checked out in worktree at '/path'"
  const checkedOutMatch = message.match(/checked out in worktree at '([^']+)'/)
  if (checkedOutMatch) {
    return { worktreePath: checkedOutMatch[1] }
  }

  return null
}

/**
 * Checks if an error is a worktree conflict error.
 *
 * @param error - Error to check
 * @returns true if this is a worktree conflict error
 */
export function isWorktreeConflictError(error: unknown): boolean {
  return parseWorktreeConflictError(error) !== null
}

/**
 * Options for retryWithPrune
 */
export type RetryWithPruneOptions = {
  /** Repository path for pruning */
  repoPath: string
  /** Function to determine if an error should trigger a retry (defaults to isWorktreeConflictError) */
  shouldRetry?: (error: unknown) => boolean
  /** Maximum number of retry attempts (defaults to 1) */
  maxRetries?: number
  /** Called when a retry is about to happen */
  onRetry?: (error: unknown, attempt: number) => void
}

/**
 * Executes an operation with automatic stale worktree recovery.
 *
 * If the operation fails with a worktree conflict error and the conflicting
 * worktree is stale, prunes the stale references and retries the operation.
 *
 * @param operation - Async function to execute
 * @param options - Retry options
 * @returns Result of the operation
 * @throws The original error if retries are exhausted or error is not recoverable
 */
export async function retryWithPrune<T>(
  operation: () => Promise<T>,
  options: RetryWithPruneOptions
): Promise<T> {
  const { repoPath, shouldRetry = isWorktreeConflictError, maxRetries = 1, onRetry } = options

  let lastError: unknown
  let attempts = 0

  while (attempts <= maxRetries) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      attempts++

      if (attempts > maxRetries || !shouldRetry(error)) {
        throw error
      }

      // Check if the conflicting worktree is actually stale
      const conflict = parseWorktreeConflictError(error)
      if (!conflict) {
        throw error
      }

      // Fetch worktrees once and reuse for stale check (avoids redundant git call)
      const git = getGitAdapter()
      const worktrees = await git.listWorktrees(repoPath, { skipDirtyCheck: true })

      const staleCheck = await isWorktreeStale(repoPath, conflict.worktreePath, { worktrees })
      if (!staleCheck.isStale) {
        // Worktree exists and is valid - don't retry
        log.debug(
          `[WorktreeUtils] Worktree ${conflict.worktreePath} is valid (not stale), not retrying`
        )
        throw error
      }

      // Worktree is stale - prune and retry
      onRetry?.(error, attempts)
      log.info(
        `[WorktreeUtils] Retrying operation after pruning stale worktree ${conflict.worktreePath}`
      )

      const pruneResult = await pruneStaleWorktrees(repoPath)
      if (!pruneResult.pruned) {
        // Couldn't prune - don't retry
        throw error
      }
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError
}
