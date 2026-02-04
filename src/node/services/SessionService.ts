/**
 * SessionService - Manages rebase session state
 *
 * Provides two-tier write-through cache for rebase sessions:
 * - Memory for fast lookups
 * - Disk (electron-store) for crash survival
 *
 * Key features:
 * - Instance-based architecture for testability
 * - Clock abstraction for deterministic time testing
 * - Session versioning for optimistic concurrency
 */

import { log } from '@shared/logger'
import type { DetachedWorktree, RebasePlan, RebaseState } from '@shared/types'
import { configStore, type ConfigStore, type StoredRebaseSession } from '../store'

export type { StoredRebaseSession }

// =============================================================================
// Dependencies Interface (for testability)
// =============================================================================

/**
 * Clock abstraction for time-based operations.
 */
export interface Clock {
  now(): number
}

/**
 * Dependencies that can be injected for testing.
 */
export interface SessionServiceDependencies {
  /** Clock for timestamps */
  clock: Clock
  /** Config store for persistence */
  configStore: Pick<
    ConfigStore,
    'getRebaseSession' | 'setRebaseSession' | 'deleteRebaseSession' | 'hasRebaseSession'
  >
}

/**
 * Create default dependencies using production singletons.
 */
function createDefaultDependencies(): SessionServiceDependencies {
  return {
    clock: { now: () => Date.now() },
    configStore
  }
}

// =============================================================================
// Path Normalization
// =============================================================================

function normalizePath(repoPath: string): string {
  return repoPath.replace(/\/+$/, '')
}

// =============================================================================
// Instance-based Service Implementation
// =============================================================================

/**
 * Two-tier write-through cache for rebase sessions.
 * Memory for fast lookups, disk (electron-store) for crash survival.
 */
class SessionStoreInstance {
  private memory = new Map<string, StoredRebaseSession>()

  constructor(
    private readonly disk: Pick<
      ConfigStore,
      'getRebaseSession' | 'setRebaseSession' | 'deleteRebaseSession' | 'hasRebaseSession'
    >
  ) {}

  get(key: string): StoredRebaseSession | null {
    if (!this.memory.has(key)) {
      const persisted = this.disk.getRebaseSession(key)
      if (persisted) this.memory.set(key, persisted)
    }
    return this.memory.get(key) ?? null
  }

  set(key: string, session: StoredRebaseSession): void {
    this.disk.setRebaseSession(key, session)
    this.memory.set(key, session)
  }

  delete(key: string): void {
    this.disk.deleteRebaseSession(key)
    this.memory.delete(key)
  }

  has(key: string): boolean {
    return this.memory.has(key) || this.disk.hasRebaseSession(key)
  }

  getAll(): Map<string, StoredRebaseSession> {
    return new Map(this.memory)
  }

  /**
   * Clear all in-memory state for testing.
   */
  clear(): void {
    this.memory.clear()
  }
}

/**
 * Instance-based SessionService.
 * All state is encapsulated as instance properties for test isolation.
 *
 * Use `SessionService.createInstance()` to create isolated instances for testing.
 * Production code uses the module-level functions which delegate to a shared default instance.
 */
export class SessionServiceInstance {
  private readonly sessionStore: SessionStoreInstance

  constructor(private readonly deps: SessionServiceDependencies) {
    this.sessionStore = new SessionStoreInstance(deps.configStore)
  }

  /**
   * Reset all instance state for testing.
   */
  reset(): void {
    this.sessionStore.clear()
  }

  getSession(repoPath: string): StoredRebaseSession | null {
    const session = this.sessionStore.get(normalizePath(repoPath))
    log.debug('[SessionService] getSession()', {
      repoPath,
      hasSession: !!session,
      sessionStatus: session?.state.session.status,
      activeJobId: session?.state.queue.activeJobId,
      pendingJobCount: session?.state.queue.pendingJobIds.length
    })
    return session
  }

  hasSession(repoPath: string): boolean {
    return this.sessionStore.has(normalizePath(repoPath))
  }

  getAllSessions(): Map<string, StoredRebaseSession> {
    return this.sessionStore.getAll()
  }

  createSession(
    repoPath: string,
    plan: RebasePlan,
    originalBranch: string,
    autoDetachedWorktrees?: DetachedWorktree[]
  ): void {
    const key = normalizePath(repoPath)
    log.debug('[SessionService] createSession() called', {
      repoPath,
      key,
      originalBranch,
      intentTargetCount: plan.intent.targets.length,
      pendingJobCount: plan.state.queue.pendingJobIds.length,
      autoDetachedWorktreeCount: autoDetachedWorktrees?.length ?? 0
    })

    if (this.sessionStore.has(key)) {
      log.error('[SessionService] createSession() failed - session already exists', { key })
      throw new Error('Session already exists')
    }

    const now = this.deps.clock.now()
    this.sessionStore.set(key, {
      intent: plan.intent,
      state: plan.state,
      originalBranch,
      autoDetachedWorktrees,
      version: 1,
      createdAtMs: now,
      updatedAtMs: now
    })
    log.debug('[SessionService] createSession() completed', { key })
  }

  clearSession(repoPath: string): void {
    const key = normalizePath(repoPath)
    const hadSession = this.sessionStore.has(key)
    this.sessionStore.delete(key)
    log.info('[SessionService] clearSession called', { repoPath, key, hadSession })
  }

  clearAutoDetachedWorktrees(repoPath: string): void {
    const key = normalizePath(repoPath)
    const existing = this.sessionStore.get(key)
    if (!existing) return
    this.sessionStore.set(key, { ...existing, autoDetachedWorktrees: [] })
  }

  updateState(repoPath: string, state: RebaseState): void {
    const key = normalizePath(repoPath)
    const existing = this.sessionStore.get(key)
    if (!existing) {
      log.error('[SessionService] updateState() failed - session not found', { repoPath, key })
      throw new Error(`Session not found: ${repoPath}`)
    }

    log.debug('[SessionService] updateState() called', {
      repoPath,
      key,
      oldVersion: existing.version,
      newVersion: existing.version + 1,
      oldStatus: existing.state.session.status,
      newStatus: state.session.status,
      oldActiveJobId: existing.state.queue.activeJobId,
      newActiveJobId: state.queue.activeJobId,
      oldPendingCount: existing.state.queue.pendingJobIds.length,
      newPendingCount: state.queue.pendingJobIds.length
    })

    this.sessionStore.set(key, {
      ...existing,
      state,
      version: existing.version + 1,
      updatedAtMs: this.deps.clock.now()
    })
  }

  markJobCompleted(repoPath: string, jobId: string, newSha: string): void {
    const key = normalizePath(repoPath)
    const existing = this.sessionStore.get(key)
    if (!existing) {
      throw new Error(`Session not found: ${repoPath}`)
    }

    const job = existing.state.jobsById[jobId]
    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    this.sessionStore.set(key, {
      ...existing,
      state: {
        ...existing.state,
        jobsById: {
          ...existing.state.jobsById,
          [jobId]: { ...job, status: 'completed', rebasedHeadSha: newSha }
        }
      },
      version: existing.version + 1,
      updatedAtMs: this.deps.clock.now()
    })
  }
}

// =============================================================================
// Default Instance (singleton for production)
// =============================================================================

/** Lazily-created default instance for production use */
let defaultInstance: SessionServiceInstance | null = null

/**
 * Get the default instance, creating it if necessary.
 */
function getDefaultInstance(): SessionServiceInstance {
  if (!defaultInstance) {
    defaultInstance = new SessionServiceInstance(createDefaultDependencies())
  }
  return defaultInstance
}

// =============================================================================
// Static Factory (for testing)
// =============================================================================

/**
 * SessionService namespace with factory methods for testing.
 */
export const SessionService = {
  /**
   * Create a new isolated instance with custom dependencies.
   * Use this for testing to get full isolation between tests.
   */
  createInstance(deps: Partial<SessionServiceDependencies> = {}): SessionServiceInstance {
    return new SessionServiceInstance({
      ...createDefaultDependencies(),
      ...deps
    })
  },

  /**
   * Reset the default instance.
   * Clears all state and creates a fresh instance on next use.
   * Primarily for testing cleanup.
   */
  resetDefaultInstance(): void {
    if (defaultInstance) {
      defaultInstance.reset()
      defaultInstance = null
    }
  },

  /**
   * Get the default instance.
   */
  getDefaultInstance(): SessionServiceInstance {
    return getDefaultInstance()
  }
}

// =============================================================================
// Public API (backward-compatible module-level functions)
// =============================================================================

export function getSession(repoPath: string): StoredRebaseSession | null {
  return getDefaultInstance().getSession(repoPath)
}

export function hasSession(repoPath: string): boolean {
  return getDefaultInstance().hasSession(repoPath)
}

export function getAllSessions(): Map<string, StoredRebaseSession> {
  return getDefaultInstance().getAllSessions()
}

export function createSession(
  repoPath: string,
  plan: RebasePlan,
  originalBranch: string,
  autoDetachedWorktrees?: DetachedWorktree[]
): void {
  return getDefaultInstance().createSession(repoPath, plan, originalBranch, autoDetachedWorktrees)
}

export function clearSession(repoPath: string): void {
  return getDefaultInstance().clearSession(repoPath)
}

export function clearAutoDetachedWorktrees(repoPath: string): void {
  return getDefaultInstance().clearAutoDetachedWorktrees(repoPath)
}

export function updateState(repoPath: string, state: RebaseState): void {
  return getDefaultInstance().updateState(repoPath, state)
}

export function markJobCompleted(repoPath: string, jobId: string, newSha: string): void {
  return getDefaultInstance().markJobCompleted(repoPath, jobId, newSha)
}

// =============================================================================
// Legacy Interface (for tests/operations - to be cleaned up)
// =============================================================================

export type CasResult =
  | { success: true }
  | { success: false; reason: 'version_mismatch' | 'not_found' }

export interface IRebaseSessionStore {
  getSession(repoPath: string): Promise<StoredRebaseSession | null>
  createSession(
    repoPath: string,
    session: Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'>
  ): Promise<CasResult>
  clearSession(repoPath: string): Promise<void>
  getAllSessions(): Promise<Map<string, StoredRebaseSession>>
  hasSession(repoPath: string): Promise<boolean>
}

/**
 * Legacy async interface for backward compatibility.
 */
export const rebaseSessionStore: IRebaseSessionStore = {
  async getSession(repoPath) {
    return getSession(repoPath)
  },
  async createSession(repoPath, session) {
    const key = normalizePath(repoPath)
    const instance = getDefaultInstance()
    if (instance.hasSession(key)) {
      return { success: false, reason: 'version_mismatch' }
    }
    // Use the public API by creating a plan object
    const plan: RebasePlan = {
      intent: session.intent,
      state: session.state
    }
    try {
      instance.createSession(repoPath, plan, session.originalBranch, session.autoDetachedWorktrees)
      return { success: true }
    } catch {
      return { success: false, reason: 'version_mismatch' }
    }
  },
  async clearSession(repoPath) {
    clearSession(repoPath)
  },
  async getAllSessions() {
    return getAllSessions()
  },
  async hasSession(repoPath) {
    return hasSession(repoPath)
  }
}

export function createStoredSession(
  plan: RebasePlan,
  originalBranch: string,
  options: { autoDetachedWorktrees?: DetachedWorktree[] } = {}
): Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'> {
  return {
    intent: plan.intent,
    state: plan.state,
    originalBranch,
    autoDetachedWorktrees: options.autoDetachedWorktrees
  }
}
