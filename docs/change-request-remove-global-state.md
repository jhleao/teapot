# Change Request: Remove Global State for Testability

**Status:** Proposed
**Author:** Engineering
**Date:** January 2025
**Affects:** `src/node/services/ExecutionContextService.ts`, `src/node/services/SessionService.ts`

## Executive Summary

The services layer violates the architecture principle that **services should manage I/O through consistent interfaces** (see `src/node/README.md`). Currently, `ExecutionContextService` and `SessionService` use module-level global state that:

1. Causes test pollution and non-deterministic test failures
2. Prevents proper dependency injection for mocking
3. Makes time-based logic untestable
4. Breaks test parallelization

This document proposes migrating to an instance-based architecture while maintaining backward compatibility.

---

## Problem Analysis

### Identified Global State

**ExecutionContextService.ts** (lines 113-152):

```typescript
// Module-level globals that leak between tests
const contextEvents = new EventEmitter()           // Line 113
let contextTtlMs = DEFAULT_CONTEXT_TTL_MS          // Line 128 (mutable!)
const lockQueues: Map<string, Promise<void>> = new Map()  // Line 143
const activeContexts: Map<string, string> = new Map()     // Line 149
let exitHandlerRegistered = false                  // Line 152
```

**SessionService.ts** (line 47):

```typescript
const sessionStore = new SessionStore(configStore)  // Global singleton
```

### Architecture Violations

Per `src/node/README.md`, the services layer should:

> "Wrap external dependencies...Manage caches and sessions...Provide consistent interfaces over I/O operations"

Global state violates this because:

| Principle | Violation |
|-----------|-----------|
| "Consistent interfaces" | Global state creates implicit interfaces that can't be substituted |
| "Manage caches" | Cache state leaks across test runs |
| "Wrap external dependencies" | `Date.now()` and `process.kill()` are unwrapped, untestable |

### Impact on Testing

**Current Test Setup (ParallelRebase.test.ts):**

```typescript
afterEach(async () => {
  // Clean up contexts - but lockQueues and activeContexts remain!
  try {
    await ExecutionContextService.clearStoredContext(repoPath)
  } catch {
    // Ignore errors
  }
  // No way to reset lockQueues, activeContexts, or exitHandlerRegistered
})
```

**Problems:**
- `lockQueues` accumulates entries across tests → memory leak
- `activeContexts` retains references → phantom cleanup on process exit
- `contextTtlMs` mutations in one test affect others
- `exitHandlerRegistered` can only be set once → handler registered on first test only

**Observed Failures:**
- Tests pass individually but fail when run together
- Test order affects outcomes
- CI flakiness due to shared state

---

## Proposed Solution

### Design Principles

1. **Instance-based services** with dependency injection
2. **Static facade** for backward compatibility
3. **Explicit reset mechanism** for testing
4. **Clock abstraction** for time-based testing
5. **Maintain layered architecture** per `src/node/README.md`

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Static Facade (Backward Compat)                  │
│  ExecutionContextService.acquire() → delegates to default instance   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  ExecutionContextServiceInstance                     │
│  - All state is instance-scoped                                     │
│  - Dependencies injected via constructor                            │
│  - reset() method clears all state                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────┐
            │ GitAdapter │   │ ConfigStore │   │   Clock   │
            └───────────┘   └───────────┘   └───────────┘
```

---

## Detailed Implementation

### Phase 1: Define Dependency Interface

**File:** `src/node/services/ExecutionContextService.ts`

```typescript
/**
 * Dependencies that can be injected for testing.
 * All I/O operations are abstracted through these interfaces.
 */
export interface ExecutionContextDependencies {
  /** Git adapter for git operations */
  git: GitAdapter

  /** Worktree operations (can be mocked) */
  worktreeOps: {
    detachHead(worktreePath: string): Promise<WorktreeOperationResult>
    checkoutBranchInWorktree(path: string, branch: string): Promise<WorktreeOperationResult>
    createTemporary(repoPath: string, baseDir: string): Promise<{ success: boolean; worktreePath?: string; error?: string }>
    remove(repoPath: string, worktreePath: string, force?: boolean): Promise<void>
  }

  /** Config store for active worktree lookup */
  configStore: {
    getActiveWorktree(repoPath: string): string | null
  }

  /** Clock abstraction for time-based logic */
  clock: {
    now(): number
  }

  /** File system operations */
  fs: {
    existsSync(path: string): boolean
    promises: {
      readFile(path: string, encoding: string): Promise<string>
      writeFile(path: string, content: string, options?: { flag?: string }): Promise<void>
      unlink(path: string): Promise<void>
      mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
      readdir(path: string): Promise<string[]>
      rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
      realpath(path: string): Promise<string>
      rename(oldPath: string, newPath: string): Promise<void>
    }
  }

  /** Process operations (for PID checks) */
  process: {
    pid: number
    kill(pid: number, signal: number): void
    on(event: string, handler: () => void): void
  }

  /** Random UUID generator (for lock IDs) */
  randomUUID(): string
}

/** Default production dependencies */
function createDefaultDependencies(): ExecutionContextDependencies {
  return {
    get git() { return getGitAdapter() },
    worktreeOps: WorktreeOperation,
    configStore,
    clock: { now: () => Date.now() },
    fs: {
      existsSync: fs.existsSync,
      promises: fs.promises
    },
    process: {
      pid: process.pid,
      kill: (pid, signal) => process.kill(pid, signal),
      on: (event, handler) => process.on(event, handler)
    },
    randomUUID: () => crypto.randomUUID()
  }
}
```

### Phase 2: Create Instance-Based Class

```typescript
/**
 * Instance-based execution context service.
 * All state is scoped to the instance, enabling isolated testing.
 */
export class ExecutionContextServiceInstance {
  // Instance state (NOT global)
  private readonly events = new EventEmitter()
  private contextTtlMs = DEFAULT_CONTEXT_TTL_MS
  private readonly lockQueues = new Map<string, Promise<void>>()
  private readonly activeContexts = new Map<string, string>()
  private exitHandlerRegistered = false

  constructor(private readonly deps: ExecutionContextDependencies) {}

  /** Event emitter for observability */
  get eventEmitter(): EventEmitter {
    return this.events
  }

  /** Get current TTL */
  getContextTTL(): number {
    return this.contextTtlMs
  }

  /** Set TTL (for testing time-based expiration) */
  setContextTTL(ttlMs: number): void {
    if (ttlMs <= 0) throw new Error('TTL must be positive')
    this.contextTtlMs = ttlMs
  }

  /** Reset all instance state (for testing) */
  reset(): void {
    this.lockQueues.clear()
    this.activeContexts.clear()
    this.contextTtlMs = DEFAULT_CONTEXT_TTL_MS
    this.exitHandlerRegistered = false
    this.events.removeAllListeners()
  }

  /** Get diagnostic information (for testing assertions) */
  getDiagnostics(): {
    lockQueueCount: number
    activeContextCount: number
    exitHandlerRegistered: boolean
    ttlMs: number
  } {
    return {
      lockQueueCount: this.lockQueues.size,
      activeContextCount: this.activeContexts.size,
      exitHandlerRegistered: this.exitHandlerRegistered,
      ttlMs: this.contextTtlMs
    }
  }

  async acquire(
    repoPath: string,
    operation: ExecutionOperation = 'unknown'
  ): Promise<ExecutionContext> {
    // Implementation uses this.deps instead of global imports
    const git = this.deps.git
    const now = this.deps.clock.now()

    // ... rest of implementation using this.deps and this.* state
  }

  // All other methods converted similarly...
}
```

### Phase 3: Static Facade for Backward Compatibility

```typescript
// Default singleton for production use
let defaultInstance: ExecutionContextServiceInstance | null = null

function getDefaultInstance(): ExecutionContextServiceInstance {
  if (!defaultInstance) {
    defaultInstance = new ExecutionContextServiceInstance(createDefaultDependencies())
  }
  return defaultInstance
}

/**
 * Static facade - maintains existing API for all callers.
 * Delegates to the default singleton instance.
 *
 * For testing, use createInstance() to get an isolated instance.
 */
export class ExecutionContextService {
  private constructor() {} // Prevent instantiation

  /**
   * Create an isolated instance with custom dependencies.
   * Use this in tests for full isolation.
   */
  static createInstance(
    deps: Partial<ExecutionContextDependencies> = {}
  ): ExecutionContextServiceInstance {
    return new ExecutionContextServiceInstance({
      ...createDefaultDependencies(),
      ...deps
    })
  }

  /**
   * Reset the default instance.
   * Call this in test teardown to ensure clean state.
   */
  static resetDefaultInstance(): void {
    defaultInstance?.reset()
    defaultInstance = null
  }

  /** Event emitter for observability */
  static get events(): EventEmitter {
    return getDefaultInstance().eventEmitter
  }

  // All existing static methods delegate to instance:

  static getContextTTL(): number {
    return getDefaultInstance().getContextTTL()
  }

  static setContextTTL(ttlMs: number): void {
    getDefaultInstance().setContextTTL(ttlMs)
  }

  static resetContextTTL(): void {
    getDefaultInstance().setContextTTL(DEFAULT_CONTEXT_TTL_MS)
  }

  static acquire(
    repoPath: string,
    operation?: ExecutionOperation
  ): Promise<ExecutionContext> {
    return getDefaultInstance().acquire(repoPath, operation)
  }

  static storeContext(repoPath: string, context: ExecutionContext): Promise<void> {
    return getDefaultInstance().storeContext(repoPath, context)
  }

  static clearStoredContext(repoPath: string): Promise<void> {
    return getDefaultInstance().clearStoredContext(repoPath)
  }

  static hasStoredContext(repoPath: string): Promise<boolean> {
    return getDefaultInstance().hasStoredContext(repoPath)
  }

  static getStoredExecutionPath(repoPath: string): Promise<string | undefined> {
    return getDefaultInstance().getStoredExecutionPath(repoPath)
  }

  static getStoredContext(repoPath: string): Promise<PersistedContext | null> {
    return getDefaultInstance().getStoredContext(repoPath)
  }

  static getStoredContextOrThrow(repoPath: string): Promise<PersistedContext> {
    return getDefaultInstance().getStoredContextOrThrow(repoPath)
  }

  static release(context: ExecutionContext): Promise<void> {
    return getDefaultInstance().release(context)
  }

  static cleanupOrphans(repoPath: string): Promise<void> {
    return getDefaultInstance().cleanupOrphans(repoPath)
  }

  static isActiveWorktreeDirty(repoPath: string): Promise<boolean> {
    return getDefaultInstance().isActiveWorktreeDirty(repoPath)
  }

  static healthCheck(repoPath: string): Promise<HealthCheckResult> {
    return getDefaultInstance().healthCheck(repoPath)
  }
}
```

### Phase 4: Update Tests

**Before (current tests):**

```typescript
describe('ExecutionContextService', () => {
  afterEach(async () => {
    // Incomplete cleanup - global state leaks
    try {
      await ExecutionContextService.clearStoredContext(repoPath)
    } catch {}
  })

  it('creates temp worktree when dirty', async () => {
    // Uses real Date.now(), real fs, real git
    // Can't control time for TTL testing
    const context = await ExecutionContextService.acquire(repoPath)
    expect(context.isTemporary).toBe(true)
  })
})
```

**After (with instance-based service):**

```typescript
describe('ExecutionContextService', () => {
  let service: ExecutionContextServiceInstance
  let mockGit: MockGitAdapter
  let mockFs: MockFileSystem
  let mockClock: { now: () => number }
  let currentTime: number

  beforeEach(() => {
    currentTime = 1000000
    mockClock = { now: () => currentTime }
    mockGit = createMockGitAdapter()
    mockFs = createMockFileSystem()

    service = ExecutionContextService.createInstance({
      git: mockGit,
      clock: mockClock,
      fs: mockFs,
      worktreeOps: createMockWorktreeOps(),
      configStore: { getActiveWorktree: () => null },
      process: { pid: 12345, kill: vi.fn(), on: vi.fn() },
      randomUUID: () => 'test-uuid-1234'
    })
  })

  afterEach(() => {
    // Complete cleanup - no global state
    service.reset()
  })

  it('creates temp worktree when dirty', async () => {
    mockGit.getWorkingTreeStatus.mockResolvedValue({
      modified: ['file.txt'],
      staged: [],
      deleted: [],
      conflicted: [],
      isRebasing: false
    })

    const context = await service.acquire(repoPath, 'rebase')

    expect(context.isTemporary).toBe(true)
    expect(mockGit.getWorkingTreeStatus).toHaveBeenCalledWith(repoPath)
  })

  it('clears stale context based on TTL', async () => {
    // Create context at time 0
    currentTime = 0
    await service.storeContext(repoPath, createTestContext())

    // Advance time past TTL (24 hours default)
    currentTime = 25 * 60 * 60 * 1000

    // Should detect staleness and clear
    const context = await service.acquire(repoPath, 'rebase')
    expect(context.createdAt).toBe(currentTime) // New context
  })

  it('handles lock contention', async () => {
    const lockAttempts: number[] = []
    let attemptCount = 0

    // Mock fs to simulate lock contention
    mockFs.promises.writeFile = vi.fn().mockImplementation(async (path, content, options) => {
      attemptCount++
      lockAttempts.push(currentTime)
      if (attemptCount < 3) {
        const error = new Error('EEXIST') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
    })

    await service.acquire(repoPath, 'rebase')

    expect(attemptCount).toBe(3)
  })

  it('verifies diagnostics are reset', () => {
    // Pollute state
    service.setContextTTL(1000)

    // Reset
    service.reset()

    // Verify clean state
    const diag = service.getDiagnostics()
    expect(diag.ttlMs).toBe(DEFAULT_CONTEXT_TTL_MS)
    expect(diag.lockQueueCount).toBe(0)
    expect(diag.activeContextCount).toBe(0)
  })
})
```

### Phase 5: SessionService Refactoring

Apply the same pattern to `SessionService`:

```typescript
// src/node/services/SessionService.ts

export interface SessionServiceDependencies {
  configStore: ConfigStore
  clock: { now(): number }
}

export class SessionServiceInstance {
  private readonly store: SessionStore

  constructor(private readonly deps: SessionServiceDependencies) {
    this.store = new SessionStore(deps.configStore)
  }

  reset(): void {
    this.store.clear()
  }

  getSession(repoPath: string): StoredRebaseSession | null {
    return this.store.get(normalizePath(repoPath))
  }

  // ... other methods
}

// Static facade
let defaultSessionInstance: SessionServiceInstance | null = null

export const SessionService = {
  createInstance(deps: Partial<SessionServiceDependencies>): SessionServiceInstance {
    return new SessionServiceInstance({
      configStore,
      clock: { now: () => Date.now() },
      ...deps
    })
  },

  resetDefaultInstance(): void {
    defaultSessionInstance?.reset()
    defaultSessionInstance = null
  },

  // Delegate all existing exports...
  getSession: (repoPath: string) => getDefaultSessionInstance().getSession(repoPath),
  hasSession: (repoPath: string) => getDefaultSessionInstance().hasSession(repoPath),
  // ... etc
}
```

---

## Migration Plan

### Phase 1: Preparation (Low Risk)

1. Add `ExecutionContextDependencies` interface
2. Add `ExecutionContextServiceInstance` class alongside existing code
3. Add static `createInstance()` and `resetDefaultInstance()` methods
4. **No behavior changes to existing code**

### Phase 2: Internal Migration (Medium Risk)

1. Refactor `ExecutionContextService` internals to use `this.deps`
2. Move global variables into instance class
3. Update static methods to delegate to default instance
4. **Existing callers continue to work unchanged**

### Phase 3: Test Migration (Low Risk)

1. Update `ParallelRebase.test.ts` to use isolated instances
2. Add new tests for time-based scenarios
3. Add tests for lock contention
4. Verify test isolation by running tests in parallel

### Phase 4: SessionService (Medium Risk)

1. Apply same pattern to `SessionService`
2. Update tests that depend on session state

### Phase 5: Documentation

1. Update `src/node/README.md` with testing guidance
2. Add JSDoc examples for test usage

---

## Validation Criteria

### Functional Requirements

- [ ] All existing tests pass without modification
- [ ] Static API remains identical (no breaking changes)
- [ ] Production behavior unchanged

### Testing Requirements

- [ ] Tests can run in parallel without interference
- [ ] Each test gets isolated state
- [ ] Time-based logic is testable via mock clock
- [ ] Lock contention scenarios are testable
- [ ] Test suite runs faster due to parallelization

### Code Quality

- [ ] No increase in cyclomatic complexity
- [ ] Clear separation between instance and static API
- [ ] Comprehensive JSDoc on new interfaces
- [ ] Follows layered architecture per `src/node/README.md`

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing callers | High | Static facade maintains 100% API compatibility |
| Test migration effort | Medium | Can be done incrementally, test-by-test |
| Increased code complexity | Low | Instance class is cleaner than global state |
| Memory overhead of instances | Negligible | Only one default instance in production |

---

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Preparation | 2 hours | Low |
| Phase 2: ExecutionContextService | 4 hours | Medium |
| Phase 3: Test Migration | 3 hours | Low |
| Phase 4: SessionService | 2 hours | Medium |
| Phase 5: Documentation | 1 hour | Low |
| **Total** | **12 hours** | - |

---

## Appendix A: Mock Helpers

```typescript
// src/node/services/__tests__/helpers/mockDependencies.ts

import { vi } from 'vitest'
import type { ExecutionContextDependencies } from '../ExecutionContextService'

export function createMockGitAdapter() {
  return {
    getWorkingTreeStatus: vi.fn(),
    currentBranch: vi.fn(),
    resolveRef: vi.fn(),
    log: vi.fn(),
    checkout: vi.fn(),
    add: vi.fn(),
    rebase: vi.fn(),
    rebaseContinue: vi.fn(),
    rebaseAbort: vi.fn(),
    rebaseSkip: vi.fn(),
    listWorktrees: vi.fn()
  }
}

export function createMockFileSystem() {
  const files = new Map<string, string>()

  return {
    existsSync: vi.fn((path: string) => files.has(path)),
    promises: {
      readFile: vi.fn(async (path: string) => {
        if (!files.has(path)) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          throw err
        }
        return files.get(path)!
      }),
      writeFile: vi.fn(async (path: string, content: string, options?: { flag?: string }) => {
        if (options?.flag === 'wx' && files.has(path)) {
          const err = new Error('EEXIST') as NodeJS.ErrnoException
          err.code = 'EEXIST'
          throw err
        }
        files.set(path, content)
      }),
      unlink: vi.fn(async (path: string) => {
        files.delete(path)
      }),
      mkdir: vi.fn(),
      readdir: vi.fn(async () => []),
      rm: vi.fn(),
      realpath: vi.fn(async (path: string) => path),
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        const content = files.get(oldPath)
        if (content) {
          files.delete(oldPath)
          files.set(newPath, content)
        }
      })
    },
    _files: files // Exposed for test assertions
  }
}

export function createMockWorktreeOps() {
  return {
    detachHead: vi.fn().mockResolvedValue({ success: true }),
    checkoutBranchInWorktree: vi.fn().mockResolvedValue({ success: true }),
    createTemporary: vi.fn().mockResolvedValue({
      success: true,
      worktreePath: '/tmp/test-worktree'
    }),
    remove: vi.fn()
  }
}

export function createTestDependencies(
  overrides: Partial<ExecutionContextDependencies> = {}
): ExecutionContextDependencies {
  let currentTime = Date.now()

  return {
    git: createMockGitAdapter(),
    worktreeOps: createMockWorktreeOps(),
    configStore: { getActiveWorktree: () => null },
    clock: { now: () => currentTime },
    fs: createMockFileSystem(),
    process: {
      pid: 12345,
      kill: vi.fn(),
      on: vi.fn()
    },
    randomUUID: () => `test-${Math.random().toString(36).slice(2)}`,
    ...overrides,
    // Helper to advance time in tests
    _advanceTime: (ms: number) => { currentTime += ms }
  } as ExecutionContextDependencies & { _advanceTime: (ms: number) => void }
}
```

---

## Appendix B: Example Test Scenarios

### Testing TTL Expiration

```typescript
it('clears context older than TTL', async () => {
  const deps = createTestDependencies()
  const service = ExecutionContextService.createInstance(deps)

  // Set short TTL for test
  service.setContextTTL(1000) // 1 second

  // Create context
  await service.storeContext(repoPath, createContext({ createdAt: deps.clock.now() }))

  // Advance time past TTL
  deps._advanceTime(2000)

  // Should be stale
  const health = await service.healthCheck(repoPath)
  expect(health.isStoredContextStale).toBe(true)
})
```

### Testing Lock Race Conditions

```typescript
it('handles concurrent lock acquisition', async () => {
  const deps = createTestDependencies()
  const service = ExecutionContextService.createInstance(deps)

  // Simulate another process holding the lock
  const lockPath = path.join(repoPath, '.git', 'teapot-exec.lock')
  deps.fs._files.set(lockPath, JSON.stringify({
    pid: 99999, // Different PID
    lockId: 'other-process-lock',
    timestamp: deps.clock.now()
  }))

  // Mock process.kill to indicate process exists
  deps.process.kill = vi.fn().mockImplementation(() => {
    // Process exists - don't throw
  })

  // Should wait and retry
  const acquirePromise = service.acquire(repoPath, 'rebase')

  // Simulate lock being released after some retries
  setTimeout(() => {
    deps.fs._files.delete(lockPath)
  }, 50)

  const context = await acquirePromise
  expect(context).toBeDefined()
})
```

### Testing Parallel Execution

```typescript
describe('parallel test isolation', () => {
  it.concurrent('test A modifies TTL', async () => {
    const service = ExecutionContextService.createInstance()
    service.setContextTTL(1000)
    expect(service.getContextTTL()).toBe(1000)
    // This doesn't affect test B
  })

  it.concurrent('test B uses default TTL', async () => {
    const service = ExecutionContextService.createInstance()
    expect(service.getContextTTL()).toBe(DEFAULT_CONTEXT_TTL_MS)
    // Unaffected by test A
  })
})
```

---

## Appendix C: Original Implementation Architecture Proposal

The following was the initial architectural proposal for removing global state, which informed this change request.

### Problem Statement

The current implementation uses static classes with module-level state:

```typescript
// ExecutionContextService.ts - Current Pattern
export class ExecutionContextService {
  // Module-level globals
  private static activeContexts: Map<string, string> = new Map()
  private static dirWatchers: Map<string, FSWatcher> = new Map()

  static async acquire(repoPath: string): Promise<ExecutionContext> {
    // Uses global state directly
  }
}
```

This pattern creates several issues:

1. **Test Isolation**: Tests that use `ExecutionContextService` share state, causing flaky tests
2. **Mock Complexity**: Cannot easily substitute dependencies (git, fs, time)
3. **Singleton Lock-in**: Forces single-instance behavior even when multiple would be cleaner

### Proposed Architecture: Instance-Based Services with Dependency Injection

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              Application Layer                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         ServiceContainer                              │  │
│  │  - Creates and wires all service instances                           │  │
│  │  - Manages service lifecycle                                         │  │
│  │  - Provides access via typed getters                                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐
│ ExecutionContextService │ │    SessionService      │ │   TransactionService   │
│      (Instance)         │ │      (Instance)        │ │      (Instance)        │
├────────────────────────┤ ├────────────────────────┤ ├────────────────────────┤
│ - activeContexts: Map  │ │ - sessions: Map        │ │ - intents: Map         │
│ - lockQueues: Map      │ │ - configStore          │ │ - walDir: string       │
│ - deps: Dependencies   │ │ - deps: Dependencies   │ │ - deps: Dependencies   │
└────────────────────────┘ └────────────────────────┘ └────────────────────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           Dependency Interfaces                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ GitAdapter │  │   Clock    │  │ FileSystem │  │  Process   │           │
│  │ interface  │  │ interface  │  │ interface  │  │ interface  │           │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘           │
└────────────────────────────────────────────────────────────────────────────┘
```

### Service Container Implementation

```typescript
// src/node/services/ServiceContainer.ts

import type { GitAdapter } from '../git'
import type { ConfigStore } from '../stores/configStore'

/**
 * Dependency interfaces for all services.
 * Abstracting these allows for easy mocking in tests.
 */
export interface ServiceDependencies {
  git: GitAdapter
  configStore: ConfigStore
  clock: Clock
  fs: FileSystemAdapter
  process: ProcessAdapter
  crypto: CryptoAdapter
}

export interface Clock {
  now(): number
}

export interface FileSystemAdapter {
  existsSync(path: string): boolean
  promises: {
    readFile(path: string, encoding: string): Promise<string>
    writeFile(path: string, data: string, options?: { flag?: string }): Promise<void>
    unlink(path: string): Promise<void>
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
    readdir(path: string): Promise<string[]>
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
    realpath(path: string): Promise<string>
    rename(old: string, new_: string): Promise<void>
  }
}

export interface ProcessAdapter {
  pid: number
  kill(pid: number, signal: number): void
  on(event: 'exit', handler: () => void): void
}

export interface CryptoAdapter {
  randomUUID(): string
}

/**
 * Container that creates and manages all service instances.
 *
 * In production: Use createProductionContainer()
 * In tests: Use createTestContainer(mockDeps)
 */
export class ServiceContainer {
  private _executionContext: ExecutionContextServiceInstance | null = null
  private _session: SessionServiceInstance | null = null
  private _transaction: TransactionServiceInstance | null = null

  constructor(private readonly deps: ServiceDependencies) {}

  get executionContext(): ExecutionContextServiceInstance {
    if (!this._executionContext) {
      this._executionContext = new ExecutionContextServiceInstance(this.deps)
    }
    return this._executionContext
  }

  get session(): SessionServiceInstance {
    if (!this._session) {
      this._session = new SessionServiceInstance(this.deps)
    }
    return this._session
  }

  get transaction(): TransactionServiceInstance {
    if (!this._transaction) {
      this._transaction = new TransactionServiceInstance(this.deps)
    }
    return this._transaction
  }

  /**
   * Reset all services. Use in test teardown.
   */
  reset(): void {
    this._executionContext?.reset()
    this._session?.reset()
    this._transaction?.reset()
  }

  /**
   * Dispose all services and release resources.
   */
  dispose(): void {
    this.reset()
    this._executionContext = null
    this._session = null
    this._transaction = null
  }
}

/**
 * Create container with production dependencies.
 */
export function createProductionContainer(): ServiceContainer {
  return new ServiceContainer({
    get git() { return getGitAdapter() },
    configStore,
    clock: { now: () => Date.now() },
    fs: {
      existsSync: fs.existsSync.bind(fs),
      promises: fs.promises
    },
    process: {
      pid: process.pid,
      kill: process.kill.bind(process),
      on: process.on.bind(process)
    },
    crypto: {
      randomUUID: () => crypto.randomUUID()
    }
  })
}

/**
 * Create container with test dependencies.
 * Pass partial overrides to customize specific deps.
 */
export function createTestContainer(
  overrides: Partial<ServiceDependencies> = {}
): ServiceContainer {
  const defaultTestDeps: ServiceDependencies = {
    git: createMockGitAdapter(),
    configStore: createMockConfigStore(),
    clock: { now: () => Date.now() },
    fs: createMockFileSystem(),
    process: { pid: 12345, kill: vi.fn(), on: vi.fn() },
    crypto: { randomUUID: () => `test-${Math.random().toString(36).slice(2)}` }
  }

  return new ServiceContainer({ ...defaultTestDeps, ...overrides })
}
```

### Static Facade Pattern for Backward Compatibility

The key insight is maintaining backward compatibility while enabling testability:

```typescript
// src/node/services/ExecutionContextService.ts

/**
 * Default production container - lazily initialized.
 * This is the ONLY global state, and it's explicitly managed.
 */
let defaultContainer: ServiceContainer | null = null

function getDefaultContainer(): ServiceContainer {
  if (!defaultContainer) {
    defaultContainer = createProductionContainer()
  }
  return defaultContainer
}

/**
 * Static facade that maintains the existing API.
 * All methods delegate to the default container's instance.
 *
 * This allows existing code to work unchanged:
 *   await ExecutionContextService.acquire(repoPath)
 *
 * While tests can use isolated instances:
 *   const container = createTestContainer(mockDeps)
 *   await container.executionContext.acquire(repoPath)
 */
export class ExecutionContextService {
  private constructor() {} // Prevent instantiation

  /**
   * FOR TESTING: Create isolated instance with custom deps.
   */
  static createInstance(deps: Partial<ServiceDependencies>): ExecutionContextServiceInstance {
    const container = createTestContainer(deps)
    return container.executionContext
  }

  /**
   * FOR TESTING: Reset the default container between tests.
   */
  static resetDefaultContainer(): void {
    defaultContainer?.reset()
    defaultContainer = null
  }

  // Existing static API - delegates to default instance
  static async acquire(repoPath: string, operation?: ExecutionOperation): Promise<ExecutionContext> {
    return getDefaultContainer().executionContext.acquire(repoPath, operation)
  }

  static async release(context: ExecutionContext): Promise<void> {
    return getDefaultContainer().executionContext.release(context)
  }

  // ... all other static methods delegate similarly
}
```

### Usage in Tests

```typescript
// Before: Tests share global state (flaky)
describe('RebaseExecutor', () => {
  afterEach(() => {
    // This doesn't fully clean up - lockQueues, activeContexts leak
    ExecutionContextService.clearStoredContext(repoPath)
  })

  it('creates temp worktree', async () => {
    // Uses real git, real fs, real time - hard to control
    const context = await ExecutionContextService.acquire(repoPath)
  })
})

// After: Each test has isolated state
describe('RebaseExecutor', () => {
  let container: ServiceContainer
  let mockClock: { now: () => number }
  let currentTime: number

  beforeEach(() => {
    currentTime = 1000000
    mockClock = { now: () => currentTime }

    container = createTestContainer({
      clock: mockClock,
      git: createMockGitAdapter({
        getWorkingTreeStatus: async () => ({
          modified: ['dirty-file.txt'],
          staged: [],
          deleted: [],
          conflicted: [],
          isRebasing: false
        })
      })
    })
  })

  afterEach(() => {
    // Complete cleanup - zero leakage
    container.dispose()
  })

  it('creates temp worktree when dirty', async () => {
    const context = await container.executionContext.acquire(repoPath)

    expect(context.isTemporary).toBe(true)
  })

  it('detects stale context via TTL', async () => {
    // Store context at current time
    await container.executionContext.storeContext(repoPath, createContext())

    // Advance mock clock past TTL
    currentTime += 25 * 60 * 60 * 1000  // 25 hours

    // Now context should be detected as stale
    const health = await container.executionContext.healthCheck(repoPath)
    expect(health.isStoredContextStale).toBe(true)
  })

  it('runs tests in parallel without interference', async () => {
    // Each test has its own container - no shared state
    container.executionContext.setContextTTL(1000)

    // This won't affect other parallel tests
  })
})
```

### Benefits of This Architecture

| Aspect | Current (Global State) | Proposed (Instance + DI) |
|--------|----------------------|------------------------|
| Test Isolation | ❌ Tests share state | ✅ Each test has own instance |
| Mocking | ❌ Must mock modules | ✅ Pass mock deps to constructor |
| Time Control | ❌ Uses real Date.now() | ✅ Inject mock clock |
| Parallel Tests | ❌ Race conditions | ✅ Fully isolated |
| Production | Uses globals | Same behavior via default container |
| Migration Risk | N/A | ✅ Low - facade preserves API |

### Alignment with Layered Architecture

Per `src/node/README.md`, the architecture follows:

```
handlers → operations → services → domain
```

This proposal maintains that structure:

- **Services layer** (`ExecutionContextService`, `SessionService`) becomes instance-based
- **Operations layer** (`RebaseExecutor`) receives services via parameter or container
- **Handlers layer** uses the static facade for backward compatibility
- **Domain layer** remains pure functions with no dependencies

The change is internal to the services layer - consumers can continue using the static API while tests use isolated instances.

---

## References

- `src/node/README.md` - Backend Architecture Guidelines
- `src/node/REBASING.md` - Rebase Architecture Documentation
- `src/node/services/ExecutionContextService.ts` - Current Implementation
- `src/node/services/SessionService.ts` - Current Implementation
- `src/node/operations/__tests__/ParallelRebase.test.ts` - Existing Tests
