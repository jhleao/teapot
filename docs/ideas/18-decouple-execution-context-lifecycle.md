# Idea: Decouple Execution Context from Finalization Lifecycle

**Source:** `architecture-issues-rebase-worktree-lifecycle.md` (Issue 2: Lifecycle Coupling)
**Status:** Proposed
**Priority:** Medium (architecture, maintainability)
**Effort:** High (2 weeks)

## Problem

The temporary execution worktree is managed by `ExecutionContextService` with an acquire/release pattern:

```
acquire() → [operation runs] → release()
```

The `executeWithContext` helper enforces this pattern, calling `release()` after the operation callback completes. However, `finalizeRebase` runs _inside_ that callback and needs to perform operations that conflict with the execution context still existing.

### The Conflict

When finalizing a rebase:

1. The temp worktree may have the rebased branch checked out
2. Finalization wants to re-checkout that branch in another worktree
3. Git refuses: "branch is already used by worktree"
4. Current fix: Detach HEAD in temp worktree before finalization

This creates a **temporal dependency**: finalization logic needs the temp worktree to be released, but release happens _after_ finalization.

### Current Workaround

```typescript
async function finalizeRebase(context: ExecutionContext): Promise<void> {
  // WORKAROUND: Detach HEAD in temp worktree to free branch ref
  await git.checkout(context.executionPath, '--detach')

  // Now we can re-checkout branches in other worktrees
  for (const { worktreePath, branch } of autoDetachedWorktrees) {
    await git.checkout(worktreePath, branch)
  }
}
```

This workaround:

- Reaches into execution context's internal state
- Creates implicit coupling between finalization and context management
- Makes error handling complicated (context in intermediate state)

## Proposed Solution

Separate the lifecycle into distinct phases with clear boundaries:

```
acquire() → [rebase runs] → prepare_release() → [finalization] → release()
```

### Phase Model

```typescript
interface ExecutionContext {
  // Current phase
  phase: 'acquired' | 'preparing_release' | 'released'

  // Explicit phase transitions
  prepareForRelease(): Promise<void> // Detach HEAD, cleanup
  release(): Promise<void> // Remove worktree
}

async function executeWithContext<T>(
  repoPath: string,
  operation: (ctx: ExecutionContext) => Promise<T>,
  finalization?: (ctx: ExecutionContext) => Promise<void>
): Promise<T> {
  const context = await ExecutionContextService.acquire(repoPath)

  try {
    const result = await operation(context)

    // Explicit preparation phase
    await context.prepareForRelease()

    // Finalization runs after preparation, before release
    if (finalization) {
      await finalization(context)
    }

    return result
  } finally {
    await context.release()
  }
}
```

### Benefits

1. **Clear phase transitions**: No implicit state changes
2. **Finalization has clean context**: Branches freed before finalization runs
3. **Easier error handling**: Each phase can be handled separately
4. **Self-documenting**: Phase names explain what's happening

---

## Architecture Design Decision

### ADR-001: Explicit Phase Model

**Decision:** Add explicit phases to `ExecutionContext`: `acquired`, `preparing_release`, `released`.

**Rationale:**

- Makes lifecycle visible and debuggable
- Phase transitions are explicit method calls
- Guards can prevent operations in wrong phase
- Logging shows clear state progression

**Alternatives Considered:**

1. **Keep implicit state**: Rejected - source of current bug
2. **Separate finalization service**: Rejected - over-engineering
3. **Always detach on acquire**: Rejected - breaks normal operation flow

### ADR-002: Preparation Phase Responsibility

**Decision:** The `prepareForRelease()` method is responsible for:

1. Detaching HEAD (freeing any branch refs)
2. Cleaning up any temporary state
3. Ensuring worktree is safe to delete

**Rationale:**

- Single responsibility for "make context releasable"
- Callers don't need to know internal details
- Can evolve preparation logic independently

### ADR-003: Separate Finalization Callback

**Decision:** `executeWithContext` accepts optional `finalization` callback that runs between preparation and release.

**Rationale:**

- Finalization has guaranteed clean state (branches freed)
- Clear separation of operation from cleanup
- Finalization failures don't prevent release

---

## First Implementation Steps

### Step 1: Add Phase Tracking to ExecutionContext (1 hour)

```typescript
// src/node/services/ExecutionContextService.ts

type ContextPhase = 'acquired' | 'preparing_release' | 'released'

export class ExecutionContext {
  private _phase: ContextPhase = 'acquired'

  get phase(): ContextPhase {
    return this._phase
  }

  private assertPhase(expected: ContextPhase, operation: string): void {
    if (this._phase !== expected) {
      throw new Error(
        `Cannot ${operation}: context is in '${this._phase}' phase, expected '${expected}'`
      )
    }
  }

  async prepareForRelease(): Promise<void> {
    this.assertPhase('acquired', 'prepareForRelease')

    log.debug('[ExecutionContext] Preparing for release', {
      path: this.executionPath
    })

    // Detach HEAD to free any branch references
    await this.detachHead()

    // Clean up any temporary files
    await this.cleanupTemporaryState()

    this._phase = 'preparing_release'

    log.debug('[ExecutionContext] Ready for release', {
      path: this.executionPath
    })
  }

  async release(): Promise<void> {
    if (this._phase === 'released') {
      log.warn('[ExecutionContext] Already released')
      return
    }

    // Can release from either acquired or preparing_release
    // (in case of error, we might skip preparation)

    log.debug('[ExecutionContext] Releasing', {
      path: this.executionPath,
      previousPhase: this._phase
    })

    try {
      await this.removeWorktree()
      await this.clearPersistedState()
    } finally {
      this._phase = 'released'
    }
  }

  private async detachHead(): Promise<void> {
    try {
      await git.checkout(this.executionPath, ['--detach'])
    } catch (error) {
      // Already detached or other issue - log but don't fail
      log.debug('[ExecutionContext] Could not detach HEAD', { error })
    }
  }

  private async cleanupTemporaryState(): Promise<void> {
    // Remove any teapot-specific temp files
    // e.g., .git/teapot-exec-state.json
  }
}
```

### Step 2: Update executeWithContext (1 hour)

```typescript
// src/node/services/ExecutionContextService.ts

interface ExecuteOptions<T> {
  operation: (ctx: ExecutionContext) => Promise<T>
  finalization?: (ctx: ExecutionContext) => Promise<void>
  onError?: (ctx: ExecutionContext, error: unknown) => Promise<void>
}

export async function executeWithContext<T>(
  repoPath: string,
  options: ExecuteOptions<T>
): Promise<T> {
  const context = await ExecutionContextService.acquire(repoPath)

  try {
    // Main operation
    const result = await options.operation(context)

    // Prepare for release (detach HEAD, cleanup)
    await context.prepareForRelease()

    // Finalization (e.g., re-checkout branches in other worktrees)
    if (options.finalization) {
      try {
        await options.finalization(context)
      } catch (error) {
        log.warn('[ExecutionContext] Finalization failed', { error })
        // Don't throw - release should still happen
      }
    }

    return result
  } catch (error) {
    // Error handler
    if (options.onError) {
      try {
        await options.onError(context, error)
      } catch (handlerError) {
        log.warn('[ExecutionContext] Error handler failed', { handlerError })
      }
    }
    throw error
  } finally {
    await context.release()
  }
}
```

### Step 3: Update RebaseExecutor (2 hours)

```typescript
// src/node/rebase/RebaseExecutor.ts

export async function executeRebase(repoPath: string, queue: RebaseQueue): Promise<RebaseResult> {
  return executeWithContext(repoPath, {
    operation: async (context) => {
      // Run the actual rebase
      return await runRebaseQueue(context, queue)
    },

    finalization: async (context) => {
      // Context is now in 'preparing_release' phase
      // HEAD is detached, so we can safely re-checkout branches

      // Note: With idea #16 (Block Worktree Conflicts), this
      // finalization may become unnecessary
      await reattachWorktrees(context)
    },

    onError: async (context, error) => {
      // Handle rebase errors (conflicts, etc.)
      await handleRebaseError(context, error)
    }
  })
}

async function reattachWorktrees(context: ExecutionContext): Promise<void> {
  const session = await getSession(context.repoPath)
  if (!session?.autoDetachedWorktrees) return

  for (const { worktreePath, branch } of session.autoDetachedWorktrees) {
    try {
      // Safe to checkout now - temp worktree HEAD is detached
      await git.checkout(worktreePath, branch)
    } catch (error) {
      log.warn(`Failed to reattach ${branch} in ${worktreePath}`, { error })
    }
  }
}
```

### Step 4: Add Phase Guards to Operations (1 hour)

```typescript
// src/node/services/ExecutionContextService.ts

export class ExecutionContext {
  // ... existing code ...

  /**
   * Execute a git operation. Only allowed in 'acquired' phase.
   */
  async gitOperation<T>(fn: () => Promise<T>): Promise<T> {
    this.assertPhase('acquired', 'execute git operation')
    return fn()
  }

  /**
   * Read state. Allowed in any phase except 'released'.
   */
  async readState<T>(fn: () => Promise<T>): Promise<T> {
    if (this._phase === 'released') {
      throw new Error('Cannot read state: context is released')
    }
    return fn()
  }
}

// Usage in RebaseExecutor
async function runRebaseQueue(
  context: ExecutionContext,
  queue: RebaseQueue
): Promise<RebaseResult> {
  for (const job of queue.jobs) {
    // This will throw if called after prepareForRelease
    await context.gitOperation(() => git.rebase(context.executionPath, job.onto))
  }
}
```

### Step 5: Add Phase Transition Logging (30 min)

```typescript
// Add structured logging for debugging

async prepareForRelease(): Promise<void> {
  log.info('[ExecutionContext] Phase transition', {
    from: this._phase,
    to: 'preparing_release',
    path: this.executionPath,
    timestamp: Date.now()
  })

  // ... existing code ...
}

async release(): Promise<void> {
  log.info('[ExecutionContext] Phase transition', {
    from: this._phase,
    to: 'released',
    path: this.executionPath,
    timestamp: Date.now()
  })

  // ... existing code ...
}
```

### Step 6: Add Tests (2 hours)

```typescript
describe('ExecutionContext lifecycle', () => {
  it('transitions through phases correctly', async () => {
    const context = await ExecutionContextService.acquire(repoPath)

    expect(context.phase).toBe('acquired')

    await context.prepareForRelease()
    expect(context.phase).toBe('preparing_release')

    await context.release()
    expect(context.phase).toBe('released')
  })

  it('prevents git operations after prepareForRelease', async () => {
    const context = await ExecutionContextService.acquire(repoPath)
    await context.prepareForRelease()

    await expect(context.gitOperation(() => git.status(context.executionPath))).rejects.toThrow(
      /context is in 'preparing_release' phase/
    )
  })

  it('allows release from any non-released phase', async () => {
    const context = await ExecutionContextService.acquire(repoPath)

    // Skip prepareForRelease (error scenario)
    await expect(context.release()).resolves.not.toThrow()
    expect(context.phase).toBe('released')
  })

  it('finalization runs after prepareForRelease', async () => {
    const phases: string[] = []

    await executeWithContext(repoPath, {
      operation: async (ctx) => {
        phases.push(`operation: ${ctx.phase}`)
      },
      finalization: async (ctx) => {
        phases.push(`finalization: ${ctx.phase}`)
      }
    })

    expect(phases).toEqual(['operation: acquired', 'finalization: preparing_release'])
  })
})
```

---

## State Diagram

```
                    ┌─────────────────┐
                    │    acquired     │
                    │                 │
                    │  (git ops OK)   │
                    └────────┬────────┘
                             │
                             │ prepareForRelease()
                             │ - detach HEAD
                             │ - cleanup temp state
                             ▼
                    ┌─────────────────┐
                    │preparing_release│
                    │                 │
                    │ (read-only)     │
                    │ (finalization)  │
                    └────────┬────────┘
                             │
                             │ release()
                             │ - remove worktree
                             │ - clear persisted state
                             ▼
                    ┌─────────────────┐
                    │    released     │
                    │                 │
                    │  (no ops)       │
                    └─────────────────┘
```

---

## Risks and Mitigations

| Risk                           | Mitigation                                         |
| ------------------------------ | -------------------------------------------------- |
| Breaking existing code         | Gradual migration; support both patterns initially |
| Forgotten prepareForRelease    | executeWithContext handles automatically           |
| Error during prepareForRelease | release() works from any phase                     |
| Phase assertion overhead       | Assertions are cheap; add only where needed        |
