# Idea: Simplified pruneStaleWorktrees API

**Source:** `docs/proposals/worktree-improvements.md`
**Status:** Proposed
**Priority:** Low (maintainability)
**Effort:** Small (1-2 hours)

## Problem

Current `pruneStaleWorktrees` returns `{ pruned: boolean; error?: string }`, but:

1. **Most callers ignore it**: Fire-and-forget pattern
2. **Inconsistent error handling**: Some expect exceptions, others expect result objects
3. **The `error` field is rarely useful**: When prune fails, we typically log and continue
4. **Makes composition harder**: Can't easily chain with other async operations

### Current Usage Analysis

| Location | Uses `pruned`? | Uses `error`? | Pattern |
|----------|---------------|---------------|---------|
| `watchRepo` | No | No | Fire-and-forget |
| `WorktreeOperation.remove` | No | No | Always returns success |
| `BranchOperation.removeWorktreeForBranch` | No | No | Via `pruneIfStale` |
| `retryWithPrune` | Yes | No | Only checks success |
| `pruneIfStale` | Yes | No | Propagates status |

## Proposed Solution

**Throw on error** (standard async pattern):

```typescript
/**
 * Prunes stale worktree references from git's registry.
 * @throws WorktreePruneError if pruning fails
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

## Benefits

- Standard JavaScript async/await pattern
- Callers can choose to catch or not
- Composable with other operations
- Existing `.catch()` handlers continue to work
- Makes "swallowing errors" choice explicit at call sites

## Migration

1. Update `pruneStaleWorktrees` to throw
2. Update `retryWithPrune` to catch and handle
3. Update `pruneIfStale` to catch and return status
4. No changes needed for fire-and-forget callers (already use `.catch()`)

## Alternative: Keep Current API

Accept slight inconsistency for backwards compatibility. This is acceptable if migration effort outweighs benefits.

---

## Architecture Design Decision

### ADR-001: Throw on Error Pattern

**Decision:** Change `pruneStaleWorktrees` to return `Promise<void>` and throw on error.

**Rationale:**
- Standard JavaScript async/await convention
- Composable with other async operations
- Existing `.catch()` handlers continue to work
- Makes error handling choice explicit at call site

**Alternatives Considered:**
1. **Keep result object**: Rejected - inconsistent with rest of codebase
2. **Return boolean only**: Rejected - loses error details
3. **Result type with discriminated union**: Rejected - over-engineering for simple operation

### ADR-002: Custom Error Type

**Decision:** Create `WorktreePruneError` for prune-specific errors.

**Rationale:**
- Can distinguish prune errors from other errors
- Enables specific error handling if needed
- Follows existing error patterns in codebase (e.g., `TimeoutError`)

---

## First Implementation Steps

### Step 1: Create Error Type (15 min)

```typescript
// src/node/errors/WorktreePruneError.ts
export class WorktreePruneError extends Error {
  readonly name = 'WorktreePruneError'

  constructor(message: string) {
    super(message)
  }
}
```

### Step 2: Update pruneStaleWorktrees (30 min)

```typescript
// src/node/utils/WorktreeUtils.ts

// Before:
export async function pruneStaleWorktrees(
  repoPath: string
): Promise<{ pruned: boolean; error?: string }> {
  const git = getGitAdapter()
  try {
    await git.pruneWorktrees(repoPath)
    return { pruned: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`[WorktreeUtils] Failed to prune:`, { error: message })
    return { pruned: false, error: message }
  }
}

// After:
/**
 * Prunes stale worktree references from git's registry.
 * @throws WorktreePruneError if pruning fails
 */
export async function pruneStaleWorktrees(repoPath: string): Promise<void> {
  const git = getGitAdapter()
  try {
    await git.pruneWorktrees(repoPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`[WorktreeUtils] Failed to prune:`, { error: message })
    throw new WorktreePruneError(message)
  }
}
```

### Step 3: Update retryWithPrune (30 min)

```typescript
// src/node/utils/WorktreeUtils.ts

// Before:
async function retryWithPrune<T>(
  fn: () => Promise<T>,
  repoPath: string
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const result = await pruneStaleWorktrees(repoPath)
    if (result.pruned) {
      return await fn() // Retry after prune
    }
    throw error
  }
}

// After:
async function retryWithPrune<T>(
  fn: () => Promise<T>,
  repoPath: string
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    try {
      await pruneStaleWorktrees(repoPath)
      return await fn() // Retry after prune
    } catch (pruneError) {
      // Prune failed, throw original error
      throw error
    }
  }
}
```

### Step 4: Update pruneIfStale (15 min)

```typescript
// src/node/utils/WorktreeUtils.ts

// Before:
export async function pruneIfStale(repoPath: string): Promise<boolean> {
  const result = await pruneStaleWorktrees(repoPath)
  return result.pruned
}

// After:
export async function pruneIfStale(repoPath: string): Promise<boolean> {
  try {
    await pruneStaleWorktrees(repoPath)
    return true
  } catch {
    return false
  }
}
```

### Step 5: Verify Fire-and-Forget Callers (15 min)

Existing callers using `.catch()` continue to work:

```typescript
// These are unchanged:
pruneStaleWorktrees(repoPath).catch(err => {
  log.warn('Failed to prune', err)
})
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking callers that check `pruned` | Update `retryWithPrune` and `pruneIfStale` |
| Silent behavior change | Existing `.catch()` handlers still work |
| Missed caller | Search codebase for all usages before merge |
