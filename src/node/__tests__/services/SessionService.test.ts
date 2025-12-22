import type { RebaseIntent, RebaseState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron-store with in-memory implementation
const mockSessions = new Map<string, unknown>()
vi.mock('../../store', () => ({
  configStore: {
    getRebaseSession: (key: string) => mockSessions.get(key) ?? null,
    setRebaseSession: (key: string, session: unknown) => mockSessions.set(key, session),
    deleteRebaseSession: (key: string) => mockSessions.delete(key),
    hasRebaseSession: (key: string) => mockSessions.has(key)
  },
  ConfigStore: class {}
}))

import {
  clearSession,
  getAllSessions,
  getSession,
  hasSession,
  rebaseSessionStore,
  updateState,
  type StoredRebaseSession
} from '../../services/SessionService'

describe('SessionService', () => {
  beforeEach(() => {
    mockSessions.clear()
    const sessions = getAllSessions()
    for (const path of sessions.keys()) {
      clearSession(path)
    }
  })

  describe('getSession', () => {
    it('returns null for non-existent session', () => {
      const session = getSession('/path/to/repo')
      expect(session).toBeNull()
    })

    it('returns session after creation', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())

      const session = getSession('/path/to/repo')
      expect(session).not.toBeNull()
      expect(session?.originalBranch).toBe('main')
    })

    it('normalizes paths (removes trailing slash)', async () => {
      await rebaseSessionStore.createSession('/path/to/repo/', createSessionData())

      const session = getSession('/path/to/repo')
      expect(session).not.toBeNull()
    })
  })

  describe('createSession (via rebaseSessionStore)', () => {
    it('creates session with version 1', async () => {
      const result = await rebaseSessionStore.createSession('/path/to/repo', createSessionData())

      expect(result.success).toBe(true)
      const session = getSession('/path/to/repo')
      expect(session?.version).toBe(1)
    })

    it('sets createdAtMs and updatedAtMs', async () => {
      const before = Date.now()
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())
      const after = Date.now()

      const session = getSession('/path/to/repo')
      expect(session?.createdAtMs).toBeGreaterThanOrEqual(before)
      expect(session?.createdAtMs).toBeLessThanOrEqual(after)
      expect(session?.updatedAtMs).toBe(session?.createdAtMs)
    })

    it('fails if session already exists', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())
      const result = await rebaseSessionStore.createSession('/path/to/repo', createSessionData())

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('version_mismatch')
      }
    })
  })

  describe('updateState', () => {
    it('updates session state', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())

      const newState = createState({ status: 'completed' })
      updateState('/path/to/repo', newState)

      const session = getSession('/path/to/repo')
      expect(session?.state.session.status).toBe('completed')
    })

    it('increments version on update', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())

      updateState('/path/to/repo', createState())
      expect(getSession('/path/to/repo')?.version).toBe(2)

      updateState('/path/to/repo', createState())
      expect(getSession('/path/to/repo')?.version).toBe(3)
    })

    it('updates updatedAtMs on update', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())
      const sessionBefore = getSession('/path/to/repo')

      await new Promise((resolve) => setTimeout(resolve, 10))

      updateState('/path/to/repo', createState())

      const sessionAfter = getSession('/path/to/repo')
      expect(sessionAfter?.updatedAtMs).toBeGreaterThan(sessionBefore?.updatedAtMs ?? 0)
    })

    it('throws when session does not exist', () => {
      expect(() => updateState('/path/to/repo', createState())).toThrow('Session not found')
    })
  })

  describe('clearSession', () => {
    it('removes existing session', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())
      clearSession('/path/to/repo')

      const session = getSession('/path/to/repo')
      expect(session).toBeNull()
    })

    it('does nothing for non-existent session', () => {
      // Should not throw
      clearSession('/path/to/nonexistent')
    })
  })

  describe('getAllSessions', () => {
    it('returns empty map when no sessions', () => {
      const sessions = getAllSessions()
      expect(sessions.size).toBe(0)
    })

    it('returns all active sessions', async () => {
      await rebaseSessionStore.createSession('/repo1', createSessionData())
      await rebaseSessionStore.createSession('/repo2', createSessionData())
      await rebaseSessionStore.createSession('/repo3', createSessionData())

      const sessions = getAllSessions()
      expect(sessions.size).toBe(3)
      expect(sessions.has('/repo1')).toBe(true)
      expect(sessions.has('/repo2')).toBe(true)
      expect(sessions.has('/repo3')).toBe(true)
    })
  })

  describe('hasSession', () => {
    it('returns false for non-existent session', () => {
      expect(hasSession('/path/to/repo')).toBe(false)
    })

    it('returns true for existing session', async () => {
      await rebaseSessionStore.createSession('/path/to/repo', createSessionData())
      expect(hasSession('/path/to/repo')).toBe(true)
    })
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

function createState(
  overrides: Partial<{ status: RebaseState['session']['status'] }> = {}
): RebaseState {
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
      pendingJobIds: []
    }
  }
}
