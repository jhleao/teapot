import { log } from '@shared/logger'
import type { DetachedWorktree, RebasePlan, RebaseState } from '@shared/types'
import { configStore, type ConfigStore, type StoredRebaseSession } from '../store'

export type { StoredRebaseSession }

function normalizePath(repoPath: string): string {
  return repoPath.replace(/\/+$/, '')
}

/**
 * Two-tier write-through cache for rebase sessions.
 * Memory for fast lookups, disk (electron-store) for crash survival.
 */
class SessionStore {
  private memory = new Map<string, StoredRebaseSession>()

  constructor(private disk: ConfigStore) {}

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
}

const sessionStore = new SessionStore(configStore)

// --- Public API ---

export function getSession(repoPath: string): StoredRebaseSession | null {
  const session = sessionStore.get(normalizePath(repoPath))
  log.debug('[SessionService] getSession()', {
    repoPath,
    hasSession: !!session,
    sessionStatus: session?.state.session.status,
    activeJobId: session?.state.queue.activeJobId,
    pendingJobCount: session?.state.queue.pendingJobIds.length
  })
  return session
}

export function hasSession(repoPath: string): boolean {
  return sessionStore.has(normalizePath(repoPath))
}

export function getAllSessions(): Map<string, StoredRebaseSession> {
  return sessionStore.getAll()
}

export function createSession(
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

  if (sessionStore.has(key)) {
    log.error('[SessionService] createSession() failed - session already exists', { key })
    throw new Error('Session already exists')
  }

  const now = Date.now()
  sessionStore.set(key, {
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

export function clearSession(repoPath: string): void {
  const key = normalizePath(repoPath)
  const hadSession = sessionStore.has(key)
  sessionStore.delete(key)
  log.info('[SessionService] clearSession called', { repoPath, key, hadSession })
}

export function clearAutoDetachedWorktrees(repoPath: string): void {
  const key = normalizePath(repoPath)
  const existing = sessionStore.get(key)
  if (!existing) return
  sessionStore.set(key, { ...existing, autoDetachedWorktrees: [] })
}

export function updateState(repoPath: string, state: RebaseState): void {
  const key = normalizePath(repoPath)
  const existing = sessionStore.get(key)
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

  sessionStore.set(key, {
    ...existing,
    state,
    version: existing.version + 1,
    updatedAtMs: Date.now()
  })
}

export function markJobCompleted(repoPath: string, jobId: string, newSha: string): void {
  const key = normalizePath(repoPath)
  const existing = sessionStore.get(key)
  if (!existing) {
    throw new Error(`Session not found: ${repoPath}`)
  }

  const job = existing.state.jobsById[jobId]
  if (!job) {
    throw new Error(`Job not found: ${jobId}`)
  }

  sessionStore.set(key, {
    ...existing,
    state: {
      ...existing.state,
      jobsById: {
        ...existing.state.jobsById,
        [jobId]: { ...job, status: 'completed', rebasedHeadSha: newSha }
      }
    },
    version: existing.version + 1,
    updatedAtMs: Date.now()
  })
}

// --- Legacy interface for tests/operations (to be cleaned up) ---

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

export const rebaseSessionStore: IRebaseSessionStore = {
  async getSession(repoPath) {
    return getSession(repoPath)
  },
  async createSession(repoPath, session) {
    const key = normalizePath(repoPath)
    if (sessionStore.has(key)) {
      return { success: false, reason: 'version_mismatch' }
    }
    const now = Date.now()
    sessionStore.set(key, {
      ...session,
      version: 1,
      createdAtMs: now,
      updatedAtMs: now
    })
    return { success: true }
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
