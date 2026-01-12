# Idea: Execution Context Validation on Load

**Source:** `docs/post-mortems/2026-01-parallel-rebase-temp-worktree-conflicts.md`
**Status:** Proposed (from post-mortem lessons)
**Priority:** Medium

## Problem Context

During the parallel rebase debugging, the stored execution context persisted to disk. Restarting the app would pick up old corrupted state, making it seem like the same bug kept recurring even after fixes.

The stored context could reference:
- A temp worktree that no longer exists
- A worktree in an unexpected state (e.g., mid-conflict)
- An orphaned worktree without a valid session

## Proposed Solution

When loading a stored execution context, validate that the referenced worktree still exists and is in the expected state.

```typescript
// src/node/services/ExecutionContextService.ts

interface ContextValidationResult {
  valid: boolean
  reason?: 'worktree_missing' | 'worktree_corrupted' | 'state_mismatch'
  details?: string
}

async function validateStoredContext(
  context: PersistedContext
): Promise<ContextValidationResult> {
  // Check 1: Worktree directory exists
  if (!fs.existsSync(context.executionPath)) {
    return {
      valid: false,
      reason: 'worktree_missing',
      details: `Worktree path does not exist: ${context.executionPath}`
    }
  }

  // Check 2: Git directory is valid
  try {
    const worktree = await Worktree.fromPath(context.executionPath)
    if (!fs.existsSync(worktree.gitDir)) {
      return {
        valid: false,
        reason: 'worktree_corrupted',
        details: `Git directory missing: ${worktree.gitDir}`
      }
    }
  } catch (error) {
    return {
      valid: false,
      reason: 'worktree_corrupted',
      details: `Invalid worktree: ${error.message}`
    }
  }

  // Check 3: If temp worktree, verify it's in git worktree list
  if (context.isTemporary) {
    const worktrees = await git.listWorktrees(context.repoPath)
    const found = worktrees.find(w => w.path === context.executionPath)
    if (!found) {
      return {
        valid: false,
        reason: 'worktree_missing',
        details: 'Temp worktree not in git worktree list'
      }
    }
  }

  // Check 4: PID that created context should still be running
  // (optional - may be different process after restart)

  return { valid: true }
}
```

## Usage in Context Acquisition

```typescript
static async acquire(repoPath: string): Promise<ExecutionContext> {
  const stored = await this.getStoredContext(repoPath)

  if (stored) {
    const validation = await validateStoredContext(stored)

    if (!validation.valid) {
      log.warn(`[ExecutionContext] Stored context invalid: ${validation.reason}`, {
        details: validation.details
      })

      // Clean up invalid context
      await this.clearStoredContext(repoPath)

      // Clean up orphaned worktree if possible
      if (stored.isTemporary && stored.executionPath) {
        try {
          await WorktreeOperation.remove(repoPath, stored.executionPath, true)
        } catch (e) {
          log.warn('Failed to clean up orphaned worktree', e)
        }
      }

      // Fall through to create new context
    } else {
      return this.reuseStoredContext(stored)
    }
  }

  return this.createNewContext(repoPath)
}
```

## Benefits

1. **Self-healing**: App recovers from corrupted state on restart
2. **Clear logging**: Know why context was invalidated
3. **Orphan cleanup**: Automatically clean up abandoned worktrees
4. **Reliability**: Prevent cascading failures from stale state

---

## Architecture Design Decision

### ADR-001: Validate Before Use Pattern

**Decision:** Validate stored context on every `acquire()` call, not on app startup.

**Rationale:**
- Validation happens at point of use (fail-fast)
- No startup delay for validation
- Works regardless of when context was stored
- Aligns with "trust but verify" principle

**Alternatives Considered:**
1. **Validate on app startup**: Rejected - delays startup, may validate unused repos
2. **Background validation thread**: Rejected - adds complexity, race conditions
3. **Trust stored context**: Rejected - leads to cascading failures (post-mortem root cause)

### ADR-002: Structured Validation Result

**Decision:** Return structured `ContextValidationResult` with reason and details.

**Rationale:**
- Enables specific error handling per failure type
- Provides debug info without parsing error messages
- Can be logged and aggregated for telemetry

### ADR-003: Auto-Cleanup on Invalid Context

**Decision:** Automatically clean up invalid context and orphaned worktrees.

**Rationale:**
- Self-healing behavior reduces manual intervention
- Orphaned worktrees waste disk space
- User sees clean state after app restart

---

## First Implementation Steps

### Step 1: Define Validation Types (30 min)

```typescript
// src/node/services/ExecutionContextService.ts

type ValidationReason =
  | 'worktree_missing'      // Directory doesn't exist
  | 'worktree_corrupted'    // Invalid .git structure
  | 'not_in_worktree_list'  // Temp worktree not registered
  | 'stale_pid'             // Creating process no longer running

interface ContextValidationResult {
  valid: boolean
  reason?: ValidationReason
  details?: string
}
```

### Step 2: Implement Validation Function (1 hour)

```typescript
async function validateStoredContext(
  context: PersistedContext,
  git: GitAdapter
): Promise<ContextValidationResult> {
  // Check 1: Directory exists
  try {
    await fs.promises.access(context.executionPath)
  } catch {
    return {
      valid: false,
      reason: 'worktree_missing',
      details: `Path does not exist: ${context.executionPath}`
    }
  }

  // Check 2: Valid git worktree structure
  try {
    const worktree = await Worktree.fromPath(context.executionPath)
    await fs.promises.access(worktree.gitDir)
  } catch (error) {
    return {
      valid: false,
      reason: 'worktree_corrupted',
      details: `Invalid worktree: ${error.message}`
    }
  }

  // Check 3: Temp worktrees must be in git's list
  if (context.isTemporary) {
    const worktrees = await git.listWorktrees(context.repoPath)
    const found = worktrees.some(w =>
      path.normalize(w.path) === path.normalize(context.executionPath)
    )
    if (!found) {
      return {
        valid: false,
        reason: 'not_in_worktree_list',
        details: 'Temporary worktree not found in git worktree list'
      }
    }
  }

  return { valid: true }
}
```

### Step 3: Integrate into Acquire Flow (1 hour)

```typescript
static async acquire(repoPath: string): Promise<ExecutionContext> {
  const stored = await this.getStoredContext(repoPath)

  if (stored) {
    const validation = await validateStoredContext(stored, this.deps.git)

    if (!validation.valid) {
      log.warn('[ExecutionContext] Stored context invalid', {
        reason: validation.reason,
        details: validation.details,
        repoPath
      })

      // Clean up invalid state
      await this.clearStoredContext(repoPath)
      await this.tryCleanupOrphanedWorktree(stored)

      // Record in telemetry
      TelemetryService.record({
        type: 'context_validation_failed',
        reason: validation.reason,
        repoPath
      })

      // Fall through to create new context
    } else {
      return this.reuseStoredContext(stored)
    }
  }

  return this.createNewContext(repoPath)
}

private static async tryCleanupOrphanedWorktree(
  context: PersistedContext
): Promise<void> {
  if (!context.isTemporary) return

  try {
    await WorktreeOperation.remove(
      context.repoPath,
      context.executionPath,
      true // force
    )
    log.info('[ExecutionContext] Cleaned up orphaned worktree', {
      path: context.executionPath
    })
  } catch (error) {
    log.warn('[ExecutionContext] Failed to clean up orphaned worktree', {
      path: context.executionPath,
      error: error.message
    })
  }
}
```

### Step 4: Add Tests (1 hour)

```typescript
describe('Context Validation', () => {
  it('detects missing worktree', async () => {
    const context = createMockContext({ executionPath: '/does/not/exist' })
    const result = await validateStoredContext(context, mockGit)

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('worktree_missing')
  })

  it('detects temp worktree not in git list', async () => {
    const context = createMockContext({
      isTemporary: true,
      executionPath: '/repo/.worktrees/temp-123'
    })
    mockGit.listWorktrees.mockResolvedValue([]) // Empty list

    const result = await validateStoredContext(context, mockGit)

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('not_in_worktree_list')
  })

  it('accepts valid context', async () => {
    const context = createMockContext({ executionPath: validWorktreePath })
    const result = await validateStoredContext(context, mockGit)

    expect(result.valid).toBe(true)
  })
})
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Validation adds latency | Cache validation result for short duration |
| False positives (valid context rejected) | Comprehensive test coverage |
| Cleanup fails | Log warning, proceed with new context anyway |
