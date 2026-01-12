# Idea: Instance-Based Services for Testability

**Source:** `docs/change-request-remove-global-state.md`
**Status:** Proposed
**Priority:** High

## Problem

Services layer uses module-level global state that:
1. Causes test pollution and non-deterministic test failures
2. Prevents proper dependency injection for mocking
3. Makes time-based logic untestable
4. Breaks test parallelization

**Affected services:**
- `ExecutionContextService.ts` - has `contextEvents`, `contextTtlMs`, `lockQueues`, `activeContexts`, `exitHandlerRegistered` as globals
- `SessionService.ts` - has `sessionStore` as global singleton

**Observed test failures:**
- Tests pass individually but fail when run together
- Test order affects outcomes
- CI flakiness due to shared state

## Proposed Solution

Migrate to instance-based architecture:

```typescript
export class ExecutionContextServiceInstance {
  // Instance state (NOT global)
  private readonly events = new EventEmitter()
  private contextTtlMs = DEFAULT_CONTEXT_TTL_MS
  private readonly lockQueues = new Map<string, Promise<void>>()
  private readonly activeContexts = new Map<string, string>()

  constructor(private readonly deps: ExecutionContextDependencies) {}

  reset(): void {
    this.lockQueues.clear()
    this.activeContexts.clear()
    // ...
  }
}
```

With static facade for backward compatibility:

```typescript
export class ExecutionContextService {
  static createInstance(deps): ExecutionContextServiceInstance { ... }
  static resetDefaultInstance(): void { ... }
  static async acquire(...): Promise<ExecutionContext> {
    return getDefaultInstance().acquire(...)
  }
}
```

## Key Design Points

1. **Dependency Injection**: All I/O abstracted (git, fs, clock, process)
2. **Clock Abstraction**: Enable time-based testing
3. **Static Facade**: 100% backward compatible API
4. **Reset Method**: Complete state cleanup for tests

## Dependencies Interface

```typescript
interface ExecutionContextDependencies {
  git: GitAdapter
  worktreeOps: WorktreeOperationInterface
  configStore: ConfigStoreInterface
  clock: { now(): number }
  fs: FileSystemAdapter
  process: ProcessAdapter
  randomUUID(): string
}
```

## Migration Phases

1. **Preparation**: Add interfaces, no behavior changes
2. **Internal Migration**: Refactor internals to use `this.deps`
3. **Test Migration**: Update tests to use isolated instances
4. **SessionService**: Apply same pattern
5. **Documentation**: Update README

## Test Improvements

```typescript
// Before: Incomplete cleanup
afterEach(async () => {
  await ExecutionContextService.clearStoredContext(repoPath)
  // lockQueues, activeContexts still leak!
})

// After: Complete isolation
let service: ExecutionContextServiceInstance
beforeEach(() => {
  service = ExecutionContextService.createInstance({
    clock: { now: () => currentTime },
    // ... mock deps
  })
})
afterEach(() => {
  service.reset() // Complete cleanup
})
```

---

## Architecture Design Decision

### ADR-001: Instance + Static Facade Pattern

**Decision:** Keep static API via facade that delegates to a singleton instance. Tests create isolated instances directly.

**Rationale:**
- Zero breaking changes to existing callers
- Tests get full isolation without module mocking
- Production uses same code path as before
- Gradual migration possible (one caller at a time)

**Alternatives Considered:**
1. **Pure instance-based (no static)**: Rejected - requires updating all callers simultaneously
2. **Module-level reset function**: Rejected - doesn't enable parallel tests
3. **Jest module mocking**: Rejected - fragile, hard to maintain

### ADR-002: Clock Abstraction

**Decision:** Inject `clock: { now(): number }` rather than mocking `Date.now()`.

**Rationale:**
- Explicit dependency makes time-based logic obvious
- No global pollution from Date mocks
- Easy to advance time in tests: `currentTime += 1000`
- Works with parallel tests (each has own clock)

### ADR-003: Dependencies as Single Object

**Decision:** Pass all dependencies as single `ExecutionContextDependencies` object, not separate constructor args.

**Rationale:**
- Easy to spread defaults: `{ ...defaultDeps, clock: mockClock }`
- Self-documenting (interface shows all deps)
- Matches Go-style options pattern

---

## First Implementation Steps

### Step 1: Define Dependencies Interface (1 hour)

```typescript
// src/node/services/ExecutionContextService.ts

export interface ExecutionContextDependencies {
  git: GitAdapter
  worktreeOps: typeof WorktreeOperation
  configStore: { getActiveWorktree(repoPath: string): string | null }
  clock: { now(): number }
  fs: typeof import('fs')
  process: { pid: number; kill(pid: number, signal: number): void; on(event: string, handler: () => void): void }
  randomUUID(): string
}

function createDefaultDependencies(): ExecutionContextDependencies {
  return {
    get git() { return getGitAdapter() },
    worktreeOps: WorktreeOperation,
    configStore,
    clock: { now: () => Date.now() },
    fs,
    process: { pid: process.pid, kill: process.kill.bind(process), on: process.on.bind(process) },
    randomUUID: () => crypto.randomUUID()
  }
}
```

### Step 2: Create Instance Class (2 hours)

```typescript
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

  getDiagnostics() {
    return {
      lockQueueCount: this.lockQueues.size,
      activeContextCount: this.activeContexts.size,
      ttlMs: this.contextTtlMs
    }
  }

  async acquire(repoPath: string, operation?: ExecutionOperation): Promise<ExecutionContext> {
    const now = this.deps.clock.now()
    // ... migrate existing logic, replacing Date.now() with this.deps.clock.now()
  }
}
```

### Step 3: Add Static Facade Methods (1 hour)

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
    return new ExecutionContextServiceInstance({ ...createDefaultDependencies(), ...deps })
  }

  static resetDefaultInstance(): void {
    defaultInstance?.reset()
    defaultInstance = null
  }

  static acquire(repoPath: string, operation?: ExecutionOperation) {
    return getDefaultInstance().acquire(repoPath, operation)
  }
  // ... delegate all other static methods
}
```

### Step 4: Add Test Helpers (1 hour)

```typescript
// src/node/services/__tests__/helpers/mockDependencies.ts
export function createMockClock() {
  let time = Date.now()
  return {
    now: () => time,
    advance: (ms: number) => { time += ms }
  }
}

export function createMockDeps(overrides: Partial<ExecutionContextDependencies> = {}) {
  return {
    git: createMockGitAdapter(),
    worktreeOps: createMockWorktreeOps(),
    configStore: { getActiveWorktree: () => null },
    clock: createMockClock(),
    fs: createMockFs(),
    process: { pid: 12345, kill: vi.fn(), on: vi.fn() },
    randomUUID: () => 'test-uuid',
    ...overrides
  }
}
```

### Step 5: Migrate First Test File (2 hours)

Update `ParallelRebase.test.ts` to use isolated instances and verify tests pass in parallel.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Subtle behavior differences | Run existing tests against both static and instance APIs |
| Performance regression | Singleton is cached, no overhead per call |
| Incomplete dependency list | Add deps incrementally as tests need them |
