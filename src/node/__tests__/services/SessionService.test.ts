import type { RebaseIntent, RebasePlan, RebaseState } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  SessionService,
  SessionServiceInstance,
  updateState,
  type StoredRebaseSession
} from '../../services/SessionService'
import { createMockClock, createMockConfigStore } from '../../services/__tests__/test-utils'

describe('SessionService', () => {
  beforeEach(() => {
    // Reset the default instance to ensure clean state between tests
    SessionService.resetDefaultInstance()
    mockSessions.clear()
    const sessions = getAllSessions()
    for (const path of sessions.keys()) {
      clearSession(path)
    }
  })

  afterEach(() => {
    // Reset the default instance after each test
    SessionService.resetDefaultInstance()
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

  describe('instance-based architecture', () => {
    it('createInstance returns isolated instances', () => {
      const instance1 = SessionService.createInstance()
      const instance2 = SessionService.createInstance()

      expect(instance1).not.toBe(instance2)
      expect(instance1).toBeInstanceOf(SessionServiceInstance)
    })

    it('instances have independent session stores', () => {
      const mockStore1 = createMockConfigStore<StoredRebaseSession>()
      const mockStore2 = createMockConfigStore<StoredRebaseSession>()

      const instance1 = SessionService.createInstance({ configStore: mockStore1 })
      const instance2 = SessionService.createInstance({ configStore: mockStore2 })

      const plan = createPlan()
      instance1.createSession('/repo', plan, 'main')

      expect(instance1.hasSession('/repo')).toBe(true)
      expect(instance2.hasSession('/repo')).toBe(false)
    })

    it('reset() clears all instance state', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      instance.createSession('/repo', createPlan(), 'main')
      expect(instance.hasSession('/repo')).toBe(true)

      instance.reset()

      // In-memory cache is cleared, but the mock store still has it
      // This is expected behavior - reset only clears in-memory state
      expect(mockStore.hasRebaseSession('/repo')).toBe(true)
    })

    it('getDefaultInstance returns singleton', () => {
      const instance1 = SessionService.getDefaultInstance()
      const instance2 = SessionService.getDefaultInstance()

      expect(instance1).toBe(instance2)
    })

    it('resetDefaultInstance clears and nullifies default instance', () => {
      const instance1 = SessionService.getDefaultInstance()
      SessionService.resetDefaultInstance()

      const instance2 = SessionService.getDefaultInstance()
      expect(instance2).not.toBe(instance1)
    })
  })

  describe('mock clock integration', () => {
    it('uses injected clock for timestamps', () => {
      const clock = createMockClock(1000000)
      const mockStore = createMockConfigStore<StoredRebaseSession>()

      const instance = SessionService.createInstance({ clock, configStore: mockStore })

      instance.createSession('/repo', createPlan(), 'main')

      const session = instance.getSession('/repo')
      expect(session?.createdAtMs).toBe(1000000)
      expect(session?.updatedAtMs).toBe(1000000)
    })

    it('updates timestamp on state changes', () => {
      const clock = createMockClock(1000000)
      const mockStore = createMockConfigStore<StoredRebaseSession>()

      const instance = SessionService.createInstance({ clock, configStore: mockStore })

      instance.createSession('/repo', createPlan(), 'main')

      // Advance clock
      clock.advance(5000)

      instance.updateState('/repo', createState())

      const session = instance.getSession('/repo')
      expect(session?.createdAtMs).toBe(1000000)
      expect(session?.updatedAtMs).toBe(1005000)
    })
  })

  describe('createSession (instance method)', () => {
    it('creates session from plan', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      const plan = createPlan()
      instance.createSession('/repo', plan, 'feature-branch')

      const session = instance.getSession('/repo')
      expect(session).not.toBeNull()
      expect(session?.originalBranch).toBe('feature-branch')
      expect(session?.version).toBe(1)
    })

    it('throws if session already exists', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      instance.createSession('/repo', createPlan(), 'main')

      expect(() => instance.createSession('/repo', createPlan(), 'main')).toThrow(
        'Session already exists'
      )
    })
  })

  describe('markJobCompleted', () => {
    it('marks job as completed with new SHA', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      const plan = createPlanWithJob('job-1')
      instance.createSession('/repo', plan, 'main')

      instance.markJobCompleted('/repo', 'job-1', 'newsha123')

      const session = instance.getSession('/repo')
      const job = session?.state.jobsById['job-1']
      expect(job?.status).toBe('completed')
      expect(job?.rebasedHeadSha).toBe('newsha123')
    })

    it('increments version', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      const plan = createPlanWithJob('job-1')
      instance.createSession('/repo', plan, 'main')

      instance.markJobCompleted('/repo', 'job-1', 'newsha123')

      const session = instance.getSession('/repo')
      expect(session?.version).toBe(2)
    })

    it('throws if session not found', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      expect(() => instance.markJobCompleted('/repo', 'job-1', 'newsha123')).toThrow(
        'Session not found'
      )
    })

    it('throws if job not found', () => {
      const mockStore = createMockConfigStore<StoredRebaseSession>()
      const instance = SessionService.createInstance({ configStore: mockStore })

      instance.createSession('/repo', createPlan(), 'main')

      expect(() => instance.markJobCompleted('/repo', 'nonexistent-job', 'newsha123')).toThrow(
        'Job not found'
      )
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

function createPlan(): RebasePlan {
  return {
    intent: createIntent(),
    state: createState()
  }
}

function createPlanWithJob(jobId: string): RebasePlan {
  const state = createState()
  state.jobsById[jobId] = {
    id: jobId,
    branch: 'feature',
    originalBaseSha: 'abc123',
    originalHeadSha: 'def456',
    targetBaseSha: 'ghi789',
    status: 'queued',
    createdAtMs: Date.now()
  }
  return {
    intent: createIntent(),
    state
  }
}
