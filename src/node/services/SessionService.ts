import type { RebaseIntent, RebasePlan, RebaseState } from '@shared/types'

export type StoredRebaseSession = {
  intent: RebaseIntent
  state: RebaseState
  version: number
  createdAtMs: number
  updatedAtMs: number
  originalBranch: string
}

export type CasResult =
  | { success: true }
  | { success: false; reason: 'version_mismatch' | 'not_found' }

const sessions = new Map<string, StoredRebaseSession>()

function normalizePath(repoPath: string): string {
  return repoPath.replace(/\/+$/, '')
}

export async function getSession(repoPath: string): Promise<StoredRebaseSession | null> {
  return sessions.get(normalizePath(repoPath)) ?? null
}

export async function hasSession(repoPath: string): Promise<boolean> {
  return sessions.has(normalizePath(repoPath))
}

export async function getAllSessions(): Promise<Map<string, StoredRebaseSession>> {
  return new Map(sessions)
}

export async function createSession(
  repoPath: string,
  plan: RebasePlan,
  originalBranch: string
): Promise<void> {
  const key = normalizePath(repoPath)
  if (sessions.has(key)) {
    throw new Error('Session already exists')
  }

  const now = Date.now()
  sessions.set(key, {
    intent: plan.intent,
    state: plan.state,
    originalBranch,
    version: 1,
    createdAtMs: now,
    updatedAtMs: now
  })
}

export async function updateSession(
  repoPath: string,
  expectedVersion: number,
  updates: Partial<Pick<StoredRebaseSession, 'state' | 'intent'>>
): Promise<CasResult> {
  const key = normalizePath(repoPath)
  const existing = sessions.get(key)

  if (!existing) {
    return { success: false, reason: 'not_found' }
  }

  if (existing.version !== expectedVersion) {
    return { success: false, reason: 'version_mismatch' }
  }

  sessions.set(key, {
    ...existing,
    ...updates,
    version: existing.version + 1,
    updatedAtMs: Date.now()
  })

  return { success: true }
}

export async function clearSession(repoPath: string): Promise<void> {
  sessions.delete(normalizePath(repoPath))
}

export async function updateSessionWithRetry(
  repoPath: string,
  updater: (current: StoredRebaseSession) => Partial<Pick<StoredRebaseSession, 'state' | 'intent'>>,
  maxRetries = 3
): Promise<CasResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const current = await getSession(repoPath)
    if (!current) {
      return { success: false, reason: 'not_found' }
    }

    const updates = updater(current)
    const result = await updateSession(repoPath, current.version, updates)

    if (result.success) {
      return result
    }

    if (result.reason === 'version_mismatch' && attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
      continue
    }

    return result
  }

  return { success: false, reason: 'version_mismatch' }
}

export async function updateState(repoPath: string, state: RebaseState): Promise<void> {
  const result = await updateSessionWithRetry(repoPath, () => ({ state }))
  if (!result.success) {
    throw new Error(`Failed to update session state: ${result.reason}`)
  }
}

export async function markJobCompleted(
  repoPath: string,
  jobId: string,
  newSha: string
): Promise<void> {
  const result = await updateSessionWithRetry(repoPath, (current) => {
    const state: RebaseState = {
      ...current.state,
      jobsById: { ...current.state.jobsById }
    }
    const job = state.jobsById[jobId]
    if (job) {
      state.jobsById[jobId] = { ...job, status: 'completed', rebasedHeadSha: newSha }
    }
    return { state }
  })

  if (!result.success) {
    throw new Error(`Failed to mark job completed: ${result.reason}`)
  }
}

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

export class SessionNotFoundError extends Error {
  constructor(
    message: string,
    public readonly repoPath: string
  ) {
    super(message)
    this.name = 'SessionNotFoundError'
  }
}

export interface IRebaseSessionStore {
  getSession(repoPath: string): Promise<StoredRebaseSession | null>
  createSession(
    repoPath: string,
    session: Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'>
  ): Promise<CasResult>
  updateSession(
    repoPath: string,
    expectedVersion: number,
    updates: Partial<Pick<StoredRebaseSession, 'state' | 'intent'>>
  ): Promise<CasResult>
  clearSession(repoPath: string): Promise<void>
  getAllSessions(): Promise<Map<string, StoredRebaseSession>>
  hasSession(repoPath: string): Promise<boolean>
}

export const rebaseSessionStore: IRebaseSessionStore = {
  getSession,
  async createSession(repoPath, session) {
    const key = normalizePath(repoPath)
    if (sessions.has(key)) {
      return { success: false, reason: 'version_mismatch' }
    }
    const now = Date.now()
    sessions.set(key, {
      ...session,
      version: 1,
      createdAtMs: now,
      updatedAtMs: now
    })
    return { success: true }
  },
  updateSession,
  clearSession,
  getAllSessions,
  hasSession
}

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
