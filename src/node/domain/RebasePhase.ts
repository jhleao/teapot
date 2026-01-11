/**
 * RebasePhase - Explicit State Machine for Rebase Operations
 *
 * This module defines the explicit phases of a rebase operation and
 * valid transitions between them. It provides type-safe state transitions
 * that make it impossible to reach invalid states.
 *
 * Phases:
 * - idle: No rebase operation active
 * - planning: User is previewing/configuring rebase intent
 * - queued: Intent confirmed, waiting to start execution
 * - executing: Git rebase in progress
 * - conflicted: Rebase paused due to conflict
 * - finalizing: All jobs done, cleaning up
 * - completed: Rebase finished successfully
 * - error: Rebase failed with error
 *
 * Valid Transitions:
 *   idle -> planning (user drags branch)
 *   planning -> idle (user cancels)
 *   planning -> queued (user confirms)
 *   queued -> executing (job starts)
 *   executing -> conflicted (conflict detected)
 *   executing -> executing (job completes, next job starts)
 *   executing -> finalizing (all jobs done)
 *   conflicted -> executing (user resolves and continues)
 *   conflicted -> idle (user aborts)
 *   finalizing -> completed (cleanup done)
 *   finalizing -> error (cleanup failed)
 *   error -> idle (error acknowledged)
 *   completed -> idle (session cleared)
 */

import type { RebaseIntent, RebaseJob, RebaseState } from '@shared/types'

/**
 * Base phase data shared by all phases.
 */
interface PhaseBase {
  /** When this phase was entered */
  enteredAtMs: number
  /** ID for correlation across logs */
  correlationId: string
}

/**
 * No rebase operation is active.
 */
export interface IdlePhase extends PhaseBase {
  kind: 'idle'
}

/**
 * User is previewing/configuring a rebase intent.
 * The UI shows the projected state with "prompting" status.
 */
export interface PlanningPhase extends PhaseBase {
  kind: 'planning'
  intent: RebaseIntent
  /** Projected state if rebase were to execute */
  projectedState: RebaseState
}

/**
 * User confirmed the intent, session created, waiting to start.
 */
export interface QueuedPhase extends PhaseBase {
  kind: 'queued'
  intent: RebaseIntent
  state: RebaseState
  /** Path where execution will happen (active or temp worktree) */
  executionPath: string
  /** Whether using a temp worktree */
  isTemporaryWorktree: boolean
}

/**
 * Git rebase is actively running.
 */
export interface ExecutingPhase extends PhaseBase {
  kind: 'executing'
  intent: RebaseIntent
  state: RebaseState
  executionPath: string
  isTemporaryWorktree: boolean
  /** Currently executing job */
  activeJob: RebaseJob
}

/**
 * Rebase paused due to merge conflict.
 */
export interface ConflictedPhase extends PhaseBase {
  kind: 'conflicted'
  intent: RebaseIntent
  state: RebaseState
  executionPath: string
  isTemporaryWorktree: boolean
  /** Job that hit the conflict */
  conflictedJob: RebaseJob
  /** Files with conflicts */
  conflictFiles: string[]
}

/**
 * All jobs complete, performing cleanup.
 */
export interface FinalizingPhase extends PhaseBase {
  kind: 'finalizing'
  intent: RebaseIntent
  state: RebaseState
  executionPath: string
  isTemporaryWorktree: boolean
}

/**
 * Rebase completed successfully.
 */
export interface CompletedPhase extends PhaseBase {
  kind: 'completed'
  finalState: RebaseState
  /** Duration of the entire rebase operation */
  durationMs: number
}

/**
 * Rebase failed with an error.
 */
export interface ErrorPhase extends PhaseBase {
  kind: 'error'
  error: {
    code: string
    message: string
    recoverable: boolean
  }
  /** State at time of error, if available */
  state?: RebaseState
  /** Available recovery actions */
  actions: ('retry' | 'abort' | 'cleanup')[]
}

/**
 * Union type for all possible phases.
 */
export type RebasePhase =
  | IdlePhase
  | PlanningPhase
  | QueuedPhase
  | ExecutingPhase
  | ConflictedPhase
  | FinalizingPhase
  | CompletedPhase
  | ErrorPhase

/**
 * Events that can trigger phase transitions.
 */
export type RebaseEvent =
  | { type: 'SUBMIT_INTENT'; intent: RebaseIntent; projectedState: RebaseState }
  | { type: 'CANCEL_INTENT' }
  | { type: 'CONFIRM_INTENT'; executionPath: string; isTemporaryWorktree: boolean }
  | { type: 'JOB_STARTED'; job: RebaseJob }
  | { type: 'JOB_COMPLETED'; job: RebaseJob; newHeadSha: string }
  | { type: 'CONFLICT_DETECTED'; job: RebaseJob; conflicts: string[] }
  | { type: 'CONTINUE_AFTER_RESOLVE' }
  | { type: 'ABORT' }
  | { type: 'ALL_JOBS_COMPLETE' }
  | { type: 'FINALIZE_COMPLETE'; finalState: RebaseState }
  | { type: 'ERROR'; code: string; message: string; recoverable: boolean }
  | { type: 'ACKNOWLEDGE_ERROR' }
  | { type: 'CLEAR_COMPLETED' }

/**
 * Create initial idle phase.
 */
export function createIdlePhase(correlationId?: string): IdlePhase {
  return {
    kind: 'idle',
    enteredAtMs: Date.now(),
    correlationId: correlationId ?? generateCorrelationId()
  }
}

/**
 * Pure state transition function.
 * Given current phase and event, returns new phase.
 * Throws if transition is invalid.
 */
export function transition(phase: RebasePhase, event: RebaseEvent): RebasePhase {
  const now = Date.now()

  switch (event.type) {
    case 'SUBMIT_INTENT': {
      if (phase.kind !== 'idle') {
        throw new InvalidTransitionError(phase.kind, event.type, 'Can only submit intent from idle')
      }
      return {
        kind: 'planning',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        intent: event.intent,
        projectedState: event.projectedState
      }
    }

    case 'CANCEL_INTENT': {
      if (phase.kind !== 'planning') {
        throw new InvalidTransitionError(phase.kind, event.type, 'Can only cancel from planning')
      }
      return createIdlePhase(phase.correlationId)
    }

    case 'CONFIRM_INTENT': {
      if (phase.kind !== 'planning') {
        throw new InvalidTransitionError(phase.kind, event.type, 'Can only confirm from planning')
      }
      return {
        kind: 'queued',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        intent: phase.intent,
        state: phase.projectedState,
        executionPath: event.executionPath,
        isTemporaryWorktree: event.isTemporaryWorktree
      }
    }

    case 'JOB_STARTED': {
      if (phase.kind !== 'queued' && phase.kind !== 'executing') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only start job from queued or executing'
        )
      }
      const basePhase = phase.kind === 'queued' ? phase : phase
      return {
        kind: 'executing',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        intent: basePhase.intent,
        state: basePhase.state,
        executionPath: basePhase.executionPath,
        isTemporaryWorktree: basePhase.isTemporaryWorktree,
        activeJob: event.job
      }
    }

    case 'JOB_COMPLETED': {
      if (phase.kind !== 'executing') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only complete job from executing'
        )
      }
      // Stay in executing - next job will start or ALL_JOBS_COMPLETE will fire
      return {
        ...phase,
        enteredAtMs: now
      }
    }

    case 'CONFLICT_DETECTED': {
      if (phase.kind !== 'executing') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only detect conflict from executing'
        )
      }
      return {
        kind: 'conflicted',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        intent: phase.intent,
        state: phase.state,
        executionPath: phase.executionPath,
        isTemporaryWorktree: phase.isTemporaryWorktree,
        conflictedJob: event.job,
        conflictFiles: event.conflicts
      }
    }

    case 'CONTINUE_AFTER_RESOLVE': {
      if (phase.kind !== 'conflicted') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only continue from conflicted'
        )
      }
      return {
        kind: 'executing',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        intent: phase.intent,
        state: phase.state,
        executionPath: phase.executionPath,
        isTemporaryWorktree: phase.isTemporaryWorktree,
        activeJob: phase.conflictedJob
      }
    }

    case 'ABORT': {
      if (phase.kind !== 'conflicted' && phase.kind !== 'executing' && phase.kind !== 'queued') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only abort from queued, executing, or conflicted'
        )
      }
      return createIdlePhase(phase.correlationId)
    }

    case 'ALL_JOBS_COMPLETE': {
      if (phase.kind !== 'executing') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only complete all jobs from executing'
        )
      }
      return {
        kind: 'finalizing',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        intent: phase.intent,
        state: phase.state,
        executionPath: phase.executionPath,
        isTemporaryWorktree: phase.isTemporaryWorktree
      }
    }

    case 'FINALIZE_COMPLETE': {
      if (phase.kind !== 'finalizing') {
        throw new InvalidTransitionError(
          phase.kind,
          event.type,
          'Can only complete finalization from finalizing'
        )
      }
      return {
        kind: 'completed',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        finalState: event.finalState,
        durationMs: now - getOperationStartTime(phase)
      }
    }

    case 'ERROR': {
      // Error can happen from most phases
      const validErrorPhases = ['queued', 'executing', 'conflicted', 'finalizing']
      if (!validErrorPhases.includes(phase.kind)) {
        throw new InvalidTransitionError(phase.kind, event.type, 'Cannot error from this phase')
      }
      const statePhase = phase as QueuedPhase | ExecutingPhase | ConflictedPhase | FinalizingPhase
      return {
        kind: 'error',
        enteredAtMs: now,
        correlationId: phase.correlationId,
        error: {
          code: event.code,
          message: event.message,
          recoverable: event.recoverable
        },
        state: statePhase.state,
        actions: event.recoverable ? ['retry', 'abort'] : ['cleanup']
      }
    }

    case 'ACKNOWLEDGE_ERROR': {
      if (phase.kind !== 'error') {
        throw new InvalidTransitionError(phase.kind, event.type, 'Can only acknowledge from error')
      }
      return createIdlePhase(phase.correlationId)
    }

    case 'CLEAR_COMPLETED': {
      if (phase.kind !== 'completed') {
        throw new InvalidTransitionError(phase.kind, event.type, 'Can only clear from completed')
      }
      return createIdlePhase()
    }

    default: {
      const _exhaustive: never = event
      throw new Error(`Unknown event type: ${(_exhaustive as RebaseEvent).type}`)
    }
  }
}

/**
 * Check if a transition is valid without throwing.
 */
export function canTransition(phase: RebasePhase, eventType: RebaseEvent['type']): boolean {
  const validTransitions: Record<RebasePhase['kind'], RebaseEvent['type'][]> = {
    idle: ['SUBMIT_INTENT'],
    planning: ['CANCEL_INTENT', 'CONFIRM_INTENT', 'ERROR'],
    queued: ['JOB_STARTED', 'ABORT', 'ERROR'],
    executing: ['JOB_COMPLETED', 'CONFLICT_DETECTED', 'ALL_JOBS_COMPLETE', 'ABORT', 'ERROR'],
    conflicted: ['CONTINUE_AFTER_RESOLVE', 'ABORT', 'ERROR'],
    finalizing: ['FINALIZE_COMPLETE', 'ERROR'],
    completed: ['CLEAR_COMPLETED'],
    error: ['ACKNOWLEDGE_ERROR']
  }

  return validTransitions[phase.kind].includes(eventType)
}

/**
 * Get human-readable description of current phase.
 */
export function getPhaseDescription(phase: RebasePhase): string {
  switch (phase.kind) {
    case 'idle':
      return 'No rebase in progress'
    case 'planning':
      return `Planning rebase of ${phase.intent.targets.length} branch(es)`
    case 'queued':
      return `Ready to rebase ${phase.state.queue.pendingJobIds.length} branch(es)`
    case 'executing':
      return `Rebasing ${phase.activeJob.branch}`
    case 'conflicted':
      return `Conflict in ${phase.conflictedJob.branch} (${phase.conflictFiles.length} files)`
    case 'finalizing':
      return 'Finalizing rebase'
    case 'completed':
      return `Rebase completed in ${Math.round(phase.durationMs / 1000)}s`
    case 'error':
      return `Error: ${phase.error.message}`
  }
}

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromPhase: RebasePhase['kind'],
    public readonly eventType: RebaseEvent['type'],
    public readonly reason: string
  ) {
    super(`Invalid transition from '${fromPhase}' on '${eventType}': ${reason}`)
    this.name = 'InvalidTransitionError'
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function generateCorrelationId(): string {
  return `rebase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getOperationStartTime(phase: FinalizingPhase): number {
  // The operation started when we entered planning phase
  // For now, use current phase entry time as approximation
  // In production, we'd track the original planning phase entry time
  return phase.enteredAtMs - 60000 // Placeholder - should track actual start
}
