/**
 * RebasePhase Tests
 *
 * Tests for the explicit state machine that manages rebase operation phases.
 * These are pure functions - no I/O or mocks needed.
 */

import type { RebaseIntent, RebaseJob, RebaseState } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  canTransition,
  createIdlePhase,
  getPhaseDescription,
  InvalidTransitionError,
  transition,
  type CompletedPhase,
  type ConflictedPhase,
  type ErrorPhase,
  type ExecutingPhase,
  type FinalizingPhase,
  type PlanningPhase,
  type QueuedPhase
} from '../RebasePhase'

describe('RebasePhase', () => {
  describe('createIdlePhase', () => {
    it('creates idle phase with timestamp', () => {
      const before = Date.now()
      const phase = createIdlePhase()
      const after = Date.now()

      expect(phase.kind).toBe('idle')
      expect(phase.enteredAtMs).toBeGreaterThanOrEqual(before)
      expect(phase.enteredAtMs).toBeLessThanOrEqual(after)
      expect(phase.correlationId).toMatch(/^rebase-\d+-\w+$/)
    })

    it('uses provided correlation ID', () => {
      const phase = createIdlePhase('custom-id')

      expect(phase.correlationId).toBe('custom-id')
    })
  })

  describe('transition', () => {
    describe('idle phase transitions', () => {
      it('transitions to planning on SUBMIT_INTENT', () => {
        const idle = createIdlePhase()
        const intent = createIntent()
        const projectedState = createState()

        const result = transition(idle, {
          type: 'SUBMIT_INTENT',
          intent,
          projectedState
        })

        expect(result.kind).toBe('planning')
        const planning = result as PlanningPhase
        expect(planning.intent).toBe(intent)
        expect(planning.projectedState).toBe(projectedState)
        expect(planning.correlationId).toBe(idle.correlationId)
      })

      it('throws on invalid transition from idle', () => {
        const idle = createIdlePhase()

        expect(() => transition(idle, { type: 'CANCEL_INTENT' })).toThrow(InvalidTransitionError)
      })
    })

    describe('planning phase transitions', () => {
      it('transitions to idle on CANCEL_INTENT', () => {
        const planning = createPlanningPhase()

        const result = transition(planning, { type: 'CANCEL_INTENT' })

        expect(result.kind).toBe('idle')
        expect(result.correlationId).toBe(planning.correlationId)
      })

      it('transitions to queued on CONFIRM_INTENT', () => {
        const planning = createPlanningPhase()

        const result = transition(planning, {
          type: 'CONFIRM_INTENT',
          executionPath: '/path/to/worktree',
          isTemporaryWorktree: true
        })

        expect(result.kind).toBe('queued')
        const queued = result as QueuedPhase
        expect(queued.executionPath).toBe('/path/to/worktree')
        expect(queued.isTemporaryWorktree).toBe(true)
        expect(queued.intent).toBe(planning.intent)
        expect(queued.state).toBe(planning.projectedState)
      })

      it('throws on invalid transition from planning', () => {
        const planning = createPlanningPhase()

        expect(() => transition(planning, { type: 'JOB_STARTED', job: createJob() })).toThrow(
          InvalidTransitionError
        )
      })
    })

    describe('queued phase transitions', () => {
      it('transitions to executing on JOB_STARTED', () => {
        const queued = createQueuedPhase()
        const job = createJob()

        const result = transition(queued, { type: 'JOB_STARTED', job })

        expect(result.kind).toBe('executing')
        const executing = result as ExecutingPhase
        expect(executing.activeJob).toBe(job)
        expect(executing.executionPath).toBe(queued.executionPath)
        expect(executing.isTemporaryWorktree).toBe(queued.isTemporaryWorktree)
      })

      it('transitions to idle on ABORT', () => {
        const queued = createQueuedPhase()

        const result = transition(queued, { type: 'ABORT' })

        expect(result.kind).toBe('idle')
      })

      it('transitions to error on ERROR', () => {
        const queued = createQueuedPhase()

        const result = transition(queued, {
          type: 'ERROR',
          code: 'WORKTREE_CREATION_FAILED',
          message: 'Failed to create worktree',
          recoverable: true
        })

        expect(result.kind).toBe('error')
        const error = result as ErrorPhase
        expect(error.error.code).toBe('WORKTREE_CREATION_FAILED')
        expect(error.error.recoverable).toBe(true)
        expect(error.actions).toContain('retry')
        expect(error.actions).toContain('abort')
      })
    })

    describe('executing phase transitions', () => {
      it('stays in executing on JOB_COMPLETED', () => {
        const executing = createExecutingPhase()

        const result = transition(executing, {
          type: 'JOB_COMPLETED',
          job: executing.activeJob,
          newHeadSha: 'new-sha'
        })

        expect(result.kind).toBe('executing')
      })

      it('transitions to conflicted on CONFLICT_DETECTED', () => {
        const executing = createExecutingPhase()
        const conflicts = ['file1.ts', 'file2.ts']

        const result = transition(executing, {
          type: 'CONFLICT_DETECTED',
          job: executing.activeJob,
          conflicts
        })

        expect(result.kind).toBe('conflicted')
        const conflicted = result as ConflictedPhase
        expect(conflicted.conflictedJob).toBe(executing.activeJob)
        expect(conflicted.conflictFiles).toEqual(conflicts)
      })

      it('transitions to finalizing on ALL_JOBS_COMPLETE', () => {
        const executing = createExecutingPhase()

        const result = transition(executing, { type: 'ALL_JOBS_COMPLETE' })

        expect(result.kind).toBe('finalizing')
        const finalizing = result as FinalizingPhase
        expect(finalizing.intent).toBe(executing.intent)
        expect(finalizing.state).toBe(executing.state)
      })

      it('transitions to idle on ABORT', () => {
        const executing = createExecutingPhase()

        const result = transition(executing, { type: 'ABORT' })

        expect(result.kind).toBe('idle')
      })

      it('transitions to error on ERROR', () => {
        const executing = createExecutingPhase()

        const result = transition(executing, {
          type: 'ERROR',
          code: 'GIT_ERROR',
          message: 'Git command failed',
          recoverable: false
        })

        expect(result.kind).toBe('error')
        const error = result as ErrorPhase
        expect(error.error.recoverable).toBe(false)
        expect(error.actions).toContain('cleanup')
        expect(error.actions).not.toContain('retry')
      })
    })

    describe('conflicted phase transitions', () => {
      it('transitions to executing on CONTINUE_AFTER_RESOLVE', () => {
        const conflicted = createConflictedPhase()

        const result = transition(conflicted, { type: 'CONTINUE_AFTER_RESOLVE' })

        expect(result.kind).toBe('executing')
        const executing = result as ExecutingPhase
        expect(executing.activeJob).toBe(conflicted.conflictedJob)
      })

      it('transitions to idle on ABORT', () => {
        const conflicted = createConflictedPhase()

        const result = transition(conflicted, { type: 'ABORT' })

        expect(result.kind).toBe('idle')
      })

      it('transitions to error on ERROR', () => {
        const conflicted = createConflictedPhase()

        const result = transition(conflicted, {
          type: 'ERROR',
          code: 'CONFLICT_RESOLUTION_FAILED',
          message: 'Could not apply resolution',
          recoverable: true
        })

        expect(result.kind).toBe('error')
      })
    })

    describe('finalizing phase transitions', () => {
      it('transitions to completed on FINALIZE_COMPLETE', () => {
        const finalizing = createFinalizingPhase()
        const finalState = createState()

        const result = transition(finalizing, {
          type: 'FINALIZE_COMPLETE',
          finalState
        })

        expect(result.kind).toBe('completed')
        const completed = result as CompletedPhase
        expect(completed.finalState).toBe(finalState)
        expect(completed.durationMs).toBeGreaterThan(0)
      })

      it('transitions to error on ERROR', () => {
        const finalizing = createFinalizingPhase()

        const result = transition(finalizing, {
          type: 'ERROR',
          code: 'CLEANUP_FAILED',
          message: 'Could not remove temp worktree',
          recoverable: true
        })

        expect(result.kind).toBe('error')
      })
    })

    describe('completed phase transitions', () => {
      it('transitions to idle on CLEAR_COMPLETED', () => {
        const completed = createCompletedPhase()

        const result = transition(completed, { type: 'CLEAR_COMPLETED' })

        expect(result.kind).toBe('idle')
        // New correlation ID for fresh session
        expect(result.correlationId).not.toBe(completed.correlationId)
      })

      it('throws on invalid transition from completed', () => {
        const completed = createCompletedPhase()

        expect(() => transition(completed, { type: 'ABORT' })).toThrow(InvalidTransitionError)
      })
    })

    describe('error phase transitions', () => {
      it('transitions to idle on ACKNOWLEDGE_ERROR', () => {
        const error = createErrorPhase()

        const result = transition(error, { type: 'ACKNOWLEDGE_ERROR' })

        expect(result.kind).toBe('idle')
        expect(result.correlationId).toBe(error.correlationId)
      })

      it('throws on invalid transition from error', () => {
        const error = createErrorPhase()

        expect(() => transition(error, { type: 'ABORT' })).toThrow(InvalidTransitionError)
      })
    })
  })

  describe('canTransition', () => {
    it('returns true for valid transitions', () => {
      expect(canTransition(createIdlePhase(), 'SUBMIT_INTENT')).toBe(true)
      expect(canTransition(createPlanningPhase(), 'CONFIRM_INTENT')).toBe(true)
      expect(canTransition(createPlanningPhase(), 'CANCEL_INTENT')).toBe(true)
      expect(canTransition(createQueuedPhase(), 'JOB_STARTED')).toBe(true)
      expect(canTransition(createQueuedPhase(), 'ABORT')).toBe(true)
      expect(canTransition(createExecutingPhase(), 'CONFLICT_DETECTED')).toBe(true)
      expect(canTransition(createConflictedPhase(), 'CONTINUE_AFTER_RESOLVE')).toBe(true)
      expect(canTransition(createFinalizingPhase(), 'FINALIZE_COMPLETE')).toBe(true)
      expect(canTransition(createCompletedPhase(), 'CLEAR_COMPLETED')).toBe(true)
      expect(canTransition(createErrorPhase(), 'ACKNOWLEDGE_ERROR')).toBe(true)
    })

    it('returns false for invalid transitions', () => {
      expect(canTransition(createIdlePhase(), 'CANCEL_INTENT')).toBe(false)
      expect(canTransition(createIdlePhase(), 'JOB_STARTED')).toBe(false)
      expect(canTransition(createPlanningPhase(), 'JOB_STARTED')).toBe(false)
      expect(canTransition(createQueuedPhase(), 'CONFLICT_DETECTED')).toBe(false)
      expect(canTransition(createCompletedPhase(), 'ABORT')).toBe(false)
      expect(canTransition(createErrorPhase(), 'ABORT')).toBe(false)
    })
  })

  describe('getPhaseDescription', () => {
    it('describes idle phase', () => {
      const desc = getPhaseDescription(createIdlePhase())
      expect(desc).toBe('No rebase in progress')
    })

    it('describes planning phase with target count', () => {
      const desc = getPhaseDescription(createPlanningPhase())
      expect(desc).toContain('Planning rebase')
      expect(desc).toContain('branch')
    })

    it('describes queued phase with job count', () => {
      const desc = getPhaseDescription(createQueuedPhase())
      expect(desc).toContain('Ready to rebase')
    })

    it('describes executing phase with branch name', () => {
      const desc = getPhaseDescription(createExecutingPhase())
      expect(desc).toContain('Rebasing')
      expect(desc).toContain('feature')
    })

    it('describes conflicted phase with file count', () => {
      const desc = getPhaseDescription(createConflictedPhase())
      expect(desc).toContain('Conflict')
      expect(desc).toContain('feature')
    })

    it('describes finalizing phase', () => {
      const desc = getPhaseDescription(createFinalizingPhase())
      expect(desc).toBe('Finalizing rebase')
    })

    it('describes completed phase with duration', () => {
      const desc = getPhaseDescription(createCompletedPhase())
      expect(desc).toContain('completed')
    })

    it('describes error phase with message', () => {
      const desc = getPhaseDescription(createErrorPhase())
      expect(desc).toContain('Error')
      expect(desc).toContain('Something went wrong')
    })
  })

  describe('InvalidTransitionError', () => {
    it('contains transition details', () => {
      const error = new InvalidTransitionError('idle', 'ABORT', 'Cannot abort from idle')

      expect(error.name).toBe('InvalidTransitionError')
      expect(error.fromPhase).toBe('idle')
      expect(error.eventType).toBe('ABORT')
      expect(error.reason).toBe('Cannot abort from idle')
      expect(error.message).toContain('idle')
      expect(error.message).toContain('ABORT')
    })
  })

  describe('phase preservation', () => {
    it('preserves correlation ID through transitions', () => {
      const idle = createIdlePhase('test-correlation')
      const intent = createIntent()
      const state = createState()

      const planning = transition(idle, {
        type: 'SUBMIT_INTENT',
        intent,
        projectedState: state
      }) as PlanningPhase

      const queued = transition(planning, {
        type: 'CONFIRM_INTENT',
        executionPath: '/path',
        isTemporaryWorktree: false
      }) as QueuedPhase

      const executing = transition(queued, {
        type: 'JOB_STARTED',
        job: createJob()
      }) as ExecutingPhase

      expect(planning.correlationId).toBe('test-correlation')
      expect(queued.correlationId).toBe('test-correlation')
      expect(executing.correlationId).toBe('test-correlation')
    })

    it('preserves state through execution phases', () => {
      const intent = createIntent()
      const state = createState()
      const planning = createPlanningPhase(intent, state)

      const queued = transition(planning, {
        type: 'CONFIRM_INTENT',
        executionPath: '/path',
        isTemporaryWorktree: true
      }) as QueuedPhase

      expect(queued.intent).toBe(intent)
      expect(queued.state).toBe(state)
      expect(queued.isTemporaryWorktree).toBe(true)
    })
  })

  describe('error recovery options', () => {
    it('provides retry and abort for recoverable errors', () => {
      const executing = createExecutingPhase()
      const error = transition(executing, {
        type: 'ERROR',
        code: 'TEMP_FAILURE',
        message: 'Temporary issue',
        recoverable: true
      }) as ErrorPhase

      expect(error.actions).toContain('retry')
      expect(error.actions).toContain('abort')
    })

    it('provides only cleanup for unrecoverable errors', () => {
      const executing = createExecutingPhase()
      const error = transition(executing, {
        type: 'ERROR',
        code: 'FATAL',
        message: 'Fatal error',
        recoverable: false
      }) as ErrorPhase

      expect(error.actions).toContain('cleanup')
      expect(error.actions).not.toContain('retry')
    })

    it('preserves state in error phase for potential recovery', () => {
      const executing = createExecutingPhase()
      const error = transition(executing, {
        type: 'ERROR',
        code: 'TEMP',
        message: 'Error',
        recoverable: true
      }) as ErrorPhase

      expect(error.state).toBe(executing.state)
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
          headSha: 'head',
          baseSha: 'base',
          ownedShas: ['head'],
          children: []
        },
        targetBaseSha: 'target'
      }
    ]
  }
}

function createState(): RebaseState {
  return {
    session: {
      id: 'session',
      startedAtMs: Date.now(),
      status: 'pending',
      initialTrunkSha: 'trunk',
      jobs: ['job-1'],
      commitMap: []
    },
    jobsById: {
      'job-1': {
        id: 'job-1',
        branch: 'feature',
        originalBaseSha: 'base',
        originalHeadSha: 'head',
        targetBaseSha: 'target',
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

function createJob(): RebaseJob {
  return {
    id: 'job-1',
    branch: 'feature',
    originalBaseSha: 'base',
    originalHeadSha: 'head',
    targetBaseSha: 'target',
    status: 'applying',
    createdAtMs: Date.now()
  }
}

function createPlanningPhase(
  intent: RebaseIntent = createIntent(),
  state: RebaseState = createState()
): PlanningPhase {
  return {
    kind: 'planning',
    enteredAtMs: Date.now(),
    correlationId: 'test-correlation',
    intent,
    projectedState: state
  }
}

function createQueuedPhase(): QueuedPhase {
  return {
    kind: 'queued',
    enteredAtMs: Date.now(),
    correlationId: 'test-correlation',
    intent: createIntent(),
    state: createState(),
    executionPath: '/test/path',
    isTemporaryWorktree: false
  }
}

function createExecutingPhase(): ExecutingPhase {
  return {
    kind: 'executing',
    enteredAtMs: Date.now(),
    correlationId: 'test-correlation',
    intent: createIntent(),
    state: createState(),
    executionPath: '/test/path',
    isTemporaryWorktree: false,
    activeJob: createJob()
  }
}

function createConflictedPhase(): ConflictedPhase {
  return {
    kind: 'conflicted',
    enteredAtMs: Date.now(),
    correlationId: 'test-correlation',
    intent: createIntent(),
    state: createState(),
    executionPath: '/test/path',
    isTemporaryWorktree: false,
    conflictedJob: createJob(),
    conflictFiles: ['file.ts']
  }
}

function createFinalizingPhase(): FinalizingPhase {
  return {
    kind: 'finalizing',
    enteredAtMs: Date.now() - 1000, // Started 1 second ago
    correlationId: 'test-correlation',
    intent: createIntent(),
    state: createState(),
    executionPath: '/test/path',
    isTemporaryWorktree: false
  }
}

function createCompletedPhase(): CompletedPhase {
  return {
    kind: 'completed',
    enteredAtMs: Date.now(),
    correlationId: 'test-correlation',
    finalState: createState(),
    durationMs: 5000
  }
}

function createErrorPhase(): ErrorPhase {
  return {
    kind: 'error',
    enteredAtMs: Date.now(),
    correlationId: 'test-correlation',
    error: {
      code: 'TEST_ERROR',
      message: 'Something went wrong',
      recoverable: true
    },
    state: createState(),
    actions: ['retry', 'abort']
  }
}
