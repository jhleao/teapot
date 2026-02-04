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
 * - Instance-based architecture for testability
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

import { getGitAdapter, type GitAdapter } from '../adapters/git'
import { WorktreeOperation } from '../operations/WorktreeOperation'
import { resolveGitDir, resolveGitDirSync } from '../operations/WorktreeUtils'
import { configStore, type ConfigStore } from '../store'

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

// =============================================================================
// Dependencies Interface (for testability)
// =============================================================================

/**
 * Clock abstraction for time-based operations.
 * Enables deterministic testing of staleness detection and TTL logic.
 */
export interface Clock {
  now(): number
}

/**
 * Dependencies that can be injected for testing.
 * Only includes dependencies that need mocking - Node.js built-ins like fs/path
 * don't need injection since tests use real temp directories.
 */
export interface ExecutionContextDependencies {
  /** Clock for time-based operations (staleness detection, TTL) */
  clock: Clock
  /** Git adapter for repository operations */
  gitAdapter: GitAdapter
  /** Config store for worktree settings */
  configStore: Pick<ConfigStore, 'getActiveWorktree' | 'getUseParallelWorktree'>
  /** Worktree operations */
  worktreeOps: typeof WorktreeOperation
}

/**
 * Create default dependencies using production singletons.
 */
function createDefaultDependencies(): ExecutionContextDependencies {
  return {
    clock: { now: () => Date.now() },
    gitAdapter: getGitAdapter(),
    configStore,
    worktreeOps: WorktreeOperation
  }
}

// =============================================================================
// Instance-based Service Implementation
// =============================================================================

/** Context file name stored in .git */
const CONTEXT_FILE = 'teapot-exec-context.json'

/** Temp worktree directory name in .git */
const WORKTREE_DIR = 'teapot-worktrees'

/** Lock file name in .git for multi-process locking */
const LOCK_FILE = 'teapot-exec.lock'

/** Default TTL for stale context detection (24 hours) */
const DEFAULT_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000

/** Lock file staleness threshold (5 minutes) */
const LOCK_STALE_MS = 5 * 60 * 1000

/** Max retries for worktree creation */
const MAX_WORKTREE_RETRIES = 3

/** Retry delay for worktree creation (ms) */
const WORKTREE_RETRY_DELAY = 500

/**
 * Service diagnostics for testing and debugging.
 */
export interface ServiceDiagnostics {
  lockQueueCount: number
  activeContextCount: number
  ttlMs: number
  hasExitHandler: boolean
}

/**
 * Instance-based ExecutionContext service.
 * All state is encapsulated as instance properties for test isolation.
 *
 * Use `ExecutionContextService.createInstance()` to create isolated instances for testing.
 * Production code uses the static facade which delegates to a shared default instance.
 */
export class ExecutionContextServiceInstance {
  /**
   * Event emitter for context lifecycle events.
   */
  readonly events = new EventEmitter()

  /** Configurable TTL - contexts older than this are stale */
  private contextTtlMs = DEFAULT_CONTEXT_TTL_MS

  /**
   * Queue-based mutex for in-memory async locking.
   * Each repo gets its own promise chain ensuring serialized access.
   */
  private readonly lockQueues = new Map<string, Promise<void>>()

  /**
   * Track active temp worktrees for emergency cleanup on process exit.
   * Maps repoPath -> tempWorktreePath
   */
  private readonly activeContexts = new Map<string, string>()

  /** Whether exit handler has been registered */
  private exitHandlerRegistered = false

  /** Bound exit handler for proper removal */
  private readonly boundExitHandler: () => void

  constructor(private readonly deps: ExecutionContextDependencies) {
    this.boundExitHandler = this.cleanupOnExit.bind(this)
  }

  /**
   * Reset all instance state for testing.
   * Clears all in-memory state and resets TTL to default.
   */
  reset(): void {
    this.lockQueues.clear()
    this.activeContexts.clear()
    this.contextTtlMs = DEFAULT_CONTEXT_TTL_MS
    this.events.removeAllListeners()

    // Unregister exit handler if registered
    if (this.exitHandlerRegistered) {
      process.removeListener('exit', this.boundExitHandler)
      this.exitHandlerRegistered = false
    }
  }

  /**
   * Get diagnostics for testing and debugging.
   */
  getDiagnostics(): ServiceDiagnostics {
    return {
      lockQueueCount: this.lockQueues.size,
      activeContextCount: this.activeContexts.size,
      ttlMs: this.contextTtlMs,
      hasExitHandler: this.exitHandlerRegistered
    }
  }

  /**
   * Get the current context TTL in milliseconds.
   */
  getContextTTL(): number {
    return this.contextTtlMs
  }

  /**
   * Set the context TTL in milliseconds.
   * Contexts older than this are considered stale and will be cleared.
   * Default is 24 hours.
   */
  setContextTTL(ttlMs: number): void {
    if (ttlMs <= 0) {
      throw new Error('TTL must be a positive number')
    }
    this.contextTtlMs = ttlMs
  }

  /**
   * Reset the context TTL to its default value (24 hours).
   */
  resetContextTTL(): void {
    this.contextTtlMs = DEFAULT_CONTEXT_TTL_MS
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
  async acquire(
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
        const age = this.deps.clock.now() - persistedContext.createdAt
        if (age > this.contextTtlMs) {
          log.warn(
            `[ExecutionContextService] Clearing stale context (${Math.round(age / 1000 / 60 / 60)}h old)`
          )
          await this.clearPersistedContext(repoPath)
          this.events.emit('staleCleared', repoPath, age)
        } else {
          log.debug('[ExecutionContextService] acquire() reusing persisted context', {
            executionPath: persistedContext.executionPath,
            isTemporary: persistedContext.isTemporary,
            operation: persistedContext.operation,
            ageMs: this.deps.clock.now() - persistedContext.createdAt
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

      const git = this.deps.gitAdapter
      const activeWorktreePath = this.deps.configStore.getActiveWorktree(repoPath) ?? repoPath

      const activeStatus = await git.getWorkingTreeStatus(activeWorktreePath)

      // Use active worktree directly if:
      // 1. Rebase already in progress (legacy/continue support), OR
      // 2. Parallel worktree mode is disabled (feature flag)
      if (activeStatus.isRebasing || !this.deps.configStore.getUseParallelWorktree()) {
        log.debug('[ExecutionContextService] Using active worktree', {
          reason: activeStatus.isRebasing ? 'rebase-in-progress' : 'parallel-disabled',
          activeWorktreePath,
          operation
        })
        const context: ExecutionContext = {
          executionPath: activeWorktreePath,
          isTemporary: false,
          requiresCleanup: false,
          createdAt: this.deps.clock.now(),
          operation,
          repoPath
        }
        this.events.emit('acquired', context, repoPath)
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

        const detachResult = await this.deps.worktreeOps.detachHead(activeWorktreePath)
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
          const rollbackResult = await this.deps.worktreeOps.checkoutBranchInWorktree(
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
      this.activeContexts.set(repoPath, tempWorktree)
      this.registerExitHandler()

      const context: ExecutionContext = {
        executionPath: tempWorktree,
        isTemporary: true,
        requiresCleanup: true,
        createdAt: this.deps.clock.now(),
        operation,
        repoPath
      }
      log.debug('[ExecutionContextService] acquire() returning new temp worktree context', {
        executionPath: context.executionPath,
        isTemporary: context.isTemporary,
        operation: context.operation
      })
      this.events.emit('acquired', context, repoPath)
      return context
    } finally {
      await releaseLock()
    }
  }

  /**
   * Store the execution context for later use (e.g., during conflict resolution).
   * Persists to disk for crash recovery.
   */
  async storeContext(repoPath: string, context: ExecutionContext): Promise<void> {
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
      this.events.emit('stored', context, repoPath)
    }
  }

  /**
   * Clear the stored context and release the temp worktree.
   * Call this when a rebase completes or is aborted.
   */
  async clearStoredContext(repoPath: string): Promise<void> {
    log.debug('[ExecutionContextService] clearStoredContext() called', { repoPath })
    // Acquire lock to prevent race conditions when multiple processes
    // try to clear the context simultaneously
    const releaseLock = await this.acquireLock(repoPath)

    try {
      const persistedContext = await this.loadPersistedContext(repoPath)
      if (persistedContext) {
        await this.clearPersistedContext(repoPath)
        this.events.emit('cleared', repoPath)
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
  async hasStoredContext(repoPath: string): Promise<boolean> {
    const context = await this.loadPersistedContext(repoPath)
    return context !== null
  }

  /**
   * Get the stored execution path for a repo, if any.
   */
  async getStoredExecutionPath(repoPath: string): Promise<string | undefined> {
    const context = await this.loadPersistedContext(repoPath)
    return context?.executionPath
  }

  /**
   * Get full stored context info for observability.
   */
  async getStoredContext(repoPath: string): Promise<PersistedContext | null> {
    return this.loadPersistedContext(repoPath)
  }

  /**
   * Get the stored context, throwing if not found.
   * Use this when a context is expected to exist.
   */
  async getStoredContextOrThrow(repoPath: string): Promise<PersistedContext> {
    const context = await this.loadPersistedContext(repoPath)
    if (!context) {
      throw new ContextNotFoundError(`No stored context found for repository`, repoPath)
    }
    return context
  }

  /**
   * Release an execution context, cleaning up temporary worktrees.
   */
  async release(context: ExecutionContext): Promise<void> {
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
    this.activeContexts.delete(context.repoPath)

    try {
      await this.deps.worktreeOps.remove(context.repoPath, context.executionPath, true)
      log.info(`[ExecutionContextService] Removed temporary worktree: ${context.executionPath}`)
      this.events.emit('released', context, context.repoPath)
    } catch (error) {
      // Log warning but don't fail - cleanup is best-effort
      log.warn(`[ExecutionContextService] Failed to remove temporary worktree:`, error)
    }
  }

  /**
   * Clean up orphaned temporary worktrees from previous runs.
   * Call this on startup to prevent accumulation of temp directories.
   */
  async cleanupOrphans(repoPath: string): Promise<void> {
    // Acquire lock to prevent race conditions when multiple processes
    // try to cleanup simultaneously
    const releaseLock = await this.acquireLock(repoPath)

    try {
      const teapotWorktreeDir = await this.getWorktreeDir(repoPath)
      if (!fs.existsSync(teapotWorktreeDir)) {
        return
      }

      const entries = await fs.promises.readdir(teapotWorktreeDir)
      const git = this.deps.gitAdapter
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
            await this.deps.worktreeOps.remove(repoPath, fullPath, true)
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
        const age = this.deps.clock.now() - context.createdAt
        if (age > this.contextTtlMs) {
          log.info(
            `[ExecutionContextService] Clearing stale context file (${Math.round(age / 1000 / 60 / 60)}h old)`
          )
          await this.clearPersistedContext(repoPath)
          this.events.emit('staleCleared', repoPath, age)
        }
      }

      if (orphansRemoved > 0) {
        this.events.emit('orphansCleanedUp', repoPath, orphansRemoved)
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
  async isActiveWorktreeDirty(repoPath: string): Promise<boolean> {
    const git = this.deps.gitAdapter
    const activeWorktreePath = this.deps.configStore.getActiveWorktree(repoPath) ?? repoPath
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
  async healthCheck(repoPath: string): Promise<{
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
    const storedContextAge = storedContext ? this.deps.clock.now() - storedContext.createdAt : null

    // Check lock file
    const lockPath = await this.getLockFilePath(repoPath)
    let lockFileExists = false
    let lockFileAge: number | null = null
    try {
      const content = await fs.promises.readFile(lockPath, 'utf-8')
      lockFileExists = true
      try {
        const lockInfo = JSON.parse(content)
        lockFileAge = this.deps.clock.now() - lockInfo.timestamp
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
      isStoredContextStale: storedContextAge !== null && storedContextAge > this.contextTtlMs,
      activeContextInMemory: this.activeContexts.get(repoPath) ?? null,
      lockFileExists,
      lockFileAge,
      tempWorktreeDir,
      tempWorktreeDirExists,
      tempWorktreeCount,
      ttlMs: this.contextTtlMs
    }
  }

  // ===========================================================================
  // Private: Exit handler
  // ===========================================================================

  /**
   * Perform synchronous cleanup of file locks before process exits.
   * Worktrees are left for orphan cleanup on next startup since git operations are async.
   *
   * Note: We cannot do async cleanup in exit handlers. The worktrees will be cleaned up
   * by cleanupOrphans() on next startup when the app initializes.
   */
  private cleanupOnExit(): void {
    for (const [repoPath, tempPath] of this.activeContexts) {
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
    if (this.activeContexts.size > 0) {
      log.info(
        `[ExecutionContextService] ${this.activeContexts.size} orphaned worktree(s) will be cleaned up on next app startup via cleanupOrphans()`
      )
    }
  }

  /**
   * Register exit handler for cleanup.
   * Uses 'exit' event instead of signal handlers to avoid interfering with Electron's shutdown.
   * Called automatically when first temp worktree is created.
   */
  private registerExitHandler(): void {
    if (this.exitHandlerRegistered) return
    this.exitHandlerRegistered = true

    // Use 'exit' event for cleanup - this fires during process shutdown
    // and doesn't interfere with Electron's graceful shutdown.
    // Note: 'beforeExit' is not needed since it doesn't fire on explicit exit() or crashes.
    process.on('exit', this.boundExitHandler)
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
  private async acquireLock(repoPath: string): Promise<() => Promise<void>> {
    // Create the release mechanism for this operation
    let releaseFn: () => void
    const operationComplete = new Promise<void>((resolve) => {
      releaseFn = resolve
    })

    // Chain this operation after any existing operations
    // The .catch() prevents a rejected promise from breaking the chain
    const previousChain = this.lockQueues.get(repoPath) ?? Promise.resolve()
    const newChain = previousChain.catch(() => {}).then(() => operationComplete)
    this.lockQueues.set(repoPath, newChain)

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
      if (this.lockQueues.get(repoPath) === newChain) {
        this.lockQueues.delete(repoPath)
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
  private async acquireFileLock(repoPath: string): Promise<void> {
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
          timestamp: this.deps.clock.now()
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
  private async checkAndBreakStaleLock(lockPath: string, repoPath: string): Promise<boolean> {
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

      const age = this.deps.clock.now() - lockInfo.timestamp

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
  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
      // File already deleted - that's fine
    }
  }

  private async releaseFileLock(repoPath: string): Promise<void> {
    try {
      const lockPath = await this.getLockFilePath(repoPath)
      await fs.promises.unlink(lockPath)
    } catch {
      // Ignore errors releasing lock
    }
  }

  private async getLockFilePath(repoPath: string): Promise<string> {
    const gitDir = await resolveGitDir(repoPath)
    return path.join(gitDir, LOCK_FILE)
  }

  // ===========================================================================
  // Private: Persistent storage
  // ===========================================================================

  private async getContextFilePath(repoPath: string): Promise<string> {
    const gitDir = await resolveGitDir(repoPath)
    return path.join(gitDir, CONTEXT_FILE)
  }

  private async getWorktreeDir(repoPath: string): Promise<string> {
    const gitDir = await resolveGitDir(repoPath)
    return path.join(gitDir, WORKTREE_DIR)
  }

  /**
   * Validates that a parsed object has the required PersistedContext shape.
   * Returns null if validation fails, with structured logging for debugging.
   */
  private validatePersistedContext(parsed: unknown, repoPath: string): PersistedContext | null {
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
    const validOperations = ['rebase', 'sync-trunk', 'ship-it', 'squash', 'unknown']
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

  private async loadPersistedContext(repoPath: string): Promise<PersistedContext | null> {
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
        const git = this.deps.gitAdapter
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
  private async persistContext(repoPath: string, context: PersistedContext): Promise<void> {
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

  private async clearPersistedContext(repoPath: string): Promise<void> {
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
  private async createTemporaryWorktree(repoPath: string): Promise<string> {
    const baseDir = await this.getWorktreeDir(repoPath)
    let lastError: Error | null = null
    let finalAttempt = 0

    for (let attempt = 1; attempt <= MAX_WORKTREE_RETRIES; attempt++) {
      finalAttempt = attempt
      const result = await this.deps.worktreeOps.createTemporary(repoPath, baseDir)

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

// =============================================================================
// Static Facade (backward-compatible API)
// =============================================================================

/** Lazily-created default instance for production use */
let defaultInstance: ExecutionContextServiceInstance | null = null

/**
 * Get the default instance, creating it if necessary.
 */
function getDefaultInstance(): ExecutionContextServiceInstance {
  if (!defaultInstance) {
    defaultInstance = new ExecutionContextServiceInstance(createDefaultDependencies())
  }
  return defaultInstance
}

/**
 * Static facade for ExecutionContextService.
 * Provides backward-compatible static API that delegates to the default instance.
 *
 * For testing, use `ExecutionContextService.createInstance()` to create isolated instances
 * with custom dependencies (e.g., mock clock for deterministic time testing).
 */
export class ExecutionContextService {
  /**
   * Create a new isolated instance with custom dependencies.
   * Use this for testing to get full isolation between tests.
   *
   * @example
   * ```typescript
   * const mockClock = createMockClock()
   * const service = ExecutionContextService.createInstance({ clock: mockClock })
   *
   * // Use the instance directly for isolated testing
   * const context = await service.acquire(repoPath)
   *
   * // Advance time to test staleness
   * mockClock.advance(25 * 60 * 60 * 1000)
   * ```
   */
  static createInstance(
    deps: Partial<ExecutionContextDependencies> = {}
  ): ExecutionContextServiceInstance {
    return new ExecutionContextServiceInstance({
      ...createDefaultDependencies(),
      ...deps
    })
  }

  /**
   * Reset the default instance.
   * Clears all state and creates a fresh instance on next use.
   * Primarily for testing cleanup.
   */
  static resetDefaultInstance(): void {
    if (defaultInstance) {
      defaultInstance.reset()
      defaultInstance = null
    }
  }

  /**
   * Get the default instance.
   * Exposed for cases where the instance is needed directly.
   */
  static getDefaultInstance(): ExecutionContextServiceInstance {
    return getDefaultInstance()
  }

  /**
   * Event emitter for observability.
   * Subscribe to events like 'acquired', 'released', 'stored', 'cleared'.
   */
  static get events(): EventEmitter {
    return getDefaultInstance().events
  }

  /**
   * Get the current context TTL in milliseconds.
   */
  static getContextTTL(): number {
    return getDefaultInstance().getContextTTL()
  }

  /**
   * Set the context TTL in milliseconds.
   * Contexts older than this are considered stale and will be cleared.
   * Default is 24 hours.
   */
  static setContextTTL(ttlMs: number): void {
    getDefaultInstance().setContextTTL(ttlMs)
  }

  /**
   * Reset the context TTL to its default value (24 hours).
   */
  static resetContextTTL(): void {
    getDefaultInstance().resetContextTTL()
  }

  /**
   * Acquire an execution context for Git operations.
   */
  static async acquire(
    repoPath: string,
    operationOrOptions:
      | ExecutionOperation
      | { operation?: ExecutionOperation; targetBranch?: string } = 'unknown'
  ): Promise<ExecutionContext> {
    return getDefaultInstance().acquire(repoPath, operationOrOptions)
  }

  /**
   * Store the execution context for later use (e.g., during conflict resolution).
   */
  static async storeContext(repoPath: string, context: ExecutionContext): Promise<void> {
    return getDefaultInstance().storeContext(repoPath, context)
  }

  /**
   * Clear the stored context and release the temp worktree.
   */
  static async clearStoredContext(repoPath: string): Promise<void> {
    return getDefaultInstance().clearStoredContext(repoPath)
  }

  /**
   * Check if there's a stored context for a repo.
   */
  static async hasStoredContext(repoPath: string): Promise<boolean> {
    return getDefaultInstance().hasStoredContext(repoPath)
  }

  /**
   * Get the stored execution path for a repo, if any.
   */
  static async getStoredExecutionPath(repoPath: string): Promise<string | undefined> {
    return getDefaultInstance().getStoredExecutionPath(repoPath)
  }

  /**
   * Get full stored context info for observability.
   */
  static async getStoredContext(repoPath: string): Promise<PersistedContext | null> {
    return getDefaultInstance().getStoredContext(repoPath)
  }

  /**
   * Get the stored context, throwing if not found.
   */
  static async getStoredContextOrThrow(repoPath: string): Promise<PersistedContext> {
    return getDefaultInstance().getStoredContextOrThrow(repoPath)
  }

  /**
   * Release an execution context, cleaning up temporary worktrees.
   */
  static async release(context: ExecutionContext): Promise<void> {
    return getDefaultInstance().release(context)
  }

  /**
   * Clean up orphaned temporary worktrees from previous runs.
   */
  static async cleanupOrphans(repoPath: string): Promise<void> {
    return getDefaultInstance().cleanupOrphans(repoPath)
  }

  /**
   * Check if the active worktree is dirty.
   */
  static async isActiveWorktreeDirty(repoPath: string): Promise<boolean> {
    return getDefaultInstance().isActiveWorktreeDirty(repoPath)
  }

  /**
   * Health check for diagnostics and monitoring.
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
    return getDefaultInstance().healthCheck(repoPath)
  }
}
