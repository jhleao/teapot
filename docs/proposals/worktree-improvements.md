# Worktree Management Improvements - Feature Proposals

This document outlines three proposed improvements to the worktree management system that would enhance observability, reliability, and maintainability.

---

## 1. Stale Worktree Recovery Telemetry

### What

Add metrics and telemetry to track how often stale worktree recovery occurs, including:
- Count of stale worktrees detected (by reason: `marked_prunable` vs `directory_missing`)
- Count of successful prunes
- Count of failed prunes
- Count of retries triggered by `retryWithPrune`
- Time spent in recovery operations

### Why

**Problem**: We currently have no visibility into how often stale worktree recovery happens in production. This matters because:

1. **Systemic issues go undetected**: If users frequently encounter stale worktrees, it indicates a deeper problem (e.g., app crashes, improper shutdown, external interference). Without metrics, we can't detect these patterns.

2. **Performance impact is invisible**: Prune operations add latency. If they're happening frequently, users experience degraded performance without us knowing.

3. **Debugging is difficult**: When users report issues, we have no data to understand if worktree corruption is a factor.

4. **Success rate is unknown**: We don't know if our recovery mechanisms are actually working effectively.

### Proposed Implementation

#### 1.1 Define Telemetry Events

```typescript
// src/shared/types/telemetry.ts
export type WorktreeTelemetryEvent = {
  type: 'worktree_stale_detected'
  reason: 'marked_prunable' | 'directory_missing'
  worktreePath: string
  operation: 'checkout' | 'cleanup' | 'delete' | 'rebase'
} | {
  type: 'worktree_prune_attempted'
  success: boolean
  error?: string
  durationMs: number
} | {
  type: 'worktree_retry_triggered'
  operation: string
  attempt: number
  worktreePath: string
}
```

#### 1.2 Create Telemetry Service

```typescript
// src/node/services/TelemetryService.ts
export class TelemetryService {
  private static events: WorktreeTelemetryEvent[] = []
  private static readonly MAX_EVENTS = 1000

  static record(event: WorktreeTelemetryEvent): void {
    this.events.push({
      ...event,
      timestamp: Date.now()
    })

    // Rotate buffer
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS)
    }

    // Log for immediate visibility
    log.info('[Telemetry]', event)
  }

  static getStats(): WorktreeTelemetryStats {
    // Aggregate and return statistics
  }

  static export(): string {
    // Export as JSON for debugging/support
  }
}
```

#### 1.3 Instrument `WorktreeUtils`

```typescript
// In pruneStaleWorktrees
const startTime = Date.now()
try {
  await git.pruneWorktrees(repoPath)
  TelemetryService.record({
    type: 'worktree_prune_attempted',
    success: true,
    durationMs: Date.now() - startTime
  })
  return { pruned: true }
} catch (error) {
  TelemetryService.record({
    type: 'worktree_prune_attempted',
    success: false,
    error: message,
    durationMs: Date.now() - startTime
  })
  return { pruned: false, error: message }
}
```

#### 1.4 Add Developer Tools UI

Add a "Diagnostics" section in settings/developer tools that shows:
- Recent worktree events
- Aggregate statistics
- Export button for support tickets

### Effort Estimate

- **Small**: 2-3 days for basic event logging
- **Medium**: 1 week for full implementation with UI
- **Dependencies**: None

---

## 2. Worktree Lock File Mechanism

### What

Implement a file-based locking mechanism to prevent race conditions when multiple processes or operations attempt to modify worktrees concurrently.

### Why

**Problem**: The current implementation has several potential race conditions:

1. **Concurrent operations**: Two rebase operations targeting the same branch could conflict.

2. **App crashes during operations**: If the app crashes while modifying a worktree, the state can become inconsistent.

3. **External interference**: Other git tools or processes could modify worktrees while Teapot is operating on them.

4. **Multiple windows**: Users could have multiple Teapot windows open on the same repo.

**Current mitigations are insufficient**:
- We detect stale worktrees *after* they occur, not prevent them
- `git worktree prune` is reactive, not proactive
- No coordination between concurrent operations

### Proposed Implementation

#### 2.1 Lock File Structure

```typescript
// src/node/services/WorktreeLockService.ts
interface WorktreeLock {
  pid: number           // Process ID holding the lock
  operation: string     // e.g., 'rebase', 'checkout', 'remove'
  worktreePath: string
  acquiredAt: number    // Timestamp
  expiresAt: number     // Automatic expiry for crash recovery
  instanceId: string    // Unique app instance identifier
}
```

#### 2.2 Lock File Location

```
$GIT_DIR/teapot-locks/
  ├── worktree-{hash}.lock    # Per-worktree locks
  └── global.lock             # For operations affecting multiple worktrees
```

#### 2.3 Lock Acquisition

```typescript
export class WorktreeLockService {
  private static readonly LOCK_TIMEOUT_MS = 30_000 // 30 seconds
  private static readonly STALE_LOCK_THRESHOLD_MS = 60_000 // 1 minute

  static async acquireLock(
    repoPath: string,
    worktreePath: string,
    operation: string
  ): Promise<LockHandle> {
    const lockPath = this.getLockPath(repoPath, worktreePath)

    // Check for existing lock
    const existingLock = await this.readLock(lockPath)
    if (existingLock) {
      // Check if lock is stale (process died)
      if (this.isLockStale(existingLock)) {
        log.warn(`[WorktreeLock] Removing stale lock from PID ${existingLock.pid}`)
        await this.removeLock(lockPath)
      } else {
        throw new WorktreeLockError(
          `Worktree is locked by another operation: ${existingLock.operation}`,
          existingLock
        )
      }
    }

    // Acquire lock atomically using rename
    const lock: WorktreeLock = {
      pid: process.pid,
      operation,
      worktreePath,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + this.LOCK_TIMEOUT_MS,
      instanceId: this.getInstanceId()
    }

    await this.writeLockAtomic(lockPath, lock)

    // Return handle for releasing
    return new LockHandle(lockPath, lock, this.refresh.bind(this))
  }

  private static async writeLockAtomic(
    lockPath: string,
    lock: WorktreeLock
  ): Promise<void> {
    const tempPath = `${lockPath}.${process.pid}.tmp`
    await fs.promises.writeFile(tempPath, JSON.stringify(lock))

    // Atomic rename - fails if file exists
    try {
      await fs.promises.rename(tempPath, lockPath)
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => {})
      throw new WorktreeLockError('Lock acquisition failed - concurrent access')
    }
  }
}
```

#### 2.4 Lock Handle with Auto-Refresh

```typescript
class LockHandle {
  private refreshInterval: NodeJS.Timeout
  private released = false

  constructor(
    private lockPath: string,
    private lock: WorktreeLock,
    private refreshFn: (path: string) => Promise<void>
  ) {
    // Auto-refresh lock to prevent expiry during long operations
    this.refreshInterval = setInterval(() => {
      if (!this.released) {
        this.refreshFn(this.lockPath).catch(err => {
          log.error('[WorktreeLock] Failed to refresh lock:', err)
        })
      }
    }, 10_000) // Refresh every 10 seconds
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    clearInterval(this.refreshInterval)
    await fs.promises.unlink(this.lockPath).catch(() => {})
  }
}
```

#### 2.5 Integration with Operations

```typescript
// In BranchOperation.checkout
static async checkout(repoPath: string, ref: string): Promise<CheckoutResult> {
  const lock = await WorktreeLockService.acquireLock(repoPath, repoPath, 'checkout')
  try {
    // ... existing checkout logic
  } finally {
    await lock.release()
  }
}
```

### Edge Cases Handled

1. **Process crash**: Lock expires after timeout, next operation cleans it up
2. **Multiple windows**: Each window has unique instanceId, can detect own locks
3. **Long operations**: Auto-refresh prevents premature expiry
4. **Graceful shutdown**: Locks released on app quit

### Effort Estimate

- **Medium**: 1-2 weeks for full implementation
- **Testing**: Additional week for edge case testing
- **Dependencies**: None

---

## 3. Simplified `pruneStaleWorktrees` API

### What

Simplify the `pruneStaleWorktrees` return type from `{ pruned: boolean; error?: string }` to either `void` (throwing on error) or just `boolean`, based on usage analysis.

### Why

**Problem**: The current API returns a result object, but:

1. **Most callers ignore it**:
   ```typescript
   // In watchRepo handler
   pruneStaleWorktrees(repoPath).catch((error) => {
     log.warn('[watchRepo] Failed to prune stale worktrees:', error)
   })

   // In WorktreeOperation.remove
   await pruneStaleWorktrees(repoPath)
   return { success: true }
   ```

2. **Inconsistent error handling**: Some callers expect exceptions, others expect result objects.

3. **The `error` field is rarely useful**: When prune fails, we typically just log and continue anyway.

4. **Makes composition harder**: Can't easily chain with other async operations.

### Current Usage Analysis

| Location | Uses `pruned`? | Uses `error`? | Notes |
|----------|---------------|---------------|-------|
| `watchRepo` | No | No | Fire-and-forget |
| `WorktreeOperation.remove` | No | No | Always returns success after prune |
| `BranchOperation.removeWorktreeForBranch` | No | No | Via `pruneIfStale` |
| `retryWithPrune` | Yes | No | Only checks if pruned succeeded |
| `pruneIfStale` | Yes | No | Propagates `pruned` status |

### Proposed Options

#### Option A: Throw on Error (Recommended)

```typescript
/**
 * Prunes stale worktree references from git's registry.
 *
 * @throws Error if pruning fails
 */
export async function pruneStaleWorktrees(repoPath: string): Promise<void> {
  const git = getGitAdapter()
  try {
    await git.pruneWorktrees(repoPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`[WorktreeUtils] Failed to prune worktrees:`, { error: message })
    throw new WorktreePruneError(message)
  }
}
```

**Pros**:
- Standard async/await pattern
- Callers can choose to catch or not
- Composable with other operations

**Cons**:
- Breaking change for `retryWithPrune`
- Existing `.catch()` handlers still work

#### Option B: Return Boolean Only

```typescript
/**
 * Prunes stale worktree references from git's registry.
 *
 * @returns true if pruning succeeded, false if it failed (logged internally)
 */
export async function pruneStaleWorktrees(repoPath: string): Promise<boolean> {
  const git = getGitAdapter()
  try {
    await git.pruneWorktrees(repoPath)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`[WorktreeUtils] Failed to prune worktrees:`, { error: message })
    return false
  }
}
```

**Pros**:
- Simpler return type
- Maintains "always succeeds" semantics

**Cons**:
- Hides errors from callers who might want them
- Non-standard pattern

#### Option C: Keep Current API

No changes - accept the slight inconsistency for backwards compatibility.

### Recommendation

**Option A** is recommended because:
1. It follows standard JavaScript async patterns
2. Existing `.catch()` handlers continue to work
3. Callers who don't care about errors can use `.catch(() => {})` explicitly
4. Makes the "swallowing errors" choice explicit at call sites

### Migration Path

1. Update `pruneStaleWorktrees` to throw
2. Update `retryWithPrune` to catch and handle
3. Update `pruneIfStale` to catch and return status
4. No changes needed for fire-and-forget callers (already using `.catch()`)

### Effort Estimate

- **Small**: 1-2 hours
- **Risk**: Low (mostly internal change)
- **Dependencies**: None

---

## Summary

| Proposal | Effort | Impact | Risk | Priority |
|----------|--------|--------|------|----------|
| 1. Telemetry | Medium | High (observability) | Low | High |
| 2. Lock Files | High | High (reliability) | Medium | Medium |
| 3. API Simplification | Low | Low (maintainability) | Low | Low |

### Recommended Implementation Order

1. **API Simplification** - Quick win, improves code quality
2. **Telemetry** - Provides data to inform future decisions
3. **Lock Files** - Only if telemetry shows significant race condition issues
