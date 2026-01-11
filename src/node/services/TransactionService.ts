/**
 * TransactionService - Write-Ahead Log for Session/Context Operations
 *
 * Provides transactional guarantees for operations that modify both
 * session state and execution context. Uses a write-ahead log (WAL) pattern
 * to ensure consistency even after crashes.
 *
 * Flow:
 * 1. Write intent to disk BEFORE executing operation
 * 2. Execute the operation (git rebase, etc.)
 * 3. Commit the state change (update session, clear intent)
 * 4. On recovery: check for uncommitted intents and reconcile
 *
 * Intent states:
 * - 'pending': Intent written, operation not started
 * - 'executing': Operation in progress
 * - 'completed': Operation completed, awaiting commit
 * - 'failed': Operation failed, needs cleanup
 */

import * as fs from 'fs'
import * as path from 'path'

import { log } from '@shared/logger'
import type { RebaseState } from '@shared/types'

/** Intent types for different operations */
export type IntentType = 'continue' | 'abort' | 'execute-job' | 'finalize'

/** Intent status for tracking operation state */
export type IntentStatus = 'pending' | 'executing' | 'completed' | 'failed'

/**
 * A transaction intent records the planned operation and its expected state.
 * This allows recovery to determine whether to rollback or complete the operation.
 */
export interface TransactionIntent {
  /** Unique ID for this intent (for correlation) */
  id: string
  /** Type of operation being performed */
  type: IntentType
  /** When the intent was created */
  createdAtMs: number
  /** Current status of the operation */
  status: IntentStatus
  /** When the status was last updated */
  updatedAtMs: number
  /** Expected session state BEFORE the operation */
  expectedStateBefore?: {
    activeJobId?: string
    pendingJobCount: number
    sessionStatus: string
  }
  /** Additional context for the operation */
  context?: {
    jobId?: string
    branch?: string
    executionPath?: string
  }
  /** Error information if operation failed */
  error?: {
    message: string
    code?: string
  }
}

/** File name for intent log in .git */
const INTENT_FILE = 'teapot-intent.json'

/** Intent TTL - intents older than this are considered orphaned (1 hour) */
const INTENT_TTL_MS = 60 * 60 * 1000

export class TransactionService {
  private constructor() {
    // Static-only class
  }

  /**
   * Write a new intent to the log.
   * This MUST be called before starting any operation that modifies session state.
   */
  static async writeIntent(
    repoPath: string,
    intent: Omit<TransactionIntent, 'createdAtMs' | 'updatedAtMs' | 'status'>
  ): Promise<TransactionIntent> {
    const fullIntent: TransactionIntent = {
      ...intent,
      status: 'pending',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now()
    }

    await this.persistIntent(repoPath, fullIntent)
    log.debug('[TransactionService] Intent written', {
      repoPath,
      intentId: intent.id,
      type: intent.type
    })

    return fullIntent
  }

  /**
   * Update intent status to 'executing'.
   * Call this after the operation has started but before any state changes.
   */
  static async markExecuting(repoPath: string): Promise<void> {
    const intent = await this.getIntent(repoPath)
    if (!intent) {
      log.warn('[TransactionService] No intent to mark as executing', { repoPath })
      return
    }

    await this.persistIntent(repoPath, {
      ...intent,
      status: 'executing',
      updatedAtMs: Date.now()
    })
  }

  /**
   * Mark intent as completed.
   * Call this after the operation succeeded but before clearing the intent.
   */
  static async markCompleted(repoPath: string): Promise<void> {
    const intent = await this.getIntent(repoPath)
    if (!intent) {
      return
    }

    await this.persistIntent(repoPath, {
      ...intent,
      status: 'completed',
      updatedAtMs: Date.now()
    })
  }

  /**
   * Mark intent as failed with error information.
   * Call this when an operation fails.
   */
  static async markFailed(
    repoPath: string,
    error: { message: string; code?: string }
  ): Promise<void> {
    const intent = await this.getIntent(repoPath)
    if (!intent) {
      return
    }

    await this.persistIntent(repoPath, {
      ...intent,
      status: 'failed',
      error,
      updatedAtMs: Date.now()
    })
  }

  /**
   * Commit the transaction by clearing the intent.
   * Call this after all state changes have been persisted.
   */
  static async commitIntent(repoPath: string): Promise<void> {
    await this.clearIntent(repoPath)
    log.debug('[TransactionService] Intent committed (cleared)', { repoPath })
  }

  /**
   * Get the current intent for a repo.
   */
  static async getIntent(repoPath: string): Promise<TransactionIntent | null> {
    return this.loadIntent(repoPath)
  }

  /**
   * Check if there's an uncommitted intent that needs recovery.
   * Returns the intent if recovery is needed, null otherwise.
   */
  static async checkForRecovery(repoPath: string): Promise<TransactionIntent | null> {
    const intent = await this.loadIntent(repoPath)
    if (!intent) {
      return null
    }

    const age = Date.now() - intent.createdAtMs

    // If intent is too old, clear it and return null
    if (age > INTENT_TTL_MS) {
      log.warn('[TransactionService] Clearing stale intent', {
        repoPath,
        intentId: intent.id,
        ageHours: Math.round(age / 1000 / 60 / 60)
      })
      await this.clearIntent(repoPath)
      return null
    }

    // Only return intents that need recovery (not completed)
    if (intent.status === 'completed') {
      // Completed but not cleared - just clear it
      await this.clearIntent(repoPath)
      return null
    }

    return intent
  }

  /**
   * Reconcile state after a crash.
   * Examines the intent and current state to determine recovery action.
   */
  static async reconcile(
    repoPath: string,
    currentState: RebaseState | null,
    isGitRebasing: boolean
  ): Promise<{
    action: 'none' | 'clear-session' | 'continue-operation' | 'abort-operation'
    reason: string
  }> {
    const intent = await this.checkForRecovery(repoPath)
    if (!intent) {
      return { action: 'none', reason: 'No uncommitted intent' }
    }

    log.info('[TransactionService] Reconciling after potential crash', {
      repoPath,
      intentId: intent.id,
      type: intent.type,
      status: intent.status,
      hasCurrentState: currentState !== null,
      isGitRebasing
    })

    // If intent was marked as failed, clear everything
    if (intent.status === 'failed') {
      await this.clearIntent(repoPath)
      return { action: 'clear-session', reason: 'Intent was marked as failed' }
    }

    // If intent was pending (never started), clear it
    if (intent.status === 'pending') {
      await this.clearIntent(repoPath)
      return { action: 'none', reason: 'Intent was never executed' }
    }

    // Intent was executing - need to determine actual state
    if (intent.status === 'executing') {
      // Check if git is still rebasing
      if (isGitRebasing) {
        // Git is rebasing - the operation is still in progress
        // This could be a conflict, let the normal flow handle it
        await this.clearIntent(repoPath)
        return { action: 'continue-operation', reason: 'Git rebase still in progress' }
      }

      // Git is not rebasing - operation may have completed or failed
      // Without the rebase state, we can't know for sure
      // Clear intent and let normal reconciliation handle it
      await this.clearIntent(repoPath)
      return { action: 'none', reason: 'Intent was executing but git is not rebasing' }
    }

    // Unknown state - clear intent
    await this.clearIntent(repoPath)
    return { action: 'none', reason: 'Unknown intent state' }
  }

  // ===========================================================================
  // Private: Persistence
  // ===========================================================================

  private static getIntentFilePath(repoPath: string): string {
    return path.join(repoPath, '.git', INTENT_FILE)
  }

  private static async loadIntent(repoPath: string): Promise<TransactionIntent | null> {
    try {
      const filePath = this.getIntentFilePath(repoPath)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      return JSON.parse(content) as TransactionIntent
    } catch {
      return null
    }
  }

  /**
   * Persist intent using atomic write (temp file + rename).
   */
  private static async persistIntent(repoPath: string, intent: TransactionIntent): Promise<void> {
    const filePath = this.getIntentFilePath(repoPath)
    const tempPath = `${filePath}.${process.pid}.tmp`

    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(intent, null, 2))
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

  private static async clearIntent(repoPath: string): Promise<void> {
    try {
      const filePath = this.getIntentFilePath(repoPath)
      await fs.promises.unlink(filePath)
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

/**
 * Helper to run an operation with transaction safety.
 * Automatically manages intent lifecycle.
 */
export async function withTransaction<T>(
  repoPath: string,
  intentType: IntentType,
  intentContext: TransactionIntent['context'],
  operation: () => Promise<T>
): Promise<T> {
  const intentId = `${intentType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Write intent before operation
  await TransactionService.writeIntent(repoPath, {
    id: intentId,
    type: intentType,
    context: intentContext
  })

  try {
    // Mark as executing
    await TransactionService.markExecuting(repoPath)

    // Execute operation
    const result = await operation()

    // Mark as completed and commit
    await TransactionService.markCompleted(repoPath)
    await TransactionService.commitIntent(repoPath)

    return result
  } catch (error) {
    // Mark as failed
    await TransactionService.markFailed(repoPath, {
      message: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string })?.code
    })

    throw error
  }
}
