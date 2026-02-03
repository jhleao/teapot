# Idea: Git Error-First Pattern ("Let Git Decide")

**Source:** `2339-worktree-branch-deletion.md` (post-mortem)
**Status:** Proposed
**Priority:** High (reliability, maintainability)
**Effort:** Medium (1 week)

## Problem

When git has authoritative knowledge about repository state (locks, conflicts, worktree associations), we sometimes try to detect conditions ourselves before attempting operations. This approach is fragile:

1. **Tight coupling to git internals**: Probing files like `.git/rebase-merge/head-name` creates dependencies on git's internal structure
2. **Incomplete coverage**: Pre-flight checks often miss edge cases (mid-rebase, cherry-pick, bisect, merge)
3. **Duplicated logic**: We replicate knowledge that git already has
4. **Maintenance burden**: Git internals can change between versions

### Example: Branch Deletion Bug (#2339)

When a worktree is mid-rebase, git enters a detached HEAD state but the branch remains locked. Our `listWorktrees()` parsed `git worktree list --porcelain` output, which shows `detached` instead of `branch refs/heads/...` during rebase. This caused worktree-branch association logic to return `branch: null`, making us unable to detect that the branch was still in use.

The initial fix probed `.git/rebase-merge/head-name` to detect which branch was being rebased. This worked but was fragile.

## Proposed Solution

**Try first, parse error**: Instead of trying to predict git's behavior, attempt the operation and handle git's error response.

```typescript
// Before (fragile pre-flight check)
async function deleteBranch(repoPath: string, branch: string): Promise<void> {
  const worktrees = await listWorktrees(repoPath)
  const conflict = worktrees.find((w) => w.branch === branch)
  if (conflict) {
    throw new Error(`Branch ${branch} is checked out in ${conflict.path}`)
  }
  await git.branch(['-D', branch])
}

// After (error-first pattern)
async function deleteBranch(repoPath: string, branch: string): Promise<void> {
  try {
    await git.branch(['-D', branch])
  } catch (error) {
    const worktreePath = parseWorktreeConflictFromError(error)
    if (worktreePath) {
      throw new WorktreeConflictError(branch, worktreePath, error)
    }
    throw error
  }
}
```

### Benefits

1. **Works for all cases**: Handles rebase, cherry-pick, bisect, merge, and future operations
2. **No git internals knowledge**: Only parses git's public error messages
3. **Simpler code**: Single code path instead of pre-flight + fallback
4. **Better performance**: Common case (no conflict) requires only 1 git call instead of 2

### When to Use This Pattern

Use error-first when:

- Git has authoritative knowledge about the condition you're checking
- The error message contains actionable information
- The operation is idempotent or its failure is acceptable

Don't use when:

- You need to show a preview before attempting (user confirmation flow)
- The operation has side effects that are hard to undo
- Git's error message doesn't provide enough context

---

## Architecture Design Decision

### ADR-001: Error-First Over Pre-Flight Checks

**Decision:** For operations where git has authoritative state knowledge, attempt the operation first and handle errors, rather than pre-checking conditions.

**Rationale:**

- Git's error messages are the definitive source of truth
- Pre-flight checks create maintenance burden and miss edge cases
- Simpler code with fewer branches
- Better performance for the common case (no error)

**Alternatives Considered:**

1. **Pre-flight checks only**: Rejected - incomplete coverage, missed the mid-rebase case
2. **Hybrid (pre-flight + fallback)**: Rejected - adds complexity without benefit
3. **Probe git internals**: Rejected - tight coupling to implementation details

### ADR-002: Error Parsing in Adapter Layer

**Decision:** Parse git errors and throw typed exceptions in the adapter layer (`SimpleGitAdapter`), not in operation code.

**Rationale:**

- Centralizes error parsing logic
- Operation code uses `instanceof` checks, not string parsing
- Single place to update when git error formats change
- Easier to test error handling

### ADR-003: Preserve Original Error

**Decision:** Typed error classes should include the original error as a `cause` property.

**Rationale:**

- Enables debugging with full stack trace
- Original error message may contain useful details
- Follows JavaScript Error cause convention (ES2022)

---

## First Implementation Steps

### Step 1: Identify Operations Using Pre-Flight Checks (1 hour)

Audit codebase for patterns like:

```typescript
// Look for these patterns:
const worktrees = await listWorktrees(...)
// ... logic to detect conflicts ...
// ... then perform operation ...
```

Candidates:

- `BranchOperation.deleteBranch()`
- `BranchOperation.rename()`
- `WorktreeOperation.checkout()`
- `WorktreeOperation.remove()`

### Step 2: Create Error Parsing Utilities (1 hour)

```typescript
// src/node/adapters/git/errorParsing.ts

interface ParsedWorktreeConflict {
  branch: string
  worktreePath: string
}

/**
 * Parses git error messages for worktree conflicts.
 * Example: "cannot delete branch 'X' used by worktree at 'Y'"
 */
export function parseWorktreeConflictFromError(error: unknown): ParsedWorktreeConflict | null {
  const message = extractErrorMessage(error)

  // Pattern: "cannot delete branch 'X' used by worktree at 'Y'"
  const deleteMatch = message.match(/cannot delete branch '([^']+)' used by worktree at '([^']+)'/)
  if (deleteMatch) {
    return { branch: deleteMatch[1], worktreePath: deleteMatch[2] }
  }

  // Pattern: "'X' is already used by worktree at 'Y'"
  const checkoutMatch = message.match(/'([^']+)' is already used by worktree at '([^']+)'/)
  if (checkoutMatch) {
    return { branch: checkoutMatch[1], worktreePath: checkoutMatch[2] }
  }

  return null
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
```

### Step 3: Update Adapter with Error Parsing (2 hours)

```typescript
// src/node/adapters/git/SimpleGitAdapter.ts

async deleteBranch(dir: string, ref: string): Promise<void> {
  try {
    await this.git(dir).branch(['-D', ref])
  } catch (error) {
    const conflict = parseWorktreeConflictFromError(error)
    if (conflict) {
      throw new WorktreeConflictError(
        conflict.branch,
        conflict.worktreePath,
        error
      )
    }
    throw this.wrapError('deleteBranch', error)
  }
}
```

### Step 4: Simplify Operation Code (1 hour)

```typescript
// src/node/operations/BranchOperation.ts

// Before: complex pre-flight check + fallback
static async delete(repoPath: string, branch: string): Promise<void> {
  const worktrees = await listWorktrees(repoPath)
  const conflict = worktrees.find(w => w.branch === branch)
  if (conflict) {
    if (await isWorktreeDirty(conflict.path)) {
      throw new Error('Cannot delete: worktree has uncommitted changes')
    }
    await WorktreeOperation.remove(repoPath, conflict.path)
  }
  await git.deleteBranch(repoPath, branch)
}

// After: clean error handling
static async delete(repoPath: string, branch: string): Promise<void> {
  try {
    await git.deleteBranch(repoPath, branch)
  } catch (error) {
    if (error instanceof WorktreeConflictError) {
      if (await isWorktreeDirty(error.worktreePath)) {
        throw new DirtyWorktreeError(error.worktreePath)
      }
      await WorktreeOperation.remove(repoPath, error.worktreePath, true)
      await git.deleteBranch(repoPath, branch) // Retry
      return
    }
    throw error
  }
}
```

### Step 5: Add Tests for Error Paths (2 hours)

```typescript
// src/node/__tests__/adapters/SimpleGitAdapter.test.ts

describe('deleteBranch', () => {
  it('throws WorktreeConflictError when branch is checked out', async () => {
    // Setup: create worktree with branch checked out
    await git.worktree(['add', worktreePath, branchName])

    await expect(adapter.deleteBranch(repoPath, branchName)).rejects.toBeInstanceOf(
      WorktreeConflictError
    )
  })

  it('includes worktree path in error', async () => {
    await git.worktree(['add', worktreePath, branchName])

    try {
      await adapter.deleteBranch(repoPath, branchName)
      fail('Expected error')
    } catch (error) {
      expect(error).toBeInstanceOf(WorktreeConflictError)
      expect((error as WorktreeConflictError).worktreePath).toBe(worktreePath)
    }
  })

  it('throws WorktreeConflictError when branch is mid-rebase', async () => {
    // Setup: start rebase that will conflict
    await git.worktree(['add', worktreePath, branchName])
    await startConflictingRebase(worktreePath)

    await expect(adapter.deleteBranch(repoPath, branchName)).rejects.toBeInstanceOf(
      WorktreeConflictError
    )
  })
})
```

---

## Documentation Pattern

Add to coding guidelines:

> **Git Error-First Pattern**
>
> When git has authoritative knowledge about repository state (locks, conflicts,
> worktree associations), don't try to detect conditions ourselves. Attempt the
> operation and handle git's error response. This is more reliable and
> maintainable than probing git's internals.
>
> ```typescript
> // Preferred: Let git tell us
> try {
>   await git.operation()
> } catch (error) {
>   if (error instanceof SpecificGitError) {
>     // Handle it
>   }
>   throw error
> }
>
> // Avoid: Pre-flight detection
> if (await detectCondition()) {
>   throw new Error('...')
> }
> await git.operation()
> ```

---

## Risks and Mitigations

| Risk                             | Mitigation                                                  |
| -------------------------------- | ----------------------------------------------------------- |
| Git error message format changes | Centralized parsing; tests catch regressions                |
| Error parsing regex too strict   | Use permissive patterns, log unparsed errors                |
| Performance of retry after error | Only retry when error is recoverable                        |
| Missing error patterns           | Log unparsed errors for discovery, add patterns iteratively |
