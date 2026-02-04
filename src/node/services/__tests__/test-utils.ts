/**
 * Test utilities for instance-based services.
 *
 * Provides mock clock, service factories, and other helpers
 * for writing isolated, deterministic tests.
 */

import type { Clock } from '../ExecutionContextService'

/**
 * Mock clock for deterministic time testing.
 * Allows tests to control time progression.
 *
 * @example
 * ```typescript
 * const clock = createMockClock()
 * const service = ExecutionContextService.createInstance({ clock })
 *
 * // Advance time by 25 hours to test staleness
 * clock.advance(25 * 60 * 60 * 1000)
 * ```
 */
export interface MockClock extends Clock {
  /** Current simulated time */
  now(): number

  /** Advance time by the specified milliseconds */
  advance(ms: number): void

  /** Set the current time to a specific value */
  set(timestamp: number): void
}

/**
 * Create a mock clock for testing.
 *
 * @param initialTime - Starting timestamp (defaults to Date.now())
 * @returns A mock clock that can be advanced programmatically
 *
 * @example
 * ```typescript
 * // Create clock starting at specific time
 * const clock = createMockClock(1000000)
 *
 * // Advance by 1 hour
 * clock.advance(60 * 60 * 1000)
 *
 * // Check current time
 * expect(clock.now()).toBe(1000000 + 60 * 60 * 1000)
 * ```
 */
export function createMockClock(initialTime = Date.now()): MockClock {
  let time = initialTime
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
    set: (timestamp: number) => {
      time = timestamp
    }
  }
}

/**
 * Create a mock config store for testing.
 * Provides in-memory implementation of ConfigStore methods.
 * Generic type parameter allows typing the session storage properly.
 */
export function createMockConfigStore<TSession = unknown>() {
  const sessions = new Map<string, TSession>()
  let activeWorktree: string | null = null
  let useParallelWorktree = true

  return {
    // Rebase session methods
    getRebaseSession: (key: string): TSession | null => sessions.get(key) ?? null,
    setRebaseSession: (key: string, session: TSession) => {
      sessions.set(key, session)
    },
    deleteRebaseSession: (key: string) => sessions.delete(key),
    hasRebaseSession: (key: string) => sessions.has(key),

    // Worktree methods
    getActiveWorktree: (_repoPath: string) => activeWorktree,
    setActiveWorktree: (worktree: string | null) => {
      activeWorktree = worktree
    },
    getUseParallelWorktree: () => useParallelWorktree,
    setUseParallelWorktree: (enabled: boolean) => {
      useParallelWorktree = enabled
    },

    // Test helpers
    clear: () => {
      sessions.clear()
      activeWorktree = null
      useParallelWorktree = true
    }
  }
}

/**
 * Time constants for test readability.
 */
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000
} as const
