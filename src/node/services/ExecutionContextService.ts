/**
 * ExecutionContextService - Manages execution contexts for Git operations
 *
 * When the active worktree has uncommitted changes, this service creates
 * a temporary worktree for Git operations. Operations execute transparently
 * while the user's uncommitted changes remain untouched.
 *
 * Key features:
 * - Persistent context storage (survives crashes)
 * - Mutex locking (prevents race conditions)
 * - Stale context detection with TTL
 * - Observability (metadata, timestamps, operation tracking)
 *
 * Strategy:
 * 1. If active worktree is clean -> use it (current behavior)
 * 2. If active worktree is dirty -> create a temporary worktree for execution
 *    - Temp worktree stored in .git/teapot-worktrees/ (relative to repo)
 *    - Context persisted to disk for crash recovery
 *    - Cleaned up after operation completes
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'

import { log } from '@shared/logger'

import { getGitAdapter } from '../adapters/git'
import { WorktreeOperation } from '../operations/WorktreeOperation'
import { configStore } from '../store'

/** Supported operations for tracking */
export type ExecutionOperation = 'rebase' | 'sync-trunk' | 'ship-it' | 'unknown'

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
 */
function cleanupOnExit(): void {
  for (const [repoPath, tempPath] of activeContexts) {
    try {
      const lockPath = path.join(repoPath, '.git', LOCK_FILE)
      fs.unlinkSync(lockPath)
    } catch {
      // Ignore - best effort
    }
    log.info(`[ExecutionContextService] Process exiting with active temp worktree: ${tempPath}`)
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
   * @param operation - Which operation is acquiring the context (for tracking)
   */
  static async acquire(
    repoPath: string,
    operation: ExecutionOperation = 'unknown'
  ): Promise<ExecutionContext> {
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
          log.debug(
            `[ExecutionContextService] Reusing persisted context from ${persistedContext.operation}`
          )
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

      // Check if active worktree is clean
      const activeStatus = await git.getWorkingTreeStatus(activeWorktreePath)
      const isActiveClean =
        activeStatus.staged.length === 0 &&
        activeStatus.modified.length === 0 &&
        activeStatus.deleted.length === 0 &&
        activeStatus.conflicted.length === 0

      if (isActiveClean) {
        log.debug('[ExecutionContextService] Active worktree is clean, using it for execution')
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

      // Active worktree is dirty - create a temporary worktree for full isolation
      log.info(
        `[ExecutionContextService] Active worktree is dirty, creating temporary worktree for ${operation}...`
      )
      const tempWorktree = await this.createTemporaryWorktree(repoPath)

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

    // Validate path looks like a temp worktree (safety check)
    if (!context.executionPath.includes('teapot-exec-')) {
      log.warn(
        `[ExecutionContextService] Refusing to release non-temp path: ${context.executionPath}`
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
      const teapotWorktreeDir = this.getWorktreeDir(repoPath)
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
    const lockPath = this.getLockFilePath(repoPath)
    let lockFileExists = false
    let lockFileAge: number | null = null
    try {
      const content = await fs.promises.readFile(lockPath, 'utf-8')
      lockFileExists = true
      const lockInfo = JSON.parse(content)
      lockFileAge = Date.now() - lockInfo.timestamp
    } catch {
      // Lock file doesn't exist
    }

    // Check temp worktree directory
    const tempWorktreeDir = this.getWorktreeDir(repoPath)
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
   * This eliminates the race condition in the previous check-then-set approach.
   *
   * CRITICAL: If any step fails, we must resolve operationComplete to prevent
   * subsequent operations from hanging forever waiting on a broken chain.
   */
  private static async acquireLock(repoPath: string): Promise<() => Promise<void>> {
    // Create the release mechanism for this operation
    let releaseFn: () => void
    const operationComplete = new Promise<void>((resolve) => {
      releaseFn = resolve
    })

    // Chain this operation after any existing operations
    // Use .catch to prevent unhandled rejection if previous chain failed
    const previousChain = lockQueues.get(repoPath) ?? Promise.resolve()
    const newChain = previousChain.catch(() => {}).then(() => operationComplete)
    lockQueues.set(repoPath, newChain)

    try {
      // Wait for all previous operations in the queue
      // If previous operation failed, we still proceed (the .catch above handles it)
      await previousChain.catch(() => {})

      // Now acquire file-based lock for multi-process safety
      await this.acquireFileLock(repoPath)

      return async () => {
        await this.releaseFileLock(repoPath)
        releaseFn!()

        // Clean up the queue entry if this was the last operation
        // (the chain we set is the current chain, meaning no one else queued after us)
        if (lockQueues.get(repoPath) === newChain) {
          lockQueues.delete(repoPath)
        }
      }
    } catch (error) {
      // If we fail to acquire the lock, we must still resolve operationComplete
      // to prevent subsequent operations from hanging forever
      releaseFn!()
      throw error
    }
  }

  /**
   * Acquire a file-based lock for multi-process safety.
   * Uses exclusive file creation with PID tracking.
   */
  private static async acquireFileLock(repoPath: string): Promise<void> {
    const lockPath = this.getLockFilePath(repoPath)

    // Try to acquire lock
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        // Try to create lock file exclusively
        const lockContent = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now()
        })
        await fs.promises.writeFile(lockPath, lockContent, { flag: 'wx' })
        return // Success
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock file exists, check if it's stale
          try {
            const content = await fs.promises.readFile(lockPath, 'utf-8')
            const lockInfo = JSON.parse(content)
            const age = Date.now() - lockInfo.timestamp

            // Check if the lock is stale (process died or took too long)
            if (age > LOCK_STALE_MS) {
              log.warn(
                `[ExecutionContextService] Breaking stale lock (${Math.round(age / 1000)}s old)`
              )
              await fs.promises.unlink(lockPath)
              continue // Retry acquisition
            }

            // Lock is held by another process, wait and retry
            await new Promise((r) => setTimeout(r, 100))
          } catch {
            // Lock file disappeared, retry
            continue
          }
        } else if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // .git directory doesn't exist, skip file locking
          return
        } else {
          throw err
        }
      }
    }

    throw new LockAcquisitionError(
      'Failed to acquire execution context lock after 10 attempts',
      repoPath,
      10
    )
  }

  private static async releaseFileLock(repoPath: string): Promise<void> {
    try {
      const lockPath = this.getLockFilePath(repoPath)
      await fs.promises.unlink(lockPath)
    } catch {
      // Ignore errors releasing lock
    }
  }

  private static getLockFilePath(repoPath: string): string {
    return path.join(repoPath, '.git', LOCK_FILE)
  }

  // ===========================================================================
  // Private: Persistent storage
  // ===========================================================================

  private static getContextFilePath(repoPath: string): string {
    return path.join(repoPath, '.git', CONTEXT_FILE)
  }

  private static getWorktreeDir(repoPath: string): string {
    return path.join(repoPath, '.git', WORKTREE_DIR)
  }

  private static async loadPersistedContext(repoPath: string): Promise<PersistedContext | null> {
    try {
      const filePath = this.getContextFilePath(repoPath)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const context = JSON.parse(content) as PersistedContext

      // Validate the temp worktree still exists
      if (context.isTemporary && !fs.existsSync(context.executionPath)) {
        log.warn(
          `[ExecutionContextService] Persisted context points to missing worktree: ${context.executionPath}`
        )
        await this.clearPersistedContext(repoPath)
        return null
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
    const filePath = this.getContextFilePath(repoPath)
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
      const filePath = this.getContextFilePath(repoPath)
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
   */
  private static async createTemporaryWorktree(repoPath: string): Promise<string> {
    const baseDir = this.getWorktreeDir(repoPath)
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
