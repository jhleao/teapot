/**
 * Rebase Session Store
 *
 * Manages active rebase sessions per repository. Sessions track the state of
 * ongoing rebase operations, including the original intent, current progress,
 * and conflict information.
 *
 * This module provides:
 * - An abstract interface for session persistence (future: electron-store, SQLite)
 * - An in-memory implementation for MVP
 * - Concurrency protection via optimistic locking (version numbers)
 */

import type { RebaseIntent, RebasePlan, RebaseState } from '@shared/types'

/**
 * A stored rebase session with metadata and version for concurrency control.
 */
export type StoredRebaseSession = {
  /** The original rebase intent from the user */
  intent: RebaseIntent
  /** The current rebase state (jobs, queue, session metadata) */
  state: RebaseState
  /** Version number for optimistic concurrency control. Incremented on each update. */
  version: number
  /** Timestamp when the session was created */
  createdAtMs: number
  /** Timestamp of the last update */
  updatedAtMs: number
  /** Original branch the user was on when starting the rebase */
  originalBranch: string
}

/**
 * Result of a compare-and-set operation
 */
export type CasResult =
  | { success: true }
  | { success: false; reason: 'version_mismatch' | 'not_found' }

/**
 * Abstract interface for rebase session storage.
 * Allows swapping implementations (in-memory → persistent) without changing callers.
 */
export interface IRebaseSessionStore {
  /**
   * Get the current session for a repository.
   * @param repoPath - Absolute path to the repository
   * @returns Session or null if none exists
   */
  getSession(repoPath: string): Promise<StoredRebaseSession | null>

  /**
   * Create a new session for a repository.
   * Fails if a session already exists (use updateSession to modify existing).
   * @param repoPath - Absolute path to the repository
   * @param session - Session data (version will be set to 1)
   * @returns Success or failure with reason
   */
  createSession(
    repoPath: string,
    session: Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'>
  ): Promise<CasResult>

  /**
   * Update an existing session using optimistic concurrency control.
   * Only succeeds if the current version matches expectedVersion.
   * @param repoPath - Absolute path to the repository
   * @param expectedVersion - The version number the caller expects
   * @param updates - Partial updates to apply (version will be incremented)
   * @returns Success or failure with reason
   */
  updateSession(
    repoPath: string,
    expectedVersion: number,
    updates: Partial<Pick<StoredRebaseSession, 'state' | 'intent'>>
  ): Promise<CasResult>

  /**
   * Delete a session.
   * @param repoPath - Absolute path to the repository
   */
  clearSession(repoPath: string): Promise<void>

  /**
   * Get all active sessions.
   * Useful for recovery on app restart.
   */
  getAllSessions(): Promise<Map<string, StoredRebaseSession>>

  /**
   * Check if a repository has an active session.
   */
  hasSession(repoPath: string): Promise<boolean>
}

/**
 * In-memory implementation of IRebaseSessionStore.
 *
 * Suitable for MVP where sessions don't need to survive app restarts.
 * Git's .git/rebase-* directories provide crash recovery anyway.
 */
export class InMemoryRebaseSessionStore implements IRebaseSessionStore {
  private sessions: Map<string, StoredRebaseSession> = new Map()

  async getSession(repoPath: string): Promise<StoredRebaseSession | null> {
    return this.sessions.get(this.normalizePath(repoPath)) ?? null
  }

  async createSession(
    repoPath: string,
    session: Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'>
  ): Promise<CasResult> {
    const key = this.normalizePath(repoPath)

    if (this.sessions.has(key)) {
      return { success: false, reason: 'version_mismatch' }
    }

    const now = Date.now()
    this.sessions.set(key, {
      ...session,
      version: 1,
      createdAtMs: now,
      updatedAtMs: now
    })

    return { success: true }
  }

  async updateSession(
    repoPath: string,
    expectedVersion: number,
    updates: Partial<Pick<StoredRebaseSession, 'state' | 'intent'>>
  ): Promise<CasResult> {
    const key = this.normalizePath(repoPath)
    const existing = this.sessions.get(key)

    if (!existing) {
      return { success: false, reason: 'not_found' }
    }

    if (existing.version !== expectedVersion) {
      return { success: false, reason: 'version_mismatch' }
    }

    this.sessions.set(key, {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAtMs: Date.now()
    })

    return { success: true }
  }

  async clearSession(repoPath: string): Promise<void> {
    this.sessions.delete(this.normalizePath(repoPath))
  }

  async getAllSessions(): Promise<Map<string, StoredRebaseSession>> {
    return new Map(this.sessions)
  }

  async hasSession(repoPath: string): Promise<boolean> {
    return this.sessions.has(this.normalizePath(repoPath))
  }

  /**
   * Normalize path for consistent key lookup.
   * Removes trailing slashes and resolves to absolute path.
   */
  private normalizePath(repoPath: string): string {
    return repoPath.replace(/\/+$/, '')
  }
}

/**
 * Singleton instance of the rebase session store.
 * Can be replaced with a persistent implementation later.
 */
export const rebaseSessionStore: IRebaseSessionStore = new InMemoryRebaseSessionStore()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a new StoredRebaseSession from a RebasePlan.
 */
export function createStoredSession(
  plan: RebasePlan,
  originalBranch: string
): Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'> {
  return {
    intent: plan.intent,
    state: plan.state,
    originalBranch
  }
}

/**
 * Safely updates a session with automatic retry on version mismatch.
 * Useful when multiple operations might be updating the session concurrently.
 *
 * @param store - The session store
 * @param repoPath - Repository path
 * @param updater - Function that receives current state and returns updates
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Success or failure after all retries exhausted
 */
export async function updateSessionWithRetry(
  store: IRebaseSessionStore,
  repoPath: string,
  updater: (current: StoredRebaseSession) => Partial<Pick<StoredRebaseSession, 'state' | 'intent'>>,
  maxRetries = 3
): Promise<CasResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const current = await store.getSession(repoPath)
    if (!current) {
      return { success: false, reason: 'not_found' }
    }

    const updates = updater(current)
    const result = await store.updateSession(repoPath, current.version, updates)

    if (result.success) {
      return result
    }

    // If version mismatch, retry with fresh state
    if (result.reason === 'version_mismatch' && attempt < maxRetries - 1) {
      // Small delay before retry to reduce contention
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
      continue
    }

    return result
  }

  return { success: false, reason: 'version_mismatch' }
}

/**
 * Error thrown when a session operation fails due to concurrency.
 */
export class SessionConcurrencyError extends Error {
  constructor(
    message: string,
    public readonly repoPath: string,
    public readonly expectedVersion: number
  ) {
    super(message)
    this.name = 'SessionConcurrencyError'
  }
}

/**
 * Error thrown when trying to operate on a non-existent session.
 */
export class SessionNotFoundError extends Error {
  constructor(
    message: string,
    public readonly repoPath: string
  ) {
    super(message)
    this.name = 'SessionNotFoundError'
  }
}
