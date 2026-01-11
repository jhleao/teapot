# Timeout Implementation Design Document

## Problem Statement

Currently, async operations in Teapot have no timeout protection. If a git operation hangs (network issues, large repo, corrupted state), the entire operation blocks indefinitely, causing:

1. **"Reply was never sent" errors** - IPC handlers never return
2. **UI freezes** - Users see infinite loading spinners
3. **Resource exhaustion** - Blocked operations hold locks forever
4. **Poor user experience** - No way to cancel or recover

## Goals

1. Add configurable timeouts to all async operations
2. Provide clear error messages when timeouts occur
3. Support cancellation for long-running operations
4. Maintain backwards compatibility
5. Minimize code changes while maximizing coverage

## Design

### Core Utility: `withTimeout`

A generic wrapper that races any promise against a timeout:

```typescript
// src/node/utils/timeout.ts

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
      // Don't block Node.js from exiting
      timer.unref?.()
    })
  ])
}
```

### Configuration: Timeout Presets

Centralized timeout configuration for different operation types:

```typescript
// src/node/config/timeouts.ts

export const Timeouts = {
  // Git operations
  GIT_FETCH: 60_000,         // 60s - network operation
  GIT_REBASE: 120_000,       // 2min - can be slow for large branches
  GIT_CHECKOUT: 30_000,      // 30s - usually fast
  GIT_STATUS: 10_000,        // 10s - should be quick
  GIT_LOG: 30_000,           // 30s - depends on history size

  // Lock acquisition
  LOCK_ACQUIRE: 30_000,      // 30s - waiting for other operations
  FILE_LOCK: 5_000,          // 5s - file system lock

  // Context operations
  CONTEXT_ACQUIRE: 60_000,   // 60s - may create worktree
  WORKTREE_CREATE: 30_000,   // 30s - git worktree add
  WORKTREE_REMOVE: 10_000,   // 10s - git worktree remove

  // IPC operations
  IPC_DEFAULT: 120_000,      // 2min - default for IPC handlers

  // Forge operations
  FORGE_API: 30_000,         // 30s - GitHub/GitLab API calls
} as const

export type TimeoutKey = keyof typeof Timeouts

// Allow runtime configuration override
const overrides: Partial<typeof Timeouts> = {}

export function getTimeout(key: TimeoutKey): number {
  return overrides[key] ?? Timeouts[key]
}

export function setTimeoutOverride(key: TimeoutKey, ms: number): void {
  overrides[key] = ms
}
```

### Integration Points

#### 1. ExecutionContextService

```typescript
// src/node/services/ExecutionContextService.ts

import { withTimeout } from '../utils/timeout'
import { getTimeout } from '../config/timeouts'

export class ExecutionContextService {
  static async acquire(
    repoPath: string,
    operation: ExecutionOperation = 'unknown'
  ): Promise<ExecutionContext> {
    return withTimeout(
      this.acquireInternal(repoPath, operation),
      getTimeout('CONTEXT_ACQUIRE'),
      `acquire execution context for ${operation}`
    )
  }

  private static async acquireLock(repoPath: string): Promise<() => Promise<void>> {
    const mutex = getRepoMutex(repoPath)

    // Timeout on mutex acquisition
    const releaseMutex = await withTimeout(
      mutex.acquire(),
      getTimeout('LOCK_ACQUIRE'),
      'acquire repository mutex'
    )

    try {
      // Timeout on file lock
      await withTimeout(
        this.acquireFileLock(repoPath),
        getTimeout('FILE_LOCK'),
        'acquire file lock'
      )
      return async () => {
        await this.releaseFileLock(repoPath)
        releaseMutex()
      }
    } catch (error) {
      releaseMutex()
      throw error
    }
  }
}
```

#### 2. Git Adapter

```typescript
// src/node/adapters/git/SimpleGitAdapter.ts

import { withTimeout } from '../../utils/timeout'
import { getTimeout } from '../../config/timeouts'

export class SimpleGitAdapter implements GitAdapter {
  async fetch(repoPath: string, remote: string): Promise<void> {
    return withTimeout(
      this.git(repoPath).fetch(remote),
      getTimeout('GIT_FETCH'),
      `git fetch ${remote}`
    )
  }

  async rebase(repoPath: string, options: RebaseOptions): Promise<RebaseResult> {
    return withTimeout(
      this.rebaseInternal(repoPath, options),
      getTimeout('GIT_REBASE'),
      `git rebase onto ${options.onto}`
    )
  }

  async getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
    return withTimeout(
      this.statusInternal(repoPath),
      getTimeout('GIT_STATUS'),
      'git status'
    )
  }
}
```

#### 3. IPC Handlers

Wrap all IPC handlers with a default timeout:

```typescript
// src/node/handlers/wrapHandler.ts

import { withTimeout, TimeoutError } from '../utils/timeout'
import { getTimeout } from '../config/timeouts'

export function wrapHandler<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  operationName: string,
  timeoutMs?: number
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await withTimeout(
        handler(...args),
        timeoutMs ?? getTimeout('IPC_DEFAULT'),
        operationName
      )
    } catch (error) {
      if (error instanceof TimeoutError) {
        // Log timeout for debugging
        log.error({ err: error, operation: operationName }, 'IPC handler timed out')
        // Return user-friendly error
        throw new Error(`Operation timed out: ${operationName}. Please try again.`)
      }
      throw error
    }
  }) as T
}

// Usage in handlers registration:
ipcMain.handle(
  IPC_CHANNELS.confirmRebaseIntent,
  wrapHandler(confirmRebaseIntent, 'confirmRebaseIntent')
)
```

#### 4. ContextScope Enhancement

```typescript
// src/node/services/ContextScope.ts

export class ContextScope implements Disposable {
  private timeoutId?: NodeJS.Timeout

  static async acquire(
    repoPath: string,
    operation: ExecutionOperation = 'unknown',
    options: { timeoutMs?: number } = {}
  ): Promise<ContextScope> {
    const timeoutMs = options.timeoutMs ?? getTimeout('CONTEXT_ACQUIRE')

    const context = await withTimeout(
      ExecutionContextService.acquire(repoPath, operation),
      timeoutMs,
      `acquire context for ${operation}`
    )

    return new ContextScope(repoPath, context)
  }

  /**
   * Set a maximum lifetime for this context.
   * If exceeded, the context will be automatically released.
   */
  setMaxLifetime(ms: number, onTimeout?: () => void): void {
    this.timeoutId = setTimeout(() => {
      log.warn(`Context lifetime exceeded (${ms}ms), auto-releasing`)
      onTimeout?.()
      void this.disposeAsync()
    }, ms)
    this.timeoutId.unref?.()
  }

  async disposeAsync(): Promise<void> {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
    // ... existing cleanup
  }
}
```

### Cancellation Support

For operations that support cancellation:

```typescript
// src/node/utils/cancellation.ts

export function withCancellation<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error('Operation cancelled'))
  }

  return new Promise((resolve, reject) => {
    const abortHandler = () => reject(new Error('Operation cancelled'))
    signal?.addEventListener('abort', abortHandler, { once: true })

    fn(signal ?? new AbortController().signal)
      .then(resolve)
      .catch(reject)
      .finally(() => signal?.removeEventListener('abort', abortHandler))
  })
}

// Combined timeout + cancellation
export function withTimeoutAndCancellation<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operation: string,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController()

  // Link external signal
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  timeoutId.unref?.()

  return fn(controller.signal)
    .finally(() => clearTimeout(timeoutId))
    .catch(error => {
      if (controller.signal.aborted && !externalSignal?.aborted) {
        throw new TimeoutError(`${operation} timed out after ${timeoutMs}ms`, operation, timeoutMs)
      }
      throw error
    })
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Low Risk)
1. Add `withTimeout` utility
2. Add `TimeoutError` class
3. Add timeout configuration module
4. Add tests for timeout utilities

### Phase 2: Lock Acquisition (Medium Risk)
1. Add timeout to `acquireLock` in ExecutionContextService
2. Add timeout to file lock acquisition
3. Update tests

### Phase 3: Git Operations (Medium Risk)
1. Wrap git fetch with timeout
2. Wrap git rebase with timeout
3. Wrap git status with timeout
4. Update integration tests

### Phase 4: IPC Handlers (Low Risk)
1. Create `wrapHandler` utility
2. Apply to all IPC handlers
3. Add timeout logging

### Phase 5: Cancellation (Higher Risk)
1. Add AbortController support
2. Wire through to git operations where possible
3. Add UI cancellation buttons

## Testing Strategy

### Unit Tests

```typescript
describe('withTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(
      Promise.resolve('success'),
      1000,
      'test'
    )
    expect(result).toBe('success')
  })

  it('rejects with TimeoutError when timeout exceeded', async () => {
    await expect(
      withTimeout(
        new Promise(() => {}), // never resolves
        100,
        'test operation'
      )
    ).rejects.toThrow(TimeoutError)
  })

  it('includes operation name in error', async () => {
    try {
      await withTimeout(new Promise(() => {}), 100, 'my operation')
    } catch (e) {
      expect(e.operation).toBe('my operation')
      expect(e.timeoutMs).toBe(100)
    }
  })
})
```

### Integration Tests

```typescript
describe('ExecutionContextService with timeouts', () => {
  it('times out when lock cannot be acquired', async () => {
    // Hold the lock
    const scope1 = await ContextScope.acquire(repoPath)

    // Try to acquire with short timeout
    await expect(
      ContextScope.acquire(repoPath, 'rebase', { timeoutMs: 100 })
    ).rejects.toThrow(TimeoutError)

    await scope1.disposeAsync()
  })
})
```

## Monitoring & Observability

### Logging

```typescript
// Log all timeout occurrences
log.error({
  err: error,
  operation,
  timeoutMs,
  component: 'timeout'
}, 'Operation timed out')
```

### Metrics (Future)

Consider adding metrics for:
- Operation duration distribution
- Timeout frequency by operation type
- Lock wait times

## Rollout Strategy

1. **Feature flag**: Add `TEAPOT_ENABLE_TIMEOUTS` env var
2. **Gradual rollout**: Start with long timeouts, reduce based on telemetry
3. **Monitoring**: Track timeout occurrences in logs
4. **User feedback**: Surface timeout errors clearly in UI

## Open Questions

1. **What should happen to in-flight git operations when timeout occurs?**
   - Git operations can't always be cleanly cancelled
   - May need to wait for git to finish even after timeout
   - Consider marking context as "abandoned" vs "clean"

2. **Should we expose timeout configuration to users?**
   - Power users might want to adjust for slow networks
   - Could add to Settings UI

3. **How to handle partial completion?**
   - Rebase might timeout mid-stack
   - Need to ensure consistent state
   - Consider checkpointing

## References

- [async-mutex documentation](https://www.npmjs.com/package/async-mutex)
- [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [Node.js Timers](https://nodejs.org/api/timers.html)
