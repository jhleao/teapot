# Idea: Instance-Based Services for Testability

**Source:** `docs/change-request-remove-global-state.md`
**Status:** Proposed
**Priority:** High
**Related:** [Idea #18 - Decouple Execution Context Lifecycle](./18-decouple-execution-context-lifecycle.md)

## Problem

Services layer uses module-level global state that causes test pollution, prevents proper dependency injection, makes time-based logic untestable, and breaks test parallelization.

### Evidence from Codebase

**ExecutionContextService.ts** has 5 global variables:

| Variable                | Line | Type                   | Impact                            |
| ----------------------- | ---- | ---------------------- | --------------------------------- |
| `contextEvents`         | 115  | `EventEmitter`         | Shared across all tests           |
| `contextTtlMs`          | 130  | `number`               | Mutable, affects staleness checks |
| `lockQueues`            | 145  | `Map<string, Promise>` | Lock state leaks between tests    |
| `activeContexts`        | 151  | `Map<string, string>`  | Worktree tracking leaks           |
| `exitHandlerRegistered` | 154  | `boolean`              | Process handler accumulation      |

**SessionService.ts** has module-level singleton:

| Variable       | Line | Type           | Impact                          |
| -------------- | ---- | -------------- | ------------------------------- |
| `sessionStore` | 47   | `SessionStore` | In-memory Map accumulates state |

**Date.now() direct usage** (prevents time-based testing):

| File                       | Lines                                  | Usage                                     |
| -------------------------- | -------------------------------------- | ----------------------------------------- |
| ExecutionContextService.ts | 286, 326, 416, 611, 666, 677, 788, 876 | Staleness detection, timestamps, lock age |
| SessionService.ts          | 74, 81, 111, 137                       | Session timestamps                        |

**Test cleanup is incomplete** (`ExecutionContextService.test.ts` lines 44-50):

```typescript
afterEach(async () => {
  await ExecutionContextService.clearStoredContext(repoPath)
  // BUG: lockQueues, activeContexts, contextTtlMs NOT cleared!
})
```

**Git history confirms ongoing issues:**

- `dcf8813`: "fix: handle stale worktree references causing checkout failures"
- `2102d06`: "fix: prevent race condition in rapid rebase operations"
- `8f16a11`: "fix: prevent lock queue chain breakage on error"

### Observed Test Failures

- Tests pass individually but fail when run together
- Test order affects outcomes
- CI flakiness due to shared state
- Silent `catch { }` in afterEach blocks swallowing cleanup errors

---

## Current Global State Inventory

### ExecutionContextService.ts

```typescript
// Line 115 - Global event emitter (never consumed!)
const contextEvents = new EventEmitter()

// Line 130 - Mutable TTL configuration
let contextTtlMs = DEFAULT_CONTEXT_TTL_MS

// Line 145 - In-memory lock queue per repo
const lockQueues: Map<string, Promise<void>> = new Map()

// Line 151 - Active temp worktree tracking
const activeContexts: Map<string, string> = new Map()

// Line 154 - Process exit handler flag
let exitHandlerRegistered = false
```

### SessionService.ts

```typescript
// Line 47 - Module-level singleton with memory cache
const sessionStore = new SessionStore(configStore)
```

---

## Proposed Solution

Migrate to instance-based architecture with static facade for backward compatibility:

```typescript
// Instance class with all state as instance properties
export class ExecutionContextServiceInstance {
  private readonly events = new EventEmitter()
  private contextTtlMs = DEFAULT_CONTEXT_TTL_MS
  private readonly lockQueues = new Map<string, Promise<void>>()
  private readonly activeContexts = new Map<string, string>()
  private exitHandlerRegistered = false

  constructor(private readonly deps: ExecutionContextDependencies) {}

  reset(): void {
    this.lockQueues.clear()
    this.activeContexts.clear()
    this.contextTtlMs = DEFAULT_CONTEXT_TTL_MS
    this.exitHandlerRegistered = false
    this.events.removeAllListeners()
  }

  getDiagnostics(): ServiceDiagnostics {
    return {
      lockQueueCount: this.lockQueues.size,
      activeContextCount: this.activeContexts.size,
      ttlMs: this.contextTtlMs,
      hasExitHandler: this.exitHandlerRegistered
    }
  }
}

// Static facade for backward compatibility
export class ExecutionContextService {
  static createInstance(deps?: Partial<ExecutionContextDependencies>) { ... }
  static resetDefaultInstance(): void { ... }
  static async acquire(...): Promise<ExecutionContext> {
    return getDefaultInstance().acquire(...)
  }
}
```

---

## Dependencies Interface

Only inject what actually needs mocking for tests. Node.js built-ins (`fs`, `path`, `crypto`, `process`) are stable and don't need injection - tests already use real temp directories.

**ExecutionContextService** - 6 essential dependencies:

```typescript
interface ExecutionContextDependencies {
  // Time abstraction - critical for testing staleness/TTL logic
  clock: { now(): number }

  // Already-abstracted services
  gitAdapter: GitAdapter
  configStore: { getActiveWorktree(repoPath: string): string | null }
  worktreeOps: typeof WorktreeOperation

  // Optional
  logger?: Logger
}
```

**SessionService** - 2 essential dependencies:

```typescript
interface SessionServiceDependencies {
  clock: { now(): number }
  configStore: ConfigStore
}
```

---

## Migration Phases

### Phase 1: Preparation (No Behavior Changes)

**Files:** `src/node/services/ExecutionContextService.ts`, `src/node/services/SessionService.ts`

1. Add `ExecutionContextDependencies` interface (after line 36)
2. Add `createDefaultDependencies()` factory function
3. Add `SessionServiceDependencies` interface
4. Add `createDefaultSessionDependencies()` factory function

### Phase 2: Create Instance Classes

**File:** `src/node/services/ExecutionContextService.ts`

1. Create `ExecutionContextServiceInstance` class
2. Move globals from lines 115, 130, 145, 151, 154 to instance properties
3. Convert all static methods to instance methods
4. Replace `Date.now()` with `this.deps.clock.now()` at 8 locations
5. Add `reset()` method

**File:** `src/node/services/SessionService.ts`

1. Create `SessionStoreInstance` class (extend existing `SessionStore`)
2. Move singleton from line 47 to instance property
3. Replace `Date.now()` with `this.deps.clock.now()` at 4 locations
4. Add `reset()` method

### Phase 3: Add Static Facade

```typescript
let defaultInstance: ExecutionContextServiceInstance | null = null

function getDefaultInstance(): ExecutionContextServiceInstance {
  if (!defaultInstance) {
    defaultInstance = new ExecutionContextServiceInstance(createDefaultDependencies())
  }
  return defaultInstance
}

export class ExecutionContextService {
  static createInstance(deps: Partial<ExecutionContextDependencies> = {}) {
    return new ExecutionContextServiceInstance({
      ...createDefaultDependencies(),
      ...deps
    })
  }

  static resetDefaultInstance(): void {
    defaultInstance?.reset()
    defaultInstance = null
  }

  // Delegate all existing static methods
  static async acquire(...args) {
    return getDefaultInstance().acquire(...args)
  }
  static async release(...args) {
    return getDefaultInstance().release(...args)
  }
  // ... etc
}
```

### Phase 4: Test Migration

**File:** `src/node/__tests__/services/ExecutionContextService.test.ts`

Update from:

```typescript
afterEach(async () => {
  await ExecutionContextService.clearStoredContext(repoPath)
})
```

To:

```typescript
let service: ExecutionContextServiceInstance
let mockClock: MockClock

beforeEach(() => {
  mockClock = createMockClock()
  service = ExecutionContextService.createInstance({
    clock: mockClock
    // ... other mock deps
  })
})

afterEach(() => {
  service.reset() // Complete cleanup guaranteed
})
```

**File:** `src/node/operations/__tests__/ParallelRebase.test.ts`

Remove module-level mock state, use isolated instances.

---

## Test Migration Patterns

### Mock Clock Pattern

```typescript
export function createMockClock(initialTime = Date.now()) {
  let time = initialTime
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    }
  }
}
```

### Test Isolation Pattern

```typescript
describe('ExecutionContextService', () => {
  let service: ExecutionContextServiceInstance
  let mockClock: ReturnType<typeof createMockClock>

  beforeEach(() => {
    mockClock = createMockClock()
    service = ExecutionContextService.createInstance({ clock: mockClock })
  })

  afterEach(() => {
    service.reset() // Complete cleanup guaranteed
  })

  it('detects stale contexts using injected clock', async () => {
    const context = await service.acquire(repoPath)
    await service.storeContext(repoPath, context)

    // Advance clock past TTL
    mockClock.advance(25 * 60 * 60 * 1000) // 25 hours

    // Staleness should be detected
    const newContext = await service.acquire(repoPath)
    expect(newContext.createdAt).toBeGreaterThan(context.createdAt)
  })
})
```

---

## Coordination with Other Ideas

### Idea #18: Decouple Execution Context Lifecycle

Idea #18 proposes a phase model for ExecutionContext:

- `acquired` -> `preparing_release` -> `released`

**Integration points:**

1. Instance-based architecture should track phase as instance state
2. `reset()` method should also reset phase to initial state
3. Phase assertions benefit from dependency injection (testable guards)

**Combined implementation benefit:**

- Instance isolation + phase model = fully testable lifecycle
- Mock clock enables testing phase timeouts
- Reset clears both instance state and phase state

### Recommended Approach

Implement Idea #02 first, then Idea #18:

1. Instance-based refactoring provides clean foundation
2. Phase model adds on top of instance architecture
3. Both share same dependency injection infrastructure

---

## Architecture Design Decisions

### ADR-001: Instance + Static Facade Pattern

**Decision:** Keep static API via facade that delegates to a singleton instance. Tests create isolated instances directly.

**Rationale:**

- Zero breaking changes to existing callers
- Tests get full isolation without module mocking
- Production uses same code path as before
- Gradual migration possible (one caller at a time)

**Alternative Rejected:** Simple `resetForTesting()` method on static class

- Doesn't solve parallel test isolation (tests still share state)
- Clock injection still impossible
- Band-aid rather than proper architecture

### ADR-002: Clock Abstraction

**Decision:** Inject `clock: { now(): number }` rather than mocking `Date.now()`.

**Rationale:**

- Explicit dependency makes time-based logic obvious
- No global pollution from Date mocks
- Easy to advance time in tests
- Works with parallel tests (each has own clock)

### ADR-003: Minimal Dependency Injection

**Decision:** Only inject dependencies that actually need mocking. Use real `fs`, `path`, `crypto`, `process`.

**Rationale:**

- Node.js built-ins are stable and reliable
- Tests already use real temp directories
- Reduces interface complexity
- Mocking fs is more fragile than real fs with temp dirs

---

## Risks and Mitigations

| Risk                        | Mitigation                                               |
| --------------------------- | -------------------------------------------------------- |
| Subtle behavior differences | Run existing tests against both static and instance APIs |
| Performance regression      | Singleton is cached, no overhead per call                |
| Incomplete reset            | Add assertions in test afterEach to verify clean state   |

---

## Verification

1. **Backward compatibility**: `pnpm test` - all existing tests pass unchanged
2. **Clock determinism**: `grep "Date.now()" src/node/services/*.ts` should show 0 results
3. **Test isolation**: Tests pass both with `--run-in-band` and in parallel

---

## First Implementation Steps

### Step 1: Define Dependencies Interface

Add to `ExecutionContextService.ts`:

```typescript
export interface ExecutionContextDependencies {
  clock: { now(): number }
  gitAdapter?: GitAdapter
  configStore?: { getActiveWorktree(repoPath: string): string | null }
  worktreeOps?: typeof WorktreeOperation
}

function createDefaultDependencies(): Required<ExecutionContextDependencies> {
  return {
    clock: { now: () => Date.now() },
    gitAdapter: getGitAdapter(),
    configStore,
    worktreeOps: WorktreeOperation
  }
}
```

### Step 2: Create Instance Class

Move globals to instance properties, add constructor with deps, add `reset()` method.

### Step 3: Add Static Facade

Delegate to default instance, add `createInstance()` and `resetDefaultInstance()`.

### Step 4: Migrate Tests

Update `ExecutionContextService.test.ts` to use isolated instances with mock clock.

### Step 5: Apply to SessionService

Repeat for SessionService (simpler - only needs clock injection).
