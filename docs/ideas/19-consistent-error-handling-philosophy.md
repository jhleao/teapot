# Idea: Consistent Error Handling Philosophy

**Source:** `architecture-issues-rebase-worktree-lifecycle.md` (Issue 4: Error Handling Philosophy Mismatch)
**Status:** Proposed
**Priority:** Medium (architecture, predictability)
**Effort:** Medium (1-2 weeks)

## Problem

The codebase mixes two different error handling philosophies:

### Philosophy A: Fail-Fast with User Intervention

Some operations throw errors that bubble up and require user action:

```typescript
// Example: Dirty worktree blocks rebase entirely
async function validateWorktreeClean(worktreePath: string): Promise<void> {
  if (await isWorktreeDirty(worktreePath)) {
    throw new DirtyWorktreeError(worktreePath)  // Blocks operation
  }
}
```

### Philosophy B: Best-Effort with Silent Degradation

Other operations catch errors and continue:

```typescript
// Example: Re-checkout failure is logged but operation "succeeds"
async function finalizeRebase(): Promise<void> {
  for (const { worktreePath, branch } of autoDetachedWorktrees) {
    try {
      await git.checkout(worktreePath, branch)
    } catch (error) {
      log.warn(`Failed to re-checkout ${branch}`)  // Continue anyway
    }
  }
  // Rebase considered "successful" even if re-checkout failed
}
```

### Inconsistency Creates Confusion

| Operation | Philosophy | Behavior |
|-----------|------------|----------|
| Detaching dirty worktree | Fail-fast | Blocks rebase entirely |
| Re-attaching worktree | Best-effort | Warning, continues |
| Temp worktree cleanup | Silent | Logged, ignored |
| Prune stale worktrees | Best-effort | Returns result, doesn't throw |

This inconsistency makes behavior unpredictable:
- Users don't know which errors are blocking vs. warnings
- Developers don't know which philosophy to use for new code
- Testing becomes harder (what's the expected behavior?)

### Root Cause

The re-checkout operation is in an awkward middle ground: it's important enough to attempt and warn about, but not important enough to fail the operation. This suggests the feature may be mis-scoped—either it's critical (and should fail properly) or it's optional (and should be explicitly opt-in).

## Proposed Solution

Establish clear guidelines for when to use each philosophy, and ensure consistency within each category.

### Category 1: Pre-Conditions (Fail-Fast)

Pre-conditions that would make the operation invalid or dangerous must fail:

```typescript
// Always throw for pre-condition failures
async function validateRebasePreConditions(): Promise<void> {
  if (await isWorktreeDirty(targetPath)) {
    throw new DirtyWorktreeError(targetPath)  // MUST fail
  }
  if (await hasWorktreeConflicts(branches)) {
    throw new WorktreeConflictError(conflicts)  // MUST fail
  }
}
```

### Category 2: Core Operation (Fail-Fast)

The main operation must succeed for the overall operation to succeed:

```typescript
// Throw if core operation fails
async function executeRebase(): Promise<void> {
  const result = await git.rebase(onto)
  if (result.status === 'conflict') {
    throw new RebaseConflictError(result.conflicts)  // MUST fail
  }
}
```

### Category 3: Cleanup (Best-Effort with Logging)

Cleanup operations should not fail the overall operation, but must be logged:

```typescript
// Cleanup errors are logged but don't fail operation
async function cleanupAfterRebase(): Promise<void> {
  try {
    await removeTempWorktree()
  } catch (error) {
    log.warn('[Cleanup] Failed to remove temp worktree', { error })
    // Continue - don't throw
  }
}
```

### Category 4: Enhancement (Opt-In, Documented)

Optional enhancements that can fail without affecting core functionality:

```typescript
// Optional enhancements are clearly marked and handle their own errors
async function finalizeRebase(options: FinalizeOptions): Promise<void> {
  // Core: always happens
  await updateSessionState()

  // Enhancement: opt-in, failures don't affect operation
  if (options.reattachWorktrees) {
    for (const wt of detachedWorktrees) {
      try {
        await git.checkout(wt.path, wt.branch)
      } catch (error) {
        log.info(`[Enhancement] Could not reattach ${wt.branch}`, { error })
      }
    }
  }
}
```

---

## Architecture Design Decision

### ADR-001: Categorize All Operations

**Decision:** Every operation must be categorized as:
- **Pre-condition**: Fail-fast, throws
- **Core**: Fail-fast, throws
- **Cleanup**: Best-effort, logs
- **Enhancement**: Opt-in, handles own errors

**Rationale:**
- Clear expectations for each operation type
- Developers know which pattern to use
- Users can predict behavior

### ADR-002: Document Error Behavior

**Decision:** Public functions should document their error behavior:

```typescript
/**
 * Deletes a branch from the repository.
 *
 * @throws WorktreeConflictError if branch is checked out in a worktree
 * @throws BranchNotFoundError if branch doesn't exist (non-blocking - returns successfully)
 */
async function deleteBranch(ref: string): Promise<void>
```

**Rationale:**
- Self-documenting code
- Callers know what to catch
- IDE tooltips show error info

### ADR-003: No Silent Swallowing

**Decision:** Errors should never be silently swallowed. At minimum:
- Cleanup errors: `log.warn()`
- Enhancement errors: `log.info()`

**Rationale:**
- Enables debugging
- Creates audit trail
- Reveals systemic issues

### ADR-004: Fail-Safe Default

**Decision:** When in doubt, fail-fast. It's easier to relax error handling than to add it later.

**Rationale:**
- Bugs surface early
- Users report issues promptly
- Prevents data corruption

---

## First Implementation Steps

### Step 1: Audit Existing Error Handling (2 hours)

Create inventory of all error handling patterns:

```typescript
// Example audit table
const errorHandlingAudit = [
  {
    location: 'RebaseValidator.validateWorktreeClean',
    behavior: 'throws DirtyWorktreeError',
    category: 'pre-condition',
    consistent: true
  },
  {
    location: 'finalizeRebase (re-checkout)',
    behavior: 'logs warning, continues',
    category: 'enhancement',
    consistent: false,  // Should be opt-in or removed
    recommendation: 'Remove with idea #16'
  },
  {
    location: 'ExecutionContext.release',
    behavior: 'logs, ignores',
    category: 'cleanup',
    consistent: true
  },
  // ...
]
```

### Step 2: Define Category Guidelines (1 hour)

```typescript
// src/docs/ERROR_HANDLING.md

/**
 * # Error Handling Guidelines
 *
 * ## Pre-Conditions
 *
 * Pre-conditions validate that an operation can safely proceed.
 * Always throw on pre-condition failure.
 *
 * ```typescript
 * // CORRECT
 * if (await isWorktreeDirty(path)) {
 *   throw new DirtyWorktreeError(path)
 * }
 *
 * // WRONG - pre-condition failures should throw
 * if (await isWorktreeDirty(path)) {
 *   log.warn('Worktree is dirty')
 *   return { success: false }
 * }
 * ```
 *
 * ## Core Operations
 *
 * Core operations are the main purpose of the function.
 * Always throw on core operation failure.
 *
 * ## Cleanup
 *
 * Cleanup operations run after the core operation.
 * Log errors but don't throw.
 *
 * ```typescript
 * // CORRECT
 * try {
 *   await removeTempFiles()
 * } catch (error) {
 *   log.warn('[Cleanup] Failed', { error })
 * }
 * ```
 *
 * ## Enhancements
 *
 * Optional features that don't affect core functionality.
 * Make opt-in via explicit options, handle own errors.
 */
```

### Step 3: Create Helper Functions (1 hour)

```typescript
// src/node/utils/errorHandling.ts

/**
 * Wraps a cleanup function to log errors but not throw.
 */
export async function runCleanup(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn()
    log.debug(`[Cleanup] ${name} completed`)
  } catch (error) {
    log.warn(`[Cleanup] ${name} failed`, { error: extractMessage(error) })
  }
}

/**
 * Wraps an optional enhancement that may fail.
 */
export async function runEnhancement<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    log.info(`[Enhancement] ${name} skipped`, { error: extractMessage(error) })
    return fallback
  }
}

// Usage
async function finalizeRebase(): Promise<void> {
  // Core operation - throws on failure
  await updateSession()

  // Cleanup - logs but doesn't throw
  await runCleanup('remove temp worktree', () =>
    removeTempWorktree()
  )

  // Enhancement - returns fallback on failure
  const reattached = await runEnhancement(
    'reattach worktrees',
    () => reattachWorktrees(),
    false
  )
}
```

### Step 4: Standardize Return Types (2 hours)

For operations that can partially succeed, use explicit result types:

```typescript
// src/node/types/results.ts

interface OperationResult<T> {
  success: boolean
  data?: T
  warnings: OperationWarning[]
  errors: OperationError[]
}

interface OperationWarning {
  code: string
  message: string
  context?: Record<string, unknown>
}

// Usage
async function deleteMultipleBranches(
  branches: string[]
): Promise<OperationResult<string[]>> {
  const deleted: string[] = []
  const warnings: OperationWarning[] = []

  for (const branch of branches) {
    try {
      await git.deleteBranch(branch)
      deleted.push(branch)
    } catch (error) {
      if (error instanceof BranchNotFoundError) {
        warnings.push({
          code: 'BRANCH_NOT_FOUND',
          message: `Branch '${branch}' was already deleted`,
          context: { branch }
        })
        // Continue with other branches
      } else {
        throw error  // Unexpected error - fail fast
      }
    }
  }

  return {
    success: true,
    data: deleted,
    warnings,
    errors: []
  }
}
```

### Step 5: Fix Inconsistent Patterns (3 hours)

Update code to match guidelines:

```typescript
// Before: Silent degradation for what should be opt-in enhancement
async function finalizeRebase(): Promise<void> {
  for (const wt of autoDetachedWorktrees) {
    try {
      await git.checkout(wt.path, wt.branch)
    } catch {
      log.warn('Re-checkout failed')  // What does user do with this?
    }
  }
}

// After: Either remove the feature (idea #16) or make it explicit
async function finalizeRebase(options?: FinalizeOptions): Promise<FinalizeResult> {
  const result: FinalizeResult = {
    success: true,
    reattachedWorktrees: []
  }

  // With idea #16, this code goes away entirely
  // If kept, make it opt-in and return clear result
  if (options?.reattachWorktrees) {
    for (const wt of autoDetachedWorktrees) {
      const reattached = await runEnhancement(
        `reattach ${wt.branch}`,
        () => git.checkout(wt.path, wt.branch),
        false
      )
      if (reattached) {
        result.reattachedWorktrees.push(wt.branch)
      }
    }
  }

  return result
}
```

### Step 6: Add Tests for Error Behavior (2 hours)

```typescript
describe('Error Handling Consistency', () => {
  describe('Pre-conditions', () => {
    it('throws on dirty worktree', async () => {
      await createDirtyWorktree(worktreePath)

      await expect(validatePreConditions())
        .rejects.toBeInstanceOf(DirtyWorktreeError)
    })
  })

  describe('Cleanup', () => {
    it('logs but does not throw on cleanup failure', async () => {
      const logSpy = vi.spyOn(log, 'warn')

      // Make cleanup fail
      mockCleanupFailure()

      // Operation should still succeed
      await expect(executeOperation()).resolves.not.toThrow()

      // But failure was logged
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Cleanup]'),
        expect.anything()
      )
    })
  })

  describe('Enhancements', () => {
    it('does not throw on enhancement failure', async () => {
      // Enhancement fails
      mockEnhancementFailure()

      // Operation succeeds with result indicating enhancement skipped
      const result = await executeOperation({ enableEnhancement: true })

      expect(result.success).toBe(true)
      expect(result.enhancementApplied).toBe(false)
    })
  })
})
```

---

## Decision Matrix

| Scenario | Category | Behavior | Example |
|----------|----------|----------|---------|
| Dirty worktree before rebase | Pre-condition | Throw | `DirtyWorktreeError` |
| Branch checked out elsewhere | Pre-condition | Throw | `WorktreeConflictError` |
| Rebase conflict | Core | Throw | `RebaseConflictError` |
| Git command timeout | Core | Throw | `TimeoutError` |
| Remove temp worktree fails | Cleanup | Log, continue | `log.warn()` |
| Prune stale worktrees fails | Cleanup | Log, continue | `log.warn()` |
| Re-attach worktree fails | Enhancement | Log, report in result | Opt-in feature |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing error handling | Audit first, migrate incrementally |
| Over-strict fail-fast | Start strict, relax based on user feedback |
| Verbose logging | Use appropriate log levels (warn vs info vs debug) |
| Result type complexity | Only use for batch operations; single ops just throw |
