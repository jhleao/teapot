import type { RebaseIntent, RebaseState } from '@shared/types'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  InMemoryRebaseSessionStore,
  updateSessionWithRetry,
  SessionConcurrencyError,
  SessionNotFoundError,
  type StoredRebaseSession
} from '../rebase-session-store'

describe('InMemoryRebaseSessionStore', () => {
  let store: InMemoryRebaseSessionStore

  beforeEach(() => {
    store = new InMemoryRebaseSessionStore()
  })

  describe('getSession', () => {
    it('returns null for non-existent session', async () => {
      const session = await store.getSession('/path/to/repo')
      expect(session).toBeNull()
    })

    it('returns session after creation', async () => {
      await store.createSession('/path/to/repo', createSessionData())

      const session = await store.getSession('/path/to/repo')
      expect(session).not.toBeNull()
      expect(session?.originalBranch).toBe('main')
    })

    it('normalizes paths (removes trailing slash)', async () => {
      await store.createSession('/path/to/repo/', createSessionData())

      const session = await store.getSession('/path/to/repo')
      expect(session).not.toBeNull()
    })
  })

  describe('createSession', () => {
    it('creates session with version 1', async () => {
      const result = await store.createSession('/path/to/repo', createSessionData())

      expect(result.success).toBe(true)
      const session = await store.getSession('/path/to/repo')
      expect(session?.version).toBe(1)
    })

    it('sets createdAtMs and updatedAtMs', async () => {
      const before = Date.now()
      await store.createSession('/path/to/repo', createSessionData())
      const after = Date.now()

      const session = await store.getSession('/path/to/repo')
      expect(session?.createdAtMs).toBeGreaterThanOrEqual(before)
      expect(session?.createdAtMs).toBeLessThanOrEqual(after)
      expect(session?.updatedAtMs).toBe(session?.createdAtMs)
    })

    it('fails if session already exists', async () => {
      await store.createSession('/path/to/repo', createSessionData())
      const result = await store.createSession('/path/to/repo', createSessionData())

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('version_mismatch')
      }
    })
  })

  describe('updateSession', () => {
    it('updates session when version matches', async () => {
      await store.createSession('/path/to/repo', createSessionData())

      const newState = createState({ status: 'completed' })
      const result = await store.updateSession('/path/to/repo', 1, { state: newState })

      expect(result.success).toBe(true)

      const session = await store.getSession('/path/to/repo')
      expect(session?.state.session.status).toBe('completed')
      expect(session?.version).toBe(2)
    })

    it('updates updatedAtMs on update', async () => {
      await store.createSession('/path/to/repo', createSessionData())
      const sessionBefore = await store.getSession('/path/to/repo')

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      await store.updateSession('/path/to/repo', 1, { state: createState() })

      const sessionAfter = await store.getSession('/path/to/repo')
      expect(sessionAfter?.updatedAtMs).toBeGreaterThan(sessionBefore?.updatedAtMs ?? 0)
    })

    it('fails when version does not match', async () => {
      await store.createSession('/path/to/repo', createSessionData())

      const result = await store.updateSession('/path/to/repo', 999, { state: createState() })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('version_mismatch')
      }
    })

    it('fails when session does not exist', async () => {
      const result = await store.updateSession('/path/to/repo', 1, { state: createState() })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('not_found')
      }
    })

    it('increments version on each update', async () => {
      await store.createSession('/path/to/repo', createSessionData())

      await store.updateSession('/path/to/repo', 1, { state: createState() })
      await store.updateSession('/path/to/repo', 2, { state: createState() })
      await store.updateSession('/path/to/repo', 3, { state: createState() })

      const session = await store.getSession('/path/to/repo')
      expect(session?.version).toBe(4)
    })
  })

  describe('clearSession', () => {
    it('removes existing session', async () => {
      await store.createSession('/path/to/repo', createSessionData())
      await store.clearSession('/path/to/repo')

      const session = await store.getSession('/path/to/repo')
      expect(session).toBeNull()
    })

    it('does nothing for non-existent session', async () => {
      // Should not throw
      await store.clearSession('/path/to/nonexistent')
    })
  })

  describe('getAllSessions', () => {
    it('returns empty map when no sessions', async () => {
      const sessions = await store.getAllSessions()
      expect(sessions.size).toBe(0)
    })

    it('returns all active sessions', async () => {
      await store.createSession('/repo1', createSessionData())
      await store.createSession('/repo2', createSessionData())
      await store.createSession('/repo3', createSessionData())

      const sessions = await store.getAllSessions()
      expect(sessions.size).toBe(3)
      expect(sessions.has('/repo1')).toBe(true)
      expect(sessions.has('/repo2')).toBe(true)
      expect(sessions.has('/repo3')).toBe(true)
    })
  })

  describe('hasSession', () => {
    it('returns false for non-existent session', async () => {
      expect(await store.hasSession('/path/to/repo')).toBe(false)
    })

    it('returns true for existing session', async () => {
      await store.createSession('/path/to/repo', createSessionData())
      expect(await store.hasSession('/path/to/repo')).toBe(true)
    })
  })
})

describe('updateSessionWithRetry', () => {
  let store: InMemoryRebaseSessionStore

  beforeEach(() => {
    store = new InMemoryRebaseSessionStore()
  })

  it('updates session successfully on first try', async () => {
    await store.createSession('/path/to/repo', createSessionData())

    const result = await updateSessionWithRetry(store, '/path/to/repo', (current) => ({
      state: { ...current.state, session: { ...current.state.session, status: 'completed' } }
    }))

    expect(result.success).toBe(true)
  })

  it('returns not_found for non-existent session', async () => {
    const result = await updateSessionWithRetry(store, '/path/to/repo', () => ({
      state: createState()
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('not_found')
    }
  })

  it('passes current session to updater function', async () => {
    const originalData = createSessionData({ originalBranch: 'feature-branch' })
    await store.createSession('/path/to/repo', originalData)

    let receivedSession: StoredRebaseSession | null = null
    await updateSessionWithRetry(store, '/path/to/repo', (current) => {
      receivedSession = current
      return { state: current.state }
    })

    expect(receivedSession?.originalBranch).toBe('feature-branch')
  })
})

describe('Error classes', () => {
  it('SessionConcurrencyError has correct properties', () => {
    const error = new SessionConcurrencyError('test message', '/path/to/repo', 5)

    expect(error.message).toBe('test message')
    expect(error.name).toBe('SessionConcurrencyError')
    expect(error.repoPath).toBe('/path/to/repo')
    expect(error.expectedVersion).toBe(5)
  })

  it('SessionNotFoundError has correct properties', () => {
    const error = new SessionNotFoundError('test message', '/path/to/repo')

    expect(error.message).toBe('test message')
    expect(error.name).toBe('SessionNotFoundError')
    expect(error.repoPath).toBe('/path/to/repo')
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createSessionData(
  overrides: Partial<{
    intent: RebaseIntent
    state: RebaseState
    originalBranch: string
  }> = {}
): Omit<StoredRebaseSession, 'version' | 'createdAtMs' | 'updatedAtMs'> {
  return {
    intent: overrides.intent ?? createIntent(),
    state: overrides.state ?? createState(),
    originalBranch: overrides.originalBranch ?? 'main'
  }
}

function createIntent(): RebaseIntent {
  return {
    id: 'test-intent',
    createdAtMs: Date.now(),
    targets: []
  }
}

function createState(overrides: Partial<{ status: RebaseState['session']['status'] }> = {}): RebaseState {
  return {
    session: {
      id: 'test-session',
      startedAtMs: Date.now(),
      status: overrides.status ?? 'running',
      initialTrunkSha: 'abc123',
      jobs: [],
      commitMap: []
    },
    jobsById: {},
    queue: {
      pendingJobIds: [],
      blockedJobIds: []
    }
  }
}
