# Idea: Worktree Lock File Mechanism

**Source:** `docs/proposals/worktree-improvements.md`
**Status:** Proposed
**Priority:** Medium (reliability)
**Effort:** High (1-2 weeks + testing)

## Problem

Current implementation has potential race conditions:

1. **Concurrent operations**: Two rebase operations targeting same branch could conflict
2. **App crashes during operations**: State can become inconsistent
3. **External interference**: Other git tools could modify worktrees during Teapot operations
4. **Multiple windows**: Users could have multiple Teapot windows on same repo

Current mitigations are reactive (detect stale worktrees after they occur), not proactive.

## Proposed Solution

Implement file-based locking to prevent race conditions.

### Lock File Structure

```typescript
interface WorktreeLock {
  pid: number // Process ID holding the lock
  operation: string // e.g., 'rebase', 'checkout', 'remove'
  worktreePath: string
  acquiredAt: number // Timestamp
  expiresAt: number // Automatic expiry for crash recovery
  instanceId: string // Unique app instance identifier
}
```

### Lock File Location

```
$GIT_DIR/teapot-locks/
  ├── worktree-{hash}.lock    # Per-worktree locks
  └── global.lock             # For operations affecting multiple worktrees
```

### Lock Acquisition

```typescript
static async acquireLock(
  repoPath: string,
  worktreePath: string,
  operation: string
): Promise<LockHandle> {
  const lockPath = this.getLockPath(repoPath, worktreePath)

  const existingLock = await this.readLock(lockPath)
  if (existingLock) {
    if (this.isLockStale(existingLock)) {
      log.warn(`Removing stale lock from PID ${existingLock.pid}`)
      await this.removeLock(lockPath)
    } else {
      throw new WorktreeLockError(
        `Worktree locked by: ${existingLock.operation}`,
        existingLock
      )
    }
  }

  // Atomic acquisition via rename
  const tempPath = `${lockPath}.${process.pid}.tmp`
  await fs.promises.writeFile(tempPath, JSON.stringify(lock))
  await fs.promises.rename(tempPath, lockPath) // Fails if exists
}
```

### Lock Handle with Auto-Refresh

```typescript
class LockHandle {
  private refreshInterval: NodeJS.Timeout

  constructor(lockPath: string, lock: WorktreeLock) {
    // Auto-refresh to prevent expiry during long operations
    this.refreshInterval = setInterval(() => {
      this.refreshFn(this.lockPath)
    }, 10_000)
  }

  async release(): Promise<void> {
    clearInterval(this.refreshInterval)
    await fs.promises.unlink(this.lockPath)
  }
}
```

### Integration

```typescript
static async checkout(repoPath: string, ref: string): Promise<CheckoutResult> {
  const lock = await WorktreeLockService.acquireLock(repoPath, repoPath, 'checkout')
  try {
    // ... existing checkout logic
  } finally {
    await lock.release()
  }
}
```

## Edge Cases Handled

1. **Process crash**: Lock expires after timeout, next operation cleans up
2. **Multiple windows**: Each window has unique instanceId
3. **Long operations**: Auto-refresh prevents premature expiry
4. **Graceful shutdown**: Locks released on app quit

## Configuration

```typescript
const LOCK_TIMEOUT_MS = 30_000 // 30 seconds
const STALE_LOCK_THRESHOLD_MS = 60_000 // 1 minute
const REFRESH_INTERVAL_MS = 10_000 // 10 seconds
```

---

## Architecture Design Decision

### ADR-001: File-Based Locks with JSON Content

**Decision:** Use JSON lock files in `$GIT_DIR/teapot-locks/` with structured metadata.

**Rationale:**

- File system provides atomic rename for lock acquisition
- JSON content enables debugging (who holds lock, when acquired)
- Works across multiple Teapot windows
- No external dependencies (databases, Redis, etc.)

**Alternatives Considered:**

1. **In-memory locks only**: Rejected - doesn't work across processes
2. **Advisory flock()**: Rejected - not reliable across all platforms
3. **Separate lock server**: Rejected - over-engineering for single-machine app

### ADR-002: Atomic Acquisition via Rename

**Decision:** Write to temp file, then rename to lock file. Rename fails if lock exists.

**Rationale:**

- `rename()` is atomic on POSIX systems
- Avoids TOCTOU (time-of-check-to-time-of-use) race
- Clean semantics: success means you have the lock

### ADR-003: Auto-Refresh with Expiry

**Decision:** Locks auto-expire after 60s, with 10s refresh interval.

**Rationale:**

- Handles process crashes (lock eventually expires)
- Long operations stay locked (refresh keeps extending)
- Other processes can detect and recover from stale locks

---

## First Implementation Steps

### Step 1: Create Lock Types (30 min)

```typescript
// src/node/services/WorktreeLockService.ts

interface LockMetadata {
  pid: number
  operation: string
  worktreePath: string
  acquiredAt: number
  expiresAt: number
  instanceId: string
}

interface LockHandle {
  release(): Promise<void>
}

class WorktreeLockError extends Error {
  constructor(
    message: string,
    public readonly existingLock?: LockMetadata
  ) {
    super(message)
    this.name = 'WorktreeLockError'
  }
}
```

### Step 2: Implement Lock Service (2 hours)

```typescript
export class WorktreeLockService {
  private static readonly LOCK_TIMEOUT_MS = 60_000
  private static readonly REFRESH_INTERVAL_MS = 10_000
  private static instanceId = crypto.randomUUID()

  static async acquireLock(
    repoPath: string,
    worktreePath: string,
    operation: string
  ): Promise<LockHandle> {
    const lockDir = path.join(repoPath, '.git', 'teapot-locks')
    await fs.promises.mkdir(lockDir, { recursive: true })

    const lockPath = this.getLockPath(lockDir, worktreePath)

    // Check for existing lock
    const existing = await this.readLock(lockPath)
    if (existing) {
      if (this.isLockStale(existing)) {
        log.warn('[Lock] Removing stale lock', { pid: existing.pid })
        await this.removeLock(lockPath)
      } else if (this.isOurLock(existing)) {
        log.debug('[Lock] Reusing our existing lock')
        return this.createHandle(lockPath, existing)
      } else {
        throw new WorktreeLockError(
          `Worktree locked by ${existing.operation} (PID ${existing.pid})`,
          existing
        )
      }
    }

    // Acquire atomically
    const lock: LockMetadata = {
      pid: process.pid,
      operation,
      worktreePath,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + this.LOCK_TIMEOUT_MS,
      instanceId: this.instanceId
    }

    const tempPath = `${lockPath}.${process.pid}.tmp`
    await fs.promises.writeFile(tempPath, JSON.stringify(lock, null, 2))

    try {
      // Atomic rename - fails if lock exists
      await fs.promises.rename(tempPath, lockPath)
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => {})
      throw new WorktreeLockError('Lock acquisition failed - concurrent access')
    }

    log.info('[Lock] Acquired', { operation, worktreePath })
    return this.createHandle(lockPath, lock)
  }

  private static createHandle(lockPath: string, lock: LockMetadata): LockHandle {
    // Start refresh interval
    const interval = setInterval(async () => {
      try {
        const updated = { ...lock, expiresAt: Date.now() + this.LOCK_TIMEOUT_MS }
        await fs.promises.writeFile(lockPath, JSON.stringify(updated, null, 2))
      } catch {
        // Lock may have been released
      }
    }, this.REFRESH_INTERVAL_MS)

    return {
      release: async () => {
        clearInterval(interval)
        try {
          await fs.promises.unlink(lockPath)
          log.info('[Lock] Released', { operation: lock.operation })
        } catch {
          // Already released
        }
      }
    }
  }

  private static isLockStale(lock: LockMetadata): boolean {
    // Check expiry
    if (Date.now() > lock.expiresAt) return true

    // Check if process still exists
    try {
      process.kill(lock.pid, 0) // Signal 0 = check if process exists
      return false
    } catch {
      return true // Process doesn't exist
    }
  }

  private static isOurLock(lock: LockMetadata): boolean {
    return lock.instanceId === this.instanceId
  }
}
```

### Step 3: Integrate with Operations (1 hour)

```typescript
// src/node/operations/BranchOperation.ts
static async checkout(repoPath: string, ref: string): Promise<CheckoutResult> {
  const lock = await WorktreeLockService.acquireLock(
    repoPath,
    repoPath,
    `checkout:${ref}`
  )

  try {
    return await this._checkout(repoPath, ref)
  } finally {
    await lock.release()
  }
}

// src/node/operations/RebaseExecutor.ts
async executeRebase(repoPath: string): Promise<RebaseResult> {
  const lock = await WorktreeLockService.acquireLock(
    repoPath,
    this.context.executionPath,
    'rebase'
  )

  try {
    return await this._executeRebase()
  } finally {
    await lock.release()
  }
}
```

### Step 4: Add Cleanup on App Quit (30 min)

```typescript
// src/node/main.ts
app.on('before-quit', async () => {
  await WorktreeLockService.releaseAllLocks()
})
```

---

## Risks and Mitigations

| Risk                           | Mitigation                           |
| ------------------------------ | ------------------------------------ |
| Lock file persists after crash | Auto-expiry + stale detection        |
| Rename not atomic on Windows   | Use `fs-extra` with proper flags     |
| Too many lock files            | Clean up old locks periodically      |
| Lock contention in UI          | Show "operation in progress" message |
