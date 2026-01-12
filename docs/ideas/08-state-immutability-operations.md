# Idea: State Immutability During Operations

**Source:** `docs/post-mortems/2025-01-resume-rebase-queue-dialog.md`
**Status:** Proposed (from post-mortem lessons)
**Priority:** Medium

## Problem Context

Git file watchers trigger state refreshes at any time. During the rebase dialog bug:

1. `submitRebaseIntent` returned correct `prompting` status
2. Git watcher immediately triggered `getUiState()`
3. Refresh overwrote state with incorrect `queued` status
4. User saw wrong dialog

The correct state existed briefly but was replaced by watcher-triggered refresh.

## Proposed Solution

Implement a mechanism to prevent watcher-triggered refreshes from overwriting operation-initiated state changes.

### Option A: Operation Lock Flag

```typescript
class UiStateManager {
  private operationInProgress = false
  private pendingRefresh = false

  async withOperation<T>(fn: () => Promise<T>): Promise<T> {
    this.operationInProgress = true
    try {
      return await fn()
    } finally {
      this.operationInProgress = false
      if (this.pendingRefresh) {
        this.pendingRefresh = false
        await this.refresh()
      }
    }
  }

  async onWatcherTrigger(): Promise<void> {
    if (this.operationInProgress) {
      this.pendingRefresh = true // Defer until operation completes
      return
    }
    await this.refresh()
  }
}
```

### Option B: Versioned State with Conflict Resolution

```typescript
interface UiState {
  version: number
  source: 'operation' | 'watcher'
  timestamp: number
  // ...
}

// Only accept watcher updates if no recent operation
function shouldAcceptUpdate(current: UiState, incoming: UiState): boolean {
  if (incoming.source === 'operation') return true
  if (current.source === 'operation' &&
      Date.now() - current.timestamp < 1000) {
    return false // Protect operation state for 1 second
  }
  return true
}
```

### Option C: Debounced Watcher with Operation Priority

```typescript
class StateManager {
  private debounceTimer?: NodeJS.Timeout
  private lastOperationTime = 0

  triggerWatcherRefresh(): void {
    clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      // Only refresh if no recent operation
      if (Date.now() - this.lastOperationTime > 500) {
        this.refresh()
      }
    }, 100) // Debounce watcher events
  }

  async executeOperation<T>(fn: () => Promise<T>): Promise<T> {
    this.lastOperationTime = Date.now()
    return fn()
  }
}
```

## Recommendation

**Option A** is simplest and most explicit:
- Clear lock semantics
- Deferred refresh ensures eventual consistency
- Easy to debug (log when refresh is deferred)

## Implementation Steps

1. Add operation lock to state manager
2. Wrap IPC handlers that modify state with `withOperation`
3. Add deferred refresh logic to watcher
4. Log when refreshes are deferred for debugging
5. Add integration tests simulating watcher interference

---

## Architecture Design Decision

### ADR-001: Operation Lock with Deferred Refresh (Option A)

**Decision:** Implement Option A - explicit operation lock flag with deferred refresh on unlock.

**Rationale:**
- Simplest mental model: operations "own" state during execution
- Deferred refresh ensures eventual consistency
- Easy to debug (log when refresh is deferred)
- No timing heuristics or version numbers to manage

**Alternatives Considered:**
1. **Versioned state (Option B)**: Rejected - adds complexity, still has race window
2. **Debounced watcher (Option C)**: Rejected - arbitrary timing, can still race
3. **Disable watcher during operations**: Rejected - misses legitimate changes

### ADR-002: Watcher Coalescing

**Decision:** Coalesce rapid watcher events into single deferred refresh.

**Rationale:**
- Git operations trigger multiple file changes
- Each change fires watcher event
- Single refresh after operation is sufficient

---

## First Implementation Steps

### Step 1: Create Operation Lock Manager (1 hour)

```typescript
// src/node/state/OperationLock.ts
export class OperationLock {
  private operationInProgress = false
  private pendingRefresh = false
  private operationName: string | null = null

  async withOperation<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.operationInProgress) {
      log.warn('[OperationLock] Nested operation detected', {
        current: this.operationName,
        attempted: name
      })
    }

    this.operationInProgress = true
    this.operationName = name

    log.debug('[OperationLock] Operation started', { name })

    try {
      return await fn()
    } finally {
      this.operationInProgress = false
      this.operationName = null

      if (this.pendingRefresh) {
        log.debug('[OperationLock] Executing deferred refresh')
        this.pendingRefresh = false
        // Emit refresh event instead of calling directly
        this.emitRefresh()
      }
    }
  }

  tryScheduleRefresh(): boolean {
    if (this.operationInProgress) {
      log.debug('[OperationLock] Refresh deferred during operation', {
        operation: this.operationName
      })
      this.pendingRefresh = true
      return false // Refresh deferred
    }
    return true // OK to refresh now
  }

  private emitRefresh(): void {
    // Use event emitter to decouple from refresh implementation
    stateEvents.emit('refresh-requested')
  }
}

export const operationLock = new OperationLock()
```

### Step 2: Integrate with Watcher (30 min)

```typescript
// src/node/watchers/gitWatcher.ts
function onFileChange(path: string): void {
  // Try to schedule refresh - may be deferred if operation in progress
  if (operationLock.tryScheduleRefresh()) {
    scheduleRefresh()
  }
  // If deferred, refresh will happen when operation completes
}
```

### Step 3: Wrap IPC Handlers (1 hour)

```typescript
// src/node/handlers/rebaseHandlers.ts
export async function handleSubmitIntent(args: IntentArgs): Promise<IntentResult> {
  return operationLock.withOperation('submitRebaseIntent', async () => {
    // All state changes here are protected from watcher interference
    const session = createSession(args.repoPath, args.queue)
    return { status: 'prompting', session }
  })
}

export async function handleConfirmRebase(args: ConfirmArgs): Promise<void> {
  return operationLock.withOperation('confirmRebase', async () => {
    setSessionPhase(args.repoPath, 'executing')
    await executeRebase(args.repoPath)
  })
}
```

### Step 4: Add Integration Tests (2 hours)

```typescript
// src/node/__tests__/OperationLock.test.ts
describe('OperationLock', () => {
  it('defers refresh during operation', async () => {
    const refreshSpy = vi.fn()
    stateEvents.on('refresh-requested', refreshSpy)

    await operationLock.withOperation('test', async () => {
      // Simulate watcher event during operation
      const scheduled = operationLock.tryScheduleRefresh()
      expect(scheduled).toBe(false)
      expect(refreshSpy).not.toHaveBeenCalled()
    })

    // Refresh should happen after operation completes
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('allows refresh outside operation', () => {
    const scheduled = operationLock.tryScheduleRefresh()
    expect(scheduled).toBe(true)
  })
})
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Long operations block all refreshes | Add timeout for operation lock |
| Forgotten unlock (exception) | try/finally pattern ensures unlock |
| Missed state changes | Deferred refresh catches up |
| Nested operations | Log warning, allow but track |
