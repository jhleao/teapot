/**
 * ContextScope - RAII-style execution context management
 *
 * Provides automatic resource cleanup for execution contexts using the
 * disposable pattern. This eliminates the class of bugs where contexts
 * are leaked due to early returns or exceptions.
 *
 * Usage:
 * ```typescript
 * async function doRebase(repoPath: string) {
 *   using scope = await ContextScope.acquire(repoPath, 'rebase')
 *   const context = scope.context
 *
 *   // ... do work ...
 *
 *   if (needsConflictResolution) {
 *     scope.markForStorage() // Context will be stored instead of released
 *   }
 *   return result
 *   // Context automatically released/stored when scope exits
 * }
 * ```
 *
 * The scope handles three cleanup strategies:
 * 1. Release (default): Clear stored context and release the execution context
 * 2. Store: Store context for later resume (e.g., during conflict resolution)
 * 3. Abandon: Just release without clearing stored context (for error recovery)
 */

import { ExecutionContextService } from './ExecutionContextService'
import type { ExecutionContext, ExecutionOperation } from './ExecutionContextService'

export type ContextDisposition = 'release' | 'store' | 'abandon'

export class ContextScope implements Disposable {
  private _context: ExecutionContext
  private _disposition: ContextDisposition = 'release'
  private _disposed = false

  private constructor(
    private readonly repoPath: string,
    context: ExecutionContext
  ) {
    this._context = context
  }

  /**
   * Acquire an execution context wrapped in a scope.
   * The scope will automatically manage cleanup when disposed.
   */
  static async acquire(
    repoPath: string,
    operation: ExecutionOperation = 'unknown'
  ): Promise<ContextScope> {
    const context = await ExecutionContextService.acquire(repoPath, operation)
    return new ContextScope(repoPath, context)
  }

  /**
   * The acquired execution context.
   */
  get context(): ExecutionContext {
    if (this._disposed) {
      throw new Error('ContextScope has already been disposed')
    }
    return this._context
  }

  /**
   * The path where git operations should be executed.
   * Convenience accessor for context.executionPath.
   */
  get executionPath(): string {
    return this.context.executionPath
  }

  /**
   * Mark the context to be stored for later resume.
   * Use this when a conflict occurs and the user needs to resolve it.
   */
  markForStorage(): void {
    this._disposition = 'store'
  }

  /**
   * Mark the context to be abandoned (released without clearing stored).
   * Use this for error recovery where stored context should be preserved.
   */
  markForAbandon(): void {
    this._disposition = 'abandon'
  }

  /**
   * Mark the context for normal release (default behavior).
   * Clears any stored context and releases the execution context.
   */
  markForRelease(): void {
    this._disposition = 'release'
  }

  /**
   * Check if this scope has been disposed.
   */
  get isDisposed(): boolean {
    return this._disposed
  }

  /**
   * Synchronous dispose implementation for the Disposable interface.
   * Note: This queues the async cleanup but doesn't wait for it.
   * For proper cleanup, prefer using `await scope.disposeAsync()` or
   * the `await using` syntax (requires TypeScript 5.2+).
   */
  [Symbol.dispose](): void {
    if (this._disposed) return
    this._disposed = true

    // Queue async cleanup - we can't await in synchronous dispose
    // This is safe because the cleanup operations are idempotent
    void this.performCleanup()
  }

  /**
   * Async dispose for explicit cleanup with awaiting.
   * Prefer this over Symbol.dispose when you need to ensure cleanup completes.
   */
  async disposeAsync(): Promise<void> {
    if (this._disposed) return
    this._disposed = true
    await this.performCleanup()
  }

  private async performCleanup(): Promise<void> {
    switch (this._disposition) {
      case 'store':
        await ExecutionContextService.storeContext(this.repoPath, this._context)
        break

      case 'release':
        await ExecutionContextService.clearStoredContext(this.repoPath)
        await ExecutionContextService.release(this._context)
        break

      case 'abandon':
        await ExecutionContextService.release(this._context)
        break
    }
  }
}

/**
 * Helper function to run an operation with automatic context management.
 * This is an alternative to the `using` syntax for environments that don't support it.
 *
 * @example
 * ```typescript
 * const result = await withContext(repoPath, 'rebase', async (scope) => {
 *   // ... do work with scope.context ...
 *   if (conflict) scope.markForStorage()
 *   return result
 * })
 * ```
 */
export async function withContext<T>(
  repoPath: string,
  operation: ExecutionOperation,
  fn: (scope: ContextScope) => Promise<T>
): Promise<T> {
  const scope = await ContextScope.acquire(repoPath, operation)
  try {
    return await fn(scope)
  } finally {
    await scope.disposeAsync()
  }
}
