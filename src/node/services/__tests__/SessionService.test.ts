/**
 * SessionService Tests
 *
 * Tests for the two-tier write-through cache that persists rebase sessions.
 * Tests session recovery after simulated crashes.
 */

import type { RebaseIntent, RebasePlan, RebaseState } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the configStore before importing SessionService
const mockDiskStore = new Map<string, unknown>()

vi.mock('../../store', () => ({
  configStore: {
    getRebaseSession: (key: string) => mockDiskStore.get(key) ?? null,
    setRebaseSession: (key: string, session: unknown) => mockDiskStore.set(key, session),
    deleteRebaseSession: (key: string) => mockDiskStore.delete(key),
    hasRebaseSession: (key: string) => mockDiskStore.has(key)
  }
}))

// Import after mock is set up
import {
  clearSession,
  createSession,
  createStoredSession,
  getSession,
  hasSession,
  updateState,
  type StoredRebaseSession
} from '../SessionService'

describe('SessionService', () => {
  // Test repo paths - use unique paths to avoid cross-test pollution
  // since the module-level memory cache persists across tests
  let testRepoPath: string

  beforeEach(() => {
    mockDiskStore.clear()
    // Use unique path for each test to avoid memory cache pollution
    testRepoPath = `/test-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterEach(() => {
    // Clean up any sessions that were created
    try {
      clearSession(testRepoPath)
    } catch {
      // Ignore
    }
    mockDiskStore.clear()
  })

  describe('createSession', () => {
    it('creates session with initial state', () => {
      const plan = createPlan()

      createSession(testRepoPath, plan, 'feature')

      const session = getSession(testRepoPath)
      expect(session).not.toBeNull()
      expect(session!.intent).toEqual(plan.intent)
      expect(session!.state).toEqual(plan.state)
      expect(session!.originalBranch).toBe('feature')
      expect(session!.version).toBe(1)
    })

    it('throws when session already exists', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      expect(() => createSession(testRepoPath, plan, 'feature')).toThrow('Session already exists')
    })

    it('normalizes trailing slashes in path', () => {
      const plan = createPlan()
      const pathWithSlash = testRepoPath + '/'

      createSession(pathWithSlash, plan, 'feature')

      // Should be accessible with or without trailing slash
      expect(getSession(testRepoPath)).not.toBeNull()
      expect(getSession(pathWithSlash)).not.toBeNull()
    })

    it('sets timestamps on creation', () => {
      const plan = createPlan()
      const before = Date.now()

      createSession(testRepoPath, plan, 'feature')

      const session = getSession(testRepoPath)
      const after = Date.now()
      expect(session!.createdAtMs).toBeGreaterThanOrEqual(before)
      expect(session!.createdAtMs).toBeLessThanOrEqual(after)
      expect(session!.updatedAtMs).toEqual(session!.createdAtMs)
    })
  })

  describe('getSession', () => {
    it('returns null for non-existent session', () => {
      const session = getSession('/nonexistent')
      expect(session).toBeNull()
    })

    it('returns session from memory cache', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      const session = getSession(testRepoPath)
      expect(session).not.toBeNull()
    })

    it('recovers session from disk when not in memory', () => {
      // Simulate writing directly to disk (bypassing memory cache)
      const storedSession = createStoredSessionData()
      mockDiskStore.set(testRepoPath, storedSession)

      const session = getSession(testRepoPath)
      expect(session).not.toBeNull()
      expect(session!.originalBranch).toBe('feature')
    })
  })

  describe('hasSession', () => {
    it('returns false for non-existent session', () => {
      expect(hasSession('/nonexistent')).toBe(false)
    })

    it('returns true for existing session', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      expect(hasSession(testRepoPath)).toBe(true)
    })

    it('checks disk if not in memory', () => {
      mockDiskStore.set(testRepoPath, createStoredSessionData())

      expect(hasSession(testRepoPath)).toBe(true)
    })
  })

  describe('updateState', () => {
    it('updates session state and increments version', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      const newState = {
        ...plan.state,
        session: { ...plan.state.session, status: 'running' as const }
      }
      updateState(testRepoPath, newState)

      const session = getSession(testRepoPath)
      expect(session!.state.session.status).toBe('running')
      expect(session!.version).toBe(2)
    })

    it('throws when session does not exist', () => {
      expect(() => updateState('/nonexistent', createState())).toThrow('Session not found')
    })

    it('updates timestamp on state change', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      const newState = {
        ...plan.state,
        session: { ...plan.state.session, status: 'running' as const }
      }
      const beforeUpdate = Date.now()
      updateState(testRepoPath, newState)
      const afterUpdate = Date.now()

      const session = getSession(testRepoPath)
      // Timestamp should be within the update window
      expect(session!.updatedAtMs).toBeGreaterThanOrEqual(beforeUpdate)
      expect(session!.updatedAtMs).toBeLessThanOrEqual(afterUpdate)
    })

    it('persists state to disk', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      const newState = {
        ...plan.state,
        session: { ...plan.state.session, status: 'running' as const }
      }
      updateState(testRepoPath, newState)

      // Check disk directly
      const diskSession = mockDiskStore.get(testRepoPath) as StoredRebaseSession
      expect(diskSession.state.session.status).toBe('running')
    })
  })

  describe('clearSession', () => {
    it('removes session from memory and disk', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      clearSession(testRepoPath)

      expect(getSession(testRepoPath)).toBeNull()
      expect(hasSession(testRepoPath)).toBe(false)
      expect(mockDiskStore.has(testRepoPath)).toBe(false)
    })

    it('handles non-existent session gracefully', () => {
      // Should not throw
      clearSession('/nonexistent')
      expect(hasSession('/nonexistent')).toBe(false)
    })
  })

  describe('createStoredSession', () => {
    it('creates session data structure from plan', () => {
      const plan = createPlan()

      const stored = createStoredSession(plan, 'feature')

      expect(stored.intent).toBe(plan.intent)
      expect(stored.state).toBe(plan.state)
      expect(stored.originalBranch).toBe('feature')
    })
  })

  describe('Session Recovery', () => {
    it('recovers session state after simulated crash', () => {
      // Create session (writes to disk)
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      // Update state (writes to disk)
      const runningState = {
        ...plan.state,
        session: { ...plan.state.session, status: 'running' as const },
        queue: { ...plan.state.queue, activeJobId: 'job-1' }
      }
      updateState(testRepoPath, runningState)

      // Simulate crash by clearing the session service's in-memory state
      // but keeping disk state intact
      // Note: In real scenario, the module would be reloaded
      // Here we verify disk state is correct
      const diskSession = mockDiskStore.get(testRepoPath) as StoredRebaseSession
      expect(diskSession.state.session.status).toBe('running')
      expect(diskSession.state.queue.activeJobId).toBe('job-1')
    })

    it('recovers from disk when memory cache is empty', () => {
      // Directly set disk state (simulating persisted session from before crash)
      const storedSession = createStoredSessionData()
      storedSession.state.session.status = 'awaiting-user'
      storedSession.state.queue.activeJobId = 'job-1'
      mockDiskStore.set(testRepoPath, storedSession)

      // Simulate app restart - getSession should load from disk
      const session = getSession(testRepoPath)

      expect(session).not.toBeNull()
      expect(session!.state.session.status).toBe('awaiting-user')
      expect(session!.state.queue.activeJobId).toBe('job-1')
    })

    it('preserves job queue state through recovery', () => {
      const storedSession = createStoredSessionData()
      storedSession.state.queue.pendingJobIds = ['job-2', 'job-3']
      storedSession.state.queue.activeJobId = 'job-1'
      mockDiskStore.set(testRepoPath, storedSession)

      const session = getSession(testRepoPath)

      expect(session!.state.queue.pendingJobIds).toEqual(['job-2', 'job-3'])
      expect(session!.state.queue.activeJobId).toBe('job-1')
    })

    it('preserves commit map through recovery', () => {
      const storedSession = createStoredSessionData()
      storedSession.state.session.commitMap = [
        { branch: 'feature', oldSha: 'old1', newSha: 'new1' },
        { branch: 'feature', oldSha: 'old2', newSha: 'new2' }
      ]
      mockDiskStore.set(testRepoPath, storedSession)

      const session = getSession(testRepoPath)

      expect(session!.state.session.commitMap).toHaveLength(2)
      expect(session!.state.session.commitMap[0]!.oldSha).toBe('old1')
    })

    it('preserves conflict information through recovery', () => {
      const storedSession = createStoredSessionData()
      storedSession.state.jobsById['job-1']!.status = 'awaiting-user'
      storedSession.state.jobsById['job-1']!.conflicts = [
        { path: 'file.ts', stages: { oursSha: 'abc', theirsSha: 'def' }, resolved: false }
      ]
      mockDiskStore.set(testRepoPath, storedSession)

      const session = getSession(testRepoPath)

      const job = session!.state.jobsById['job-1']!
      expect(job.status).toBe('awaiting-user')
      expect(job.conflicts).toHaveLength(1)
      expect(job.conflicts![0]!.path).toBe('file.ts')
    })

  })

  describe('Queue State Management', () => {
    it('tracks job progression through queue', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      // Start first job
      let state = getSession(testRepoPath)!.state
      state = {
        ...state,
        queue: { activeJobId: 'job-1', pendingJobIds: ['job-2', 'job-3'] }
      }
      updateState(testRepoPath, state)

      expect(getSession(testRepoPath)!.state.queue.activeJobId).toBe('job-1')
      expect(getSession(testRepoPath)!.state.queue.pendingJobIds).toEqual(['job-2', 'job-3'])

      // Complete first job, start second
      state = {
        ...state,
        queue: { activeJobId: 'job-2', pendingJobIds: ['job-3'] },
        jobsById: {
          ...state.jobsById,
          'job-1': { ...state.jobsById['job-1']!, status: 'completed', rebasedHeadSha: 'new-sha' }
        }
      }
      updateState(testRepoPath, state)

      expect(getSession(testRepoPath)!.state.queue.activeJobId).toBe('job-2')
      expect(getSession(testRepoPath)!.state.queue.pendingJobIds).toEqual(['job-3'])
      expect(getSession(testRepoPath)!.state.jobsById['job-1']!.status).toBe('completed')
    })

    it('handles empty queue after all jobs complete', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      const state = {
        ...plan.state,
        session: { ...plan.state.session, status: 'completed' as const },
        queue: { activeJobId: undefined, pendingJobIds: [] }
      }
      updateState(testRepoPath, state)

      const session = getSession(testRepoPath)
      expect(session!.state.queue.activeJobId).toBeUndefined()
      expect(session!.state.queue.pendingJobIds).toHaveLength(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles concurrent updates (version tracking)', () => {
      const plan = createPlan()
      createSession(testRepoPath, plan, 'feature')

      // Multiple updates
      for (let i = 0; i < 5; i++) {
        const state = { ...getSession(testRepoPath)!.state }
        updateState(testRepoPath, state)
      }

      expect(getSession(testRepoPath)!.version).toBe(6) // 1 initial + 5 updates
    })

    it('handles paths with special characters', () => {
      const plan = createPlan()

      createSession('/path/with spaces/repo', plan, 'feature')

      expect(hasSession('/path/with spaces/repo')).toBe(true)
    })

    it('treats different paths as different sessions', () => {
      const plan = createPlan()

      createSession('/repo1', plan, 'feature1')
      createSession('/repo2', plan, 'feature2')

      expect(getSession('/repo1')!.originalBranch).toBe('feature1')
      expect(getSession('/repo2')!.originalBranch).toBe('feature2')
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createIntent(): RebaseIntent {
  return {
    id: `intent-${Date.now()}`,
    createdAtMs: Date.now(),
    targets: [
      {
        node: {
          branch: 'feature',
          headSha: 'head-sha',
          baseSha: 'base-sha',
          ownedShas: ['head-sha'],
          children: []
        },
        targetBaseSha: 'target-sha'
      }
    ]
  }
}

function createState(): RebaseState {
  return {
    session: {
      id: 'session-id',
      startedAtMs: Date.now(),
      status: 'pending',
      initialTrunkSha: 'trunk-sha',
      jobs: ['job-1'],
      commitMap: []
    },
    jobsById: {
      'job-1': {
        id: 'job-1',
        branch: 'feature',
        originalBaseSha: 'base-sha',
        originalHeadSha: 'head-sha',
        targetBaseSha: 'target-sha',
        status: 'queued',
        createdAtMs: Date.now()
      }
    },
    queue: {
      activeJobId: undefined,
      pendingJobIds: ['job-1']
    }
  }
}

function createPlan(): RebasePlan {
  return {
    intent: createIntent(),
    state: createState()
  }
}

function createStoredSessionData(): StoredRebaseSession {
  return {
    intent: createIntent(),
    state: createState(),
    originalBranch: 'feature',
    version: 1,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now()
  }
}
