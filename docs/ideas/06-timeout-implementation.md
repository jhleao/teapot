# Idea: Timeout Implementation for Async Operations

**Source:** `docs/timeout-implementation.md`
**Status:** Proposed
**Priority:** High

## Problem

Async operations have no timeout protection. If a git operation hangs (network issues, large repo, corrupted state), the entire operation blocks indefinitely:

1. "Reply was never sent" errors in IPC handlers
2. UI freezes with infinite loading spinners
3. Resource exhaustion - blocked operations hold locks forever
4. No way to cancel or recover

## Proposed Solution

### Core Utility: `withTimeout`

```typescript
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly timeoutMs: number
  ) {
    super(message)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(
          `${operation} timed out after ${timeoutMs}ms`,
          operation,
          timeoutMs
        ))
      }, timeoutMs)
      timer.unref?.() // Don't block Node.js exit
    })
  ])
}
```

### Timeout Configuration

```typescript
export const Timeouts = {
  GIT_FETCH: 60_000,        // 60s - network
  GIT_REBASE: 120_000,      // 2min - large branches
  GIT_CHECKOUT: 30_000,     // 30s
  GIT_STATUS: 10_000,       // 10s
  GIT_LOG: 30_000,          // 30s

  LOCK_ACQUIRE: 30_000,     // 30s
  FILE_LOCK: 5_000,         // 5s

  CONTEXT_ACQUIRE: 60_000,  // 60s - may create worktree
  WORKTREE_CREATE: 30_000,  // 30s
  WORKTREE_REMOVE: 10_000,  // 10s

  IPC_DEFAULT: 120_000,     // 2min
  FORGE_API: 30_000,        // 30s
} as const
```

### Integration Points

1. **ExecutionContextService** - Wrap `acquire()` and lock operations
2. **Git Adapter** - Wrap all git operations
3. **IPC Handlers** - `wrapHandler()` utility for all handlers
4. **ContextScope** - Optional max lifetime

### Cancellation Support

```typescript
export function withTimeoutAndCancellation<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operation: string,
  externalSignal?: AbortSignal
): Promise<T>
```

## Implementation Phases

1. **Core Infrastructure**: Add utilities, TimeoutError, configuration
2. **Lock Acquisition**: Timeout on mutex and file locks
3. **Git Operations**: Wrap fetch, rebase, status
4. **IPC Handlers**: Apply to all handlers
5. **Cancellation**: AbortController support, UI cancel buttons

## Open Questions

1. What happens to in-flight git operations when timeout occurs? May need "abandoned" vs "clean" context states.
2. Should timeout config be user-adjustable? (Power users with slow networks)
3. How to handle partial completion? (Rebase timeout mid-stack)

## Rollout Strategy

1. Feature flag: `TEAPOT_ENABLE_TIMEOUTS`
2. Start with long timeouts, reduce based on telemetry
3. Track timeout occurrences in logs
4. Surface errors clearly in UI

---

## Architecture Design Decision

### ADR-001: Promise.race with Timer Pattern

**Decision:** Use `Promise.race()` with a timeout promise rather than AbortController alone.

**Rationale:**
- Works with any promise (no AbortSignal support required)
- Simple to understand and implement
- Timer cleanup via `unref()` doesn't block process exit

**Alternatives Considered:**
1. **AbortController only**: Rejected - many git operations don't support cancellation
2. **Wrapper library (p-timeout)**: Rejected - adds dependency, same pattern
3. **Global timeout per operation type**: Rejected - less flexible

### ADR-002: Centralized Timeout Configuration

**Decision:** All timeout values defined in single `Timeouts` const object.

**Rationale:**
- Easy to find and adjust all timeouts
- Consistent naming convention
- Can be overridden via env vars if needed

### ADR-003: TimeoutError as Distinct Type

**Decision:** Create `TimeoutError` class with operation name and timeout value.

**Rationale:**
- Can distinguish from other errors in catch blocks
- Error message includes useful debugging info
- Enables specific handling (e.g., retry with longer timeout)

---

## First Implementation Steps

### Step 1: Create Core Utilities (1 hour)

```typescript
// src/node/utils/timeout.ts
export class TimeoutError extends Error {
  readonly name = 'TimeoutError'

  constructor(
    message: string,
    public readonly operation: string,
    public readonly timeoutMs: number
  ) {
    super(message)
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(
        `${operation} timed out after ${timeoutMs}ms`,
        operation,
        timeoutMs
      ))
    }, timeoutMs)
    timeoutId.unref?.()
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}
```

### Step 2: Define Timeout Constants (30 min)

```typescript
// src/node/config/timeouts.ts
export const Timeouts = {
  // Git operations
  GIT_STATUS: 10_000,
  GIT_LOG: 30_000,
  GIT_CHECKOUT: 30_000,
  GIT_FETCH: 60_000,
  GIT_REBASE: 120_000,

  // Lock operations
  LOCK_ACQUIRE: 30_000,
  FILE_LOCK: 5_000,

  // Context operations
  CONTEXT_ACQUIRE: 60_000,
  WORKTREE_CREATE: 30_000,
  WORKTREE_REMOVE: 10_000,

  // IPC/API
  IPC_DEFAULT: 120_000,
  FORGE_API: 30_000,
} as const

// Allow override via env
export function getTimeout(key: keyof typeof Timeouts): number {
  const envKey = `TEAPOT_TIMEOUT_${key}`
  const envValue = process.env[envKey]
  return envValue ? parseInt(envValue, 10) : Timeouts[key]
}
```

### Step 3: Wrap Git Adapter Methods (2 hours)

```typescript
// src/node/git/SimpleGitAdapter.ts
async status(repoPath: string): Promise<StatusResult> {
  return withTimeout(
    this._status(repoPath),
    getTimeout('GIT_STATUS'),
    `git status in ${repoPath}`
  )
}

async rebase(repoPath: string, onto: string): Promise<RebaseResult> {
  return withTimeout(
    this._rebase(repoPath, onto),
    getTimeout('GIT_REBASE'),
    `git rebase onto ${onto}`
  )
}
```

### Step 4: Wrap IPC Handlers (1 hour)

```typescript
// src/node/ipc/wrapHandler.ts
export function wrapHandler<T, R>(
  handler: (args: T) => Promise<R>,
  timeoutMs = Timeouts.IPC_DEFAULT
): (args: T) => Promise<R> {
  return async (args: T) => {
    const operation = handler.name || 'IPC handler'
    return withTimeout(handler(args), timeoutMs, operation)
  }
}

// Usage
ipcMain.handle('rebase:start', wrapHandler(handleRebaseStart, Timeouts.GIT_REBASE))
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Timeout during valid long operation | Start with generous timeouts, tune via telemetry |
| Orphaned resources after timeout | Add cleanup callback to withTimeout |
| User-specific slow networks | Allow env var overrides |
| Partial operation completion | Document "abandoned" state handling |
