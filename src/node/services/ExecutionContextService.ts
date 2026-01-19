/**
 * ExecutionContextService - Manages execution contexts for Git operations
 *
 * This service always creates a temporary worktree for Git operations (rebase, etc.)
 * to provide consistent UX and keep the user's working directory untouched.
 *
 * Key features:
 * - Always-temp-worktree: Operations always run in an isolated temp worktree
 * - Persistent context storage (survives crashes)
 * - Mutex locking (prevents race conditions)
 * - Stale context detection with TTL
 * - Observability (metadata, timestamps, operation tracking)
 *
 * Strategy:
 * 1. If rebase is in progress in active worktree -> use it (legacy/continue support)
 * 2. Otherwise -> create a temporary worktree for execution
 *    - Temp worktree stored in .git/teapot-worktrees/ (relative to repo)
 *    - Temp worktree always created at trunk with detached HEAD for isolation
 *    - HEAD is detached in active worktree if dirty OR if on same branch as target
 *      (dirty: to preserve uncommitted changes; on target: to release branch ref)
 *    - Context persisted to disk for crash recovery
 *    - Cleaned up after operation completes
 */

import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'

import { log } from '@shared/logger'

import { getGitAdapter } from '../adapters/git'
import { WorktreeOperation } from '../operations/WorktreeOperation'
import { resolveGitDir, resolveGitDirSync } from '../operations/WorktreeUtils'
import { configStore } from '../store'

/** Supported operations for tracking */
export type ExecutionOperation = 'rebase' | 'sync-trunk' | 'ship-it' | 'squash' | 'unknown'

/**
 * Custom error class for lock acquisition failures.
 */
export class LockAcquisitionError extends Error {
  constructor(
    message: string,
    public readonly repoPath: string,
    public readonly attempts: number
  ) {
    super(message)
    this.name = 'LockAcquisitionError'
  }
}

/**
 * Custom error class for worktree creation failures.
 */
export class WorktreeCreationError extends Error {
  constructor(
    message: string,
    public readonly repoPath: string,
    public readonly attempts: number,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'WorktreeCreationError'
  }
}

/**
 * Custom error class for context not found scenarios.
 */
export class ContextNotFoundError extends Error {
  constructor(
    message: string,
    public readonly repoPath: string
  ) {
    super(message)
    this.name = 'ContextNotFoundError'
  }
}

export type ExecutionContext = {
  /** Worktree path for Git operations */
  executionPath: string
  /** True if we created a temp worktree */
  isTemporary: boolean
  /** True if cleanup needed after operation */
  requiresCleanup: boolean
  /** When this context was created (for staleness detection) */
  createdAt: number
  /** Which operation created this context */
  operation: ExecutionOperation
  /** The main repository path (used for cleanup) */
  repoPath: string
}

/** Persisted context format for disk storage */
type PersistedContext = {
  executionPath: string
  isTemporary: boolean
  createdAt: number
  operation: ExecutionOperation
  repoPath: string
}

/**
 * Event emitter for context lifecycle events.
 *
 * Emitted events:
 * - 'acquired': (context: ExecutionContext, repoPath: string) - New context acquired
 * - 'released': (context: ExecutionContext, repoPath: string) - Context released/cleaned up
 * - 'stored': (context: ExecutionContext, repoPath: string) - Context stored for conflict resolution
 * - 'cleared': (repoPath: string) - Stored context cleared
 * - 'staleCleared': (repoPath: string, ageMs: number) - Stale context detected and cleared
 * - 'orphansCleanedUp': (repoPath: string, count: number) - Orphan cleanup completed
 */
const contextEvents = new EventEmitter()

/** Context file name stored in .git */
const CONTEXT_FILE = 'teapot-exec-context.json'

/** Temp worktree directory name in .git */
const WORKTREE_DIR = 'teapot-worktrees'

/** Lock file name in .git for multi-process locking */
const LOCK_FILE = 'teapot-exec.lock'

/** Default TTL for stale context detection (24 hours) */
const DEFAULT_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000

/** Configurable TTL - can be set via setContextTTL() */
let contextTtlMs = DEFAULT_CONTEXT_TTL_MS

/** Lock file staleness threshold (5 minutes) */
const LOCK_STALE_MS = 5 * 60 * 1000

/** Max retries for worktree creation */
const MAX_WORKTREE_RETRIES = 3

/** Retry delay for worktree creation (ms) */
const WORKTREE_RETRY_DELAY = 500

/**
 * Queue-based mutex for in-memory async locking.
 * Each repo gets its own promise chain ensuring serialized access.
 */
const lockQueues: Map<string, Promise<void>> = new Map()

/**
 * Track active temp worktrees for emergency cleanup on process exit.
 * Maps repoPath -> tempWorktreePath
 */
const activeContexts: Map<string, string> = new Map()

/** Whether exit handler has been registered */
let exitHandlerRegistered = false

/**
 * Perform synchronous cleanup of file locks before process exits.
 * Worktrees are left for orphan cleanup on next startup since git operations are async.
 *
 * Note: We cannot do async cleanup in exit handlers. The worktrees will be cleaned up
 * by cleanupOrphans() on next startup when the app initializes.
 */
function cleanupOnExit(): void {
  for (const [repoPath, tempPath] of activeContexts) {
    try {
      const gitDir = resolveGitDirSync(repoPath)
      const lockPath = path.join(gitDir, LOCK_FILE)
      fs.unlinkSync(lockPath)
    } catch {
      // Ignore - best effort
    }
    // Log so the next startup knows to clean up this orphan
    log.warn(
      `[ExecutionContextService] Process exiting with orphaned temp worktree (will be cleaned on next startup): ${tempPath}`,
      { repoPath, tempPath }
    )
  }
  if (activeContexts.size > 0) {
    log.info(
      `[ExecutionContextService] ${activeContexts.size} orphaned worktree(s) will be cleaned up on next app startup via cleanupOrphans()`
    )
  }
}

/**
 * Register exit handler for cleanup.
 * Uses 'exit' event instead of signal handlers to avoid interfering with Electron's shutdown.
 * Called automatically when first temp worktree is created.
 */
function registerExitHandler(): void {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true

  // Use 'exit' event for cleanup - this fires during process shutdown
  // and doesn't interfere with Electron's graceful shutdown.
  // Note: 'beforeExit' is not needed since it doesn't fire on explicit exit() or crashes.
  process.on('exit', cleanupOnExit)
}

export class ExecutionContextService {
  /**
   * Event emitter for observability.
   * Subscribe to events like 'acquired', 'released', 'stored', 'cleared'.
   */
  static get events(): EventEmitter {
    return contextEvents
  }

  /**
   * Get the current context TTL in milliseconds.
   */
  static getContextTTL(): number {
    return contextTtlMs
  }

  /**
   * Set the context TTL in milliseconds.
   * Contexts older than this are considered stale and will be cleared.
   * Default is 24 hours.
   */
  static setContextTTL(ttlMs: number): void {
    if (ttlMs <= 0) {
      throw new Error('TTL must be a positive number')
    }
    contextTtlMs = ttlMs
  }

  /**
   * Reset the context TTL to its default value (24 hours).
   */
  static resetContextTTL(): void {
    contextTtlMs = DEFAULT_CONTEXT_TTL_MS
  }

  /**
   * Acquire an execution context for Git operations.
   * Returns a clean worktree path that can be used for rebase/checkout operations.
   *
   * Features:
   * - Mutex locking to prevent race conditions
   * - Stale context detection (clears contexts older than 24h)
   * - Persistent storage for crash recovery
   *
   * @param repoPath - Path to the git repository
   * @param operationOrOptions - Either an operation string (legacy) or options object
   */
  static async acquire(
    repoPath: string,
    operationOrOptions:
      | ExecutionOperation
      | { operation?: ExecutionOperation; targetBranch?: string } = 'unknown'
  ): Promise<ExecutionContext> {
    // Support both legacy (string) and new (options object) calling conventions
    const options =
      typeof operationOrOptions === 'string'
        ? { operation: operationOrOptions }
        : operationOrOptions
    const operation = options.operation ?? 'unknown'
    const targetBranch = options.targetBranch

    log.debug('[ExecutionContextService] acquire() called', {
      repoPath,
      operation,
      targetBranch
    })
    // Validate repoPath early to fail fast with a clear error
    if (!repoPath || typeof repoPath !== 'string') {
      throw new Error('repoPath is required')
    }
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`)
    }
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      throw new Error(`Not a git repository: ${repoPath}`)
    }

    // Acquire mutex lock for this repo (returns release function)
    const releaseLock = await this.acquireLock(repoPath)

    try {
      // Check for persisted context from a previous conflict/crash
      const persistedContext = await this.loadPersistedContext(repoPath)
      if (persistedContext) {
        // Check if context is stale
        const age = Date.now() - persistedContext.createdAt
        if (age > contextTtlMs) {
          log.warn(
            `[ExecutionContextService] Clearing stale context (${Math.round(age / 1000 / 60 / 60)}h old)`
          )
          await this.clearPersistedContext(repoPath)
          contextEvents.emit('staleCleared', repoPath, age)
        } else {
          log.debug('[ExecutionContextService] acquire() reusing persisted context', {
            executionPath: persistedContext.executionPath,
            isTemporary: persistedContext.isTemporary,
            operation: persistedContext.operation,
            ageMs: Date.now() - persistedContext.createdAt
          })
          return {
            executionPath: persistedContext.executionPath,
            isTemporary: persistedContext.isTemporary,
            requiresCleanup: false, // Don't cleanup - we're continuing an existing session
            createdAt: persistedContext.createdAt,
            operation: persistedContext.operation,
            repoPath: persistedContext.repoPath
          }
        }
      }

      const git = getGitAdapter()
      const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath

      const activeStatus = await git.getWorkingTreeStatus(activeWorktreePath)

      // If a rebase is in progress in the active worktree, use it directly.
      // This handles the legacy case where a rebase was started in-place (before
      // always-temp-worktree), hit a conflict, and now the user is continuing.
      // Note: Rebases started via temp worktree have their context persisted and
      // are handled by the persistedContext check above.
      if (activeStatus.isRebasing) {
        log.debug('[ExecutionContextService] acquire() rebase in progress in active worktree', {
          activeWorktreePath,
          operation,
          isRebasing: activeStatus.isRebasing,
          conflictedCount: activeStatus.conflicted?.length ?? 0
        })
        const context: ExecutionContext = {
          executionPath: activeWorktreePath,
          isTemporary: false,
          requiresCleanup: false,
          createdAt: Date.now(),
          operation,
          repoPath
        }
        contextEvents.emit('acquired', context, repoPath)
        return context
      }

      // Always create a temporary worktree for new operations.
      // This provides consistent UX and keeps the user's working directory untouched.
      const isActiveClean =
        activeStatus.staged.length === 0 &&
        activeStatus.modified.length === 0 &&
        activeStatus.deleted.length === 0 &&
        activeStatus.conflicted.length === 0

      const currentBranch = await git.currentBranch(activeWorktreePath)

      // Determine if we need to detach HEAD to release the branch ref:
      // 1. Active worktree is dirty - must detach to preserve uncommitted changes
      // 2. Active worktree is on the same branch as target - must detach to allow
      //    the temp worktree to check out that branch
      const isOnTargetBranch = targetBranch && currentBranch === targetBranch
      const needsDetach = !isActiveClean || isOnTargetBranch

      log.info(
        `[ExecutionContextService] Creating temporary worktree for ${operation}` +
          ` (active: ${isActiveClean ? 'clean' : 'dirty'}, branch: ${currentBranch ?? 'detached'}` +
          `${targetBranch ? `, target: ${targetBranch}` : ''}, needsDetach: ${needsDetach})...`
      )

      // Detach HEAD if needed to release the branch ref
      let originalBranch: string | null = null
      if (needsDetach && currentBranch) {
        originalBranch = currentBranch

        const detachResult = await WorktreeOperation.detachHead(activeWorktreePath)
        if (!detachResult.success) {
          throw new WorktreeCreationError(
            `Failed to detach HEAD in active worktree: ${detachResult.error}`,
            repoPath,
            0
          )
        }
      }

      // Create temp worktree at detached HEAD
      let tempWorktree: string
      try {
        tempWorktree = await this.createTemporaryWorktree(repoPath)
      } catch (error) {
        // Rollback: restore original branch in active worktree (only if we detached)
        if (originalBranch) {
          log.warn(
            `[ExecutionContextService] Temp worktree creation failed, rolling back HEAD detach`,
            { repoPath, originalBranch, error }
          )
          const rollbackResult = await WorktreeOperation.checkoutBranchInWorktree(
            activeWorktreePath,
            originalBranch
          )
          if (!rollbackResult.success) {
            log.error(
              `[ExecutionContextService] CRITICAL: Failed to rollback HEAD detach after temp worktree creation failure`,
              {
                repoPath,
                activeWorktreePath,
                originalBranch,
                rollbackError: rollbackResult.error,
                originalError: error instanceof Error ? error.message : String(error)
              }
            )
          } else {
            log.info(
              `[ExecutionContextService] Successfully rolled back to branch: ${originalBranch}`
            )
          }
        }
        throw error
      }

      // Track for emergency cleanup and register exit handler
      activeContexts.set(repoPath, tempWorktree)
      registerExitHandler()

      const context: ExecutionContext = {
        executionPath: tempWorktree,
        isTemporary: true,
        requiresCleanup: true,
        createdAt: Date.now(),
        operation,
        repoPath
      }
      log.debug('[ExecutionContextService] acquire() returning new temp worktree context', {
        executionPath: context.executionPath,
        isTemporary: context.isTemporary,
        operation: context.operation
      })
      contextEvents.emit('acquired', context, repoPath)
      return context
    } finally {
      await releaseLock()
    }
  }

  /**
   * Store the execution context for later use (e.g., during conflict resolution).
   * Persists to disk for crash recovery.
   */
  static async storeContext(repoPath: string, context: ExecutionContext): Promise<void> {
    log.debug('[ExecutionContextService] storeContext() called', {
      repoPath,
      executionPath: context.executionPath,
      isTemporary: context.isTemporary,
      operation: context.operation
    })

    if (context.isTemporary) {
      await this.persistContext(repoPath, {
        executionPath: context.executionPath,
        isTemporary: context.isTemporary,
        createdAt: context.createdAt,
        operation: context.operation,
        repoPath: context.repoPath
      })
      log.debug(
        `[ExecutionContextService] Stored context for ${repoPath}: ${context.executionPath} (${context.operation})`
      )
      contextEvents.emit('stored', context, repoPath)
    }
  }

  /**
   * Clear the stored context and release the temp worktree.
   * Call this when a rebase completes or is aborted.
   */
  static async clearStoredContext(repoPath: string): Promise<void> {
    log.debug('[ExecutionContextService] clearStoredContext() called', { repoPath })
    // Acquire lock to prevent race conditions when multiple processes
    // try to clear the context simultaneously
    const releaseLock = await this.acquireLock(repoPath)

    try {
      const persistedContext = await this.loadPersistedContext(repoPath)
      if (persistedContext) {
        await this.clearPersistedContext(repoPath)
        contextEvents.emit('cleared', repoPath)
        if (persistedContext.isTemporary) {
          await this.release({
            executionPath: persistedContext.executionPath,
            isTemporary: true,
            requiresCleanup: true,
            createdAt: persistedContext.createdAt,
            operation: persistedContext.operation,
            repoPath: persistedContext.repoPath
          })
        }
      }
    } finally {
      await releaseLock()
    }
  }

  /**
   * Check if there's a stored context for a repo (active conflict session).
   */
  static async hasStoredContext(repoPath: string): Promise<boolean> {
    const context = await this.loadPersistedContext(repoPath)
    return context !== null
  }

  /**
   * Get the stored execution path for a repo, if any.
   */
  static async getStoredExecutionPath(repoPath: string): Promise<string | undefined> {
    const context = await this.loadPersistedContext(repoPath)
    return context?.executionPath
  }

  /**
   * Get full stored context info for observability.
   */
  static async getStoredContext(repoPath: string): Promise<PersistedContext | null> {
    return this.loadPersistedContext(repoPath)
  }

  /**
   * Get the stored context, throwing if not found.
   * Use this when a context is expected to exist.
   */
  static async getStoredContextOrThrow(repoPath: string): Promise<PersistedContext> {
    const context = await this.loadPersistedContext(repoPath)
    if (!context) {
      throw new ContextNotFoundError(`No stored context found for repository`, repoPath)
    }
    return context
  }

  /**
   * Release an execution context, cleaning up temporary worktrees.
   */
  static async release(context: ExecutionContext): Promise<void> {
    if (!context.requiresCleanup || !context.isTemporary) {
      return
    }

    // Validate context before attempting cleanup
    if (!context.executionPath || typeof context.executionPath !== 'string') {
      log.warn('[ExecutionContextService] Invalid context: missing executionPath')
      return
    }

    // Validate path is within the teapot-worktrees directory (safety check)
    // This prevents accidentally deleting arbitrary directories
    const expectedWorktreeDir = await this.getWorktreeDir(context.repoPath)
    const worktreeName = path.basename(context.executionPath)
    const parentDir = path.dirname(context.executionPath)

    // Resolve symlinks for comparison (e.g., /var -> /private/var on macOS)
    let resolvedParentDir: string
    let resolvedExpectedDir: string
    try {
      resolvedParentDir = fs.realpathSync(parentDir)
      resolvedExpectedDir = fs.realpathSync(expectedWorktreeDir)
    } catch {
      // If we can't resolve paths, use normalized paths as fallback
      resolvedParentDir = path.normalize(parentDir)
      resolvedExpectedDir = path.normalize(expectedWorktreeDir)
    }

    if (resolvedParentDir !== resolvedExpectedDir || !worktreeName.startsWith('teapot-exec-')) {
      log.warn(
        `[ExecutionContextService] Refusing to release path outside temp worktree directory: ${context.executionPath}`,
        { expectedWorktreeDir, resolvedParentDir, resolvedExpectedDir, worktreeName }
      )
      return
    }

    // Remove from active contexts tracking
    activeContexts.delete(context.repoPath)

    try {
      await WorktreeOperation.remove(context.repoPath, context.executionPath, true)
      log.info(`[ExecutionContextService] Removed temporary worktree: ${context.executionPath}`)
      contextEvents.emit('released', context, context.repoPath)
    } catch (error) {
      // Log warning but don't fail - cleanup is best-effort
      log.warn(`[ExecutionContextService] Failed to remove temporary worktree:`, error)
    }
  }

  /**
   * Clean up orphaned temporary worktrees from previous runs.
   * Call this on startup to prevent accumulation of temp directories.
   */
  static async cleanupOrphans(repoPath: string): Promise<void> {
    // Acquire lock to prevent race conditions when multiple processes
    // try to cleanup simultaneously
    const releaseLock = await this.acquireLock(repoPath)

    try {
      const teapotWorktreeDir = await this.getWorktreeDir(repoPath)
      if (!fs.existsSync(teapotWorktreeDir)) {
        return
      }

      const entries = await fs.promises.readdir(teapotWorktreeDir)
      const git = getGitAdapter()
      const worktrees = await git.listWorktrees(repoPath)
      const worktreePaths = new Set(worktrees.map((wt) => wt.path))

      let orphansRemoved = 0
      for (const entry of entries) {
        if (!entry.startsWith('teapot-exec-')) {
          continue
        }

        const fullPath = path.join(teapotWorktreeDir, entry)
        const resolvedPath = await fs.promises.realpath(fullPath).catch(() => fullPath)

        // If this path is not a registered worktree, remove it
        if (!worktreePaths.has(resolvedPath)) {
          try {
            // Try to remove via git first (in case it's still registered but with different path)
            await WorktreeOperation.remove(repoPath, fullPath, true)
          } catch {
            // Fall back to direct removal
            await fs.promises.rm(fullPath, { recursive: true, force: true })
          }
          orphansRemoved++
          log.info(`[ExecutionContextService] Cleaned up orphaned temp worktree: ${fullPath}`)
        }
      }

      // Also check for stale context file
      const context = await this.loadPersistedContext(repoPath)
      if (context) {
        const age = Date.now() - context.createdAt
        if (age > contextTtlMs) {
          log.info(
            `[ExecutionContextService] Clearing stale context file (${Math.round(age / 1000 / 60 / 60)}h old)`
          )
          await this.clearPersistedContext(repoPath)
          contextEvents.emit('staleCleared', repoPath, age)
        }
      }

      if (orphansRemoved > 0) {
        contextEvents.emit('orphansCleanedUp', repoPath, orphansRemoved)
      }
    } catch (error) {
      // Log warning but don't fail - cleanup is best-effort
      log.warn(`[ExecutionContextService] Failed to cleanup orphaned worktrees:`, error)
    } finally {
      await releaseLock()
    }
  }

  /**
   * Check if the active worktree is dirty.
   */
  static async isActiveWorktreeDirty(repoPath: string): Promise<boolean> {
    const git = getGitAdapter()
    const activeWorktreePath = configStore.getActiveWorktree(repoPath) ?? repoPath
    const status = await git.getWorkingTreeStatus(activeWorktreePath)

    return (
      status.staged.length > 0 ||
      status.modified.length > 0 ||
      status.deleted.length > 0 ||
      status.conflicted.length > 0
    )
  }

  /**
   * Health check for diagnostics and monitoring.
   * Returns the current state of the execution context service for a repo.
   */
  static async healthCheck(repoPath: string): Promise<{
    hasStoredContext: boolean
    storedContext: PersistedContext | null
    storedContextAge: number | null
    isStoredContextStale: boolean
    activeContextInMemory: string | null
    lockFileExists: boolean
    lockFileAge: number | null
    tempWorktreeDir: string
    tempWorktreeDirExists: boolean
    tempWorktreeCount: number
    ttlMs: number
  }> {
    const storedContext = await this.loadPersistedContext(repoPath)
    const storedContextAge = storedContext ? Date.now() - storedContext.createdAt : null

    // Check lock file
    const lockPath = await this.getLockFilePath(repoPath)
    let lockFileExists = false
    let lockFileAge: number | null = null
    try {
      const content = await fs.promises.readFile(lockPath, 'utf-8')
      lockFileExists = true
      try {
        const lockInfo = JSON.parse(content)
        lockFileAge = Date.now() - lockInfo.timestamp
      } catch {
        // Corrupted lock file - age unknown
        lockFileAge = null
      }
    } catch {
      // Lock file doesn't exist
    }

    // Check temp worktree directory
    const tempWorktreeDir = await this.getWorktreeDir(repoPath)
    let tempWorktreeDirExists = false
    let tempWorktreeCount = 0
    try {
      const entries = await fs.promises.readdir(tempWorktreeDir)
      tempWorktreeDirExists = true
      tempWorktreeCount = entries.filter((e) => e.startsWith('teapot-exec-')).length
    } catch {
      // Dir doesn't exist
    }

    return {
      hasStoredContext: storedContext !== null,
      storedContext,
      storedContextAge,
      isStoredContextStale: storedContextAge !== null && storedContextAge > contextTtlMs,
      activeContextInMemory: activeContexts.get(repoPath) ?? null,
      lockFileExists,
      lockFileAge,
      tempWorktreeDir,
      tempWorktreeDirExists,
      tempWorktreeCount,
      ttlMs: contextTtlMs
    }
  }

  // ===========================================================================
  // Private: Mutex locking (in-memory queue-based + file-based for multi-process)
  // ===========================================================================

  /**
   * Acquire both in-memory and file-based locks.
   * Returns a release function that must be called when done.
   *
   * Queue-based mutex: Each repo has a promise chain. New callers add their
   * operation to the chain and wait for all previous operations to complete.
   *
   * The .catch(() => {}) calls prevent chain breakage if a previous operation
   * throws - without this, a rejection would propagate and hang all subsequent
   * operations waiting on the chain.
   */
  private static async acquireLock(repoPath: string): Promise<() => Promise<void>> {
    // Create the release mechanism for this operation
    let releaseFn: () => void
    const operationComplete = new Promise<void>((resolve) => {
      releaseFn = resolve
    })

    // Chain this operation after any existing operations
    // The .catch() prevents a rejected promise from breaking the chain
    const previousChain = lockQueues.get(repoPath) ?? Promise.resolve()
    const newChain = previousChain.catch(() => {}).then(() => operationComplete)
    lockQueues.set(repoPath, newChain)

    // Wait for all previous operations in the queue (ignore their errors)
    await previousChain.catch(() => {})

    // Now acquire file-based lock for multi-process safety
    try {
      await this.acquireFileLock(repoPath)
    } catch (error) {
      // Release our spot in the queue before throwing
      releaseFn!()
      throw error
    }

    return async () => {
      await this.releaseFileLock(repoPath)
      releaseFn!()

      // Clean up the queue entry if this was the last operation
      if (lockQueues.get(repoPath) === newChain) {
        lockQueues.delete(repoPath)
      }
    }
  }

  /**
   * Acquire a file-based lock for multi-process safety.
   *
   * Uses atomic file creation with a unique lock ID to prevent TOCTOU race conditions:
   * 1. Generate a unique lock ID before attempting acquisition
   * 2. Try to create lock file atomically with O_EXCL flag
   * 3. If successful, verify we actually own the lock by reading it back
   * 4. If verification fails (another process won the race), retry
   *
   * This approach eliminates the race condition where two processes could both
   * delete a stale lock and then both succeed in creating a new one.
   */
  private static async acquireFileLock(repoPath: string): Promise<void> {
    const lockPath = await this.getLockFilePath(repoPath)
    const lockId = crypto.randomUUID()
    const maxAttempts = 10
    const baseRetryDelayMs = 100

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Try to create lock file atomically with exclusive flag
        const lockContent = JSON.stringify({
          pid: process.pid,
          lockId,
          timestamp: Date.now()
        })
        await fs.promises.writeFile(lockPath, lockContent, { flag: 'wx' })

        // Verify we actually own the lock (double-check pattern)
        // This catches the race where another process deleted a stale lock
        // and created their own between our unlink and writeFile
        try {
          const verification = await fs.promises.readFile(lockPath, 'utf-8')
          const verifyInfo = JSON.parse(verification)
          if (verifyInfo.lockId !== lockId) {
            // Another process won the race - their lock is now active
            log.debug('[ExecutionContextService] Lost lock race, retrying', {
              repoPath,
              attempt,
              ourLockId: lockId.slice(0, 8),
              theirLockId: verifyInfo.lockId?.slice(0, 8)
            })
            // Add jitter to prevent thundering herd
            const jitter = Math.random() * baseRetryDelayMs
            await new Promise((r) => setTimeout(r, baseRetryDelayMs + jitter))
            continue
          }
        } catch {
          // Lock file disappeared during verification - retry
          continue
        }

        return // Successfully acquired and verified lock
      } catch (err) {
        const errCode = (err as NodeJS.ErrnoException).code

        if (errCode === 'EEXIST') {
          // Lock file exists - check if we should break it
          const shouldBreak = await this.checkAndBreakStaleLock(lockPath, repoPath)
          if (shouldBreak) {
            // Stale lock was broken, retry immediately
            continue
          }
          // Lock is held by active process - wait with jitter and retry
          const jitter = Math.random() * baseRetryDelayMs
          await new Promise((r) => setTimeout(r, baseRetryDelayMs * (attempt + 1) + jitter))
        } else if (errCode === 'ENOENT' || errCode === 'ENOTDIR') {
          // .git directory doesn't exist or isn't a directory (worktree .git is a file)
          // Skip file locking - the caller will handle any issues
          log.debug('[ExecutionContextService] acquireFileLock() skipping - .git not a directory', {
            repoPath,
            lockPath,
            errCode
          })
          return
        } else {
          // Unexpected error - log and throw
          log.error('[ExecutionContextService] acquireFileLock() unexpected error', {
            repoPath,
            lockPath,
            errCode,
            message: (err as Error).message
          })
          throw err
        }
      }
    }

    throw new LockAcquisitionError(
      `Failed to acquire execution context lock after ${maxAttempts} attempts`,
      repoPath,
      maxAttempts
    )
  }

  /**
   * Check if an existing lock is stale and break it if so.
   * Returns true if the lock was broken (caller should retry acquisition).
   * Returns false if the lock is held by an active process.
   *
   * A lock is considered stale if:
   * - The lock file is corrupted (cannot be parsed)
   * - The lock is older than LOCK_STALE_MS
   * - The process that created the lock no longer exists (PID check)
   */
  private static async checkAndBreakStaleLock(
    lockPath: string,
    repoPath: string
  ): Promise<boolean> {
    try {
      const content = await fs.promises.readFile(lockPath, 'utf-8')
      let lockInfo: { pid: number; lockId?: string; timestamp: number }

      try {
        lockInfo = JSON.parse(content)
      } catch {
        // Corrupted lock file - break it
        log.warn('[ExecutionContextService] Breaking corrupted lock file', {
          repoPath,
          content: content.slice(0, 100)
        })
        await this.safeUnlink(lockPath)
        return true
      }

      const age = Date.now() - lockInfo.timestamp

      // Check if lock is stale by age
      if (age > LOCK_STALE_MS) {
        log.warn(`[ExecutionContextService] Breaking stale lock (${Math.round(age / 1000)}s old)`, {
          repoPath,
          pid: lockInfo.pid,
          lockId: lockInfo.lockId?.slice(0, 8)
        })
        await this.safeUnlink(lockPath)
        return true
      }

      // Check if holding process is still alive (skip if same PID - that's us)
      if (lockInfo.pid !== process.pid) {
        try {
          // Signal 0 checks if process exists without killing it
          process.kill(lockInfo.pid, 0)
        } catch {
          // Process doesn't exist - break the orphan lock
          log.warn(
            `[ExecutionContextService] Breaking orphan lock (PID ${lockInfo.pid} no longer exists)`,
            { repoPath, lockId: lockInfo.lockId?.slice(0, 8) }
          )
          await this.safeUnlink(lockPath)
          return true
        }
      }

      // Lock is held by an active process
      return false
    } catch (err) {
      // Lock file disappeared while checking - treat as broken
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return true
      }
      throw err
    }
  }

  /**
   * Safely unlink a file, ignoring ENOENT errors.
   * Used for lock cleanup where the file may have been deleted by another process.
   */
  private static async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
      // File already deleted - that's fine
    }
  }

  private static async releaseFileLock(repoPath: string): Promise<void> {
    try {
      const lockPath = await this.getLockFilePath(repoPath)
      await fs.promises.unlink(lockPath)
    } catch {
      // Ignore errors releasing lock
    }
  }

  private static async getLockFilePath(repoPath: string): Promise<string> {
    const gitDir = await resolveGitDir(repoPath)
    return path.join(gitDir, LOCK_FILE)
  }

  // ===========================================================================
  // Private: Persistent storage
  // ===========================================================================

  private static async getContextFilePath(repoPath: string): Promise<string> {
    const gitDir = await resolveGitDir(repoPath)
    return path.join(gitDir, CONTEXT_FILE)
  }

  private static async getWorktreeDir(repoPath: string): Promise<string> {
    const gitDir = await resolveGitDir(repoPath)
    return path.join(gitDir, WORKTREE_DIR)
  }

  /**
   * Validates that a parsed object has the required PersistedContext shape.
   * Returns null if validation fails, with structured logging for debugging.
   */
  private static validatePersistedContext(
    parsed: unknown,
    repoPath: string
  ): PersistedContext | null {
    if (!parsed || typeof parsed !== 'object') {
      log.warn('[ExecutionContextService] Invalid context: not an object', { repoPath })
      return null
    }

    const obj = parsed as Record<string, unknown>

    // Validate required string fields
    if (typeof obj.executionPath !== 'string' || !obj.executionPath) {
      log.warn('[ExecutionContextService] Invalid context: missing or invalid executionPath', {
        repoPath,
        executionPath: obj.executionPath
      })
      return null
    }

    if (typeof obj.repoPath !== 'string' || !obj.repoPath) {
      log.warn('[ExecutionContextService] Invalid context: missing or invalid repoPath', {
        repoPath,
        contextRepoPath: obj.repoPath
      })
      return null
    }

    // Validate required boolean field
    if (typeof obj.isTemporary !== 'boolean') {
      log.warn('[ExecutionContextService] Invalid context: missing or invalid isTemporary', {
        repoPath,
        isTemporary: obj.isTemporary
      })
      return null
    }

    // Validate required number field
    if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) {
      log.warn('[ExecutionContextService] Invalid context: missing or invalid createdAt', {
        repoPath,
        createdAt: obj.createdAt
      })
      return null
    }

    // Validate operation field (optional but should be valid type if present)
    const validOperations = ['rebase', 'sync-trunk', 'ship-it', 'unknown']
    if (obj.operation !== undefined && !validOperations.includes(obj.operation as string)) {
      log.warn('[ExecutionContextService] Invalid context: invalid operation', {
        repoPath,
        operation: obj.operation
      })
      return null
    }

    return {
      executionPath: obj.executionPath,
      repoPath: obj.repoPath,
      isTemporary: obj.isTemporary,
      createdAt: obj.createdAt,
      operation: (obj.operation as PersistedContext['operation']) ?? 'unknown'
    }
  }

  private static async loadPersistedContext(repoPath: string): Promise<PersistedContext | null> {
    try {
      const filePath = await this.getContextFilePath(repoPath)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const parsed: unknown = JSON.parse(content)

      // Validate schema before using
      const context = this.validatePersistedContext(parsed, repoPath)
      if (!context) {
        log.warn('[ExecutionContextService] Clearing invalid context file', { repoPath })
        await this.clearPersistedContext(repoPath)
        return null
      }

      // Validate the temp worktree still exists
      if (context.isTemporary && !fs.existsSync(context.executionPath)) {
        log.warn(
          `[ExecutionContextService] Persisted context points to missing worktree: ${context.executionPath}`
        )
        await this.clearPersistedContext(repoPath)
        return null
      }

      // Validate the temp worktree is registered with git
      if (context.isTemporary) {
        const git = getGitAdapter()
        const worktrees = await git.listWorktrees(repoPath)
        const resolvedPath = await fs.promises
          .realpath(context.executionPath)
          .catch(() => context.executionPath)
        const isRegistered = worktrees.some((wt) => wt.path === resolvedPath)

        if (!isRegistered) {
          log.warn(
            `[ExecutionContextService] Persisted context points to unregistered worktree: ${context.executionPath}`,
            { repoPath, registeredWorktrees: worktrees.map((wt) => wt.path) }
          )
          await this.clearPersistedContext(repoPath)
          return null
        }
      }

      return context
    } catch {
      return null
    }
  }

  /**
   * Persist context using atomic write (temp file + rename).
   * This prevents corruption if the process crashes mid-write.
   */
  private static async persistContext(repoPath: string, context: PersistedContext): Promise<void> {
    const filePath = await this.getContextFilePath(repoPath)
    const tempPath = `${filePath}.${process.pid}.tmp`

    try {
      // Write to temp file first
      await fs.promises.writeFile(tempPath, JSON.stringify(context, null, 2))
      // Atomic rename to final path
      await fs.promises.rename(tempPath, filePath)
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.promises.unlink(tempPath)
      } catch {
        // Ignore cleanup errors
      }
      throw err
    }
  }

  private static async clearPersistedContext(repoPath: string): Promise<void> {
    try {
      const filePath = await this.getContextFilePath(repoPath)
      await fs.promises.unlink(filePath)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  // ===========================================================================
  // Private: Worktree creation
  // ===========================================================================

  /**
   * Create a temporary worktree with retry logic.
   * Retries handle transient failures like locked index files.
   *
   * @param repoPath - Path to the git repository
   */
  private static async createTemporaryWorktree(repoPath: string): Promise<string> {
    const baseDir = await this.getWorktreeDir(repoPath)
    let lastError: Error | null = null
    let finalAttempt = 0

    for (let attempt = 1; attempt <= MAX_WORKTREE_RETRIES; attempt++) {
      finalAttempt = attempt
      const result = await WorktreeOperation.createTemporary(repoPath, baseDir)

      if (result.success && result.worktreePath) {
        return result.worktreePath
      }

      lastError = new Error(result.error ?? 'Failed to create temporary worktree')

      // Only retry on transient errors
      const isTransient =
        result.error?.includes('index.lock') ||
        result.error?.includes('cannot lock') ||
        result.error?.includes('Unable to create')

      if (!isTransient || attempt === MAX_WORKTREE_RETRIES) {
        break
      }

      log.warn(
        `[ExecutionContextService] Worktree creation failed (attempt ${attempt}/${MAX_WORKTREE_RETRIES}): ${result.error}`
      )
      await new Promise((r) => setTimeout(r, WORKTREE_RETRY_DELAY * attempt))
    }

    throw new WorktreeCreationError(
      lastError?.message ?? 'Failed to create temporary worktree',
      repoPath,
      finalAttempt,
      lastError ?? undefined
    )
  }
}
