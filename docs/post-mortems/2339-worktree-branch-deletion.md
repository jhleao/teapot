# Post-Mortem: Worktree Branch Deletion Failure (#2339)

## Summary

Users could not delete branches that had worktrees in a mid-rebase state. The "Delete Branch" action failed while "Cleanup" succeeded, despite both operations needing to handle the same underlying issue.

## Root Cause

When a worktree is mid-rebase, git enters a **detached HEAD state** but the branch remains **locked** by git. Our `listWorktrees()` method parsed `git worktree list --porcelain` output, which shows `detached` instead of `branch refs/heads/...` during rebase. This caused our worktree-branch association logic to return `branch: null`, making us unable to detect that the branch was still in use.

Git's error message: `cannot delete branch 'X' used by worktree at 'Y'`

## The Mistake: Trying to Replicate Git's Knowledge

The initial fix attempted to probe git's internal files (`.git/rebase-merge/head-name`) to detect which branch was being rebased. This worked but was fragile:

1. **Tight coupling to git internals** - File paths and formats could change between git versions
2. **Incomplete coverage** - Would need similar probing for cherry-pick, bisect, merge, etc.
3. **Duplicated logic** - We were trying to replicate knowledge that git already has

## The Solution: Let Git Be the Source of Truth

Instead of trying to detect worktree associations ourselves, we:

1. **Try the deletion first** - Let git tell us if there's a problem
2. **Parse the error** - Extract the worktree path from git's error message
3. **Handle and retry** - Remove the blocking worktree and retry deletion

This approach:
- Works for ALL cases git considers a branch locked (rebase, cherry-pick, bisect, merge, future operations)
- Requires no knowledge of git internals
- Is simpler and more maintainable

## Architectural Insights

### 1. Error Parsing Belongs in the Adapter Layer

**Before:** Error parsing was scattered in the operation layer, requiring callers to understand git's error message formats.

**After:** The `SimpleGitAdapter.deleteBranch()` method parses errors and throws typed `WorktreeConflictError`. Callers use `instanceof` checks instead of string parsing.

```typescript
// Adapter layer - parses and throws typed error
async deleteBranch(dir: string, ref: string): Promise<void> {
  try {
    await git.branch(['-D', ref])
  } catch (error) {
    const worktreePath = this.parseWorktreeConflictFromError(error)
    if (worktreePath) {
      throw new WorktreeConflictError(ref, worktreePath, error)
    }
    throw this.createError('deleteBranch', error)
  }
}

// Operation layer - clean typed error handling
try {
  await git.deleteBranch(repoPath, branchName)
} catch (error) {
  if (error instanceof WorktreeConflictError) {
    // Handle it
  }
  throw error
}
```

### 2. Pre-flight Checks Can Be Counter-Productive

The "hybrid approach" (pre-flight check + fallback) seemed like an optimization but actually made things worse:

- **Common case (no conflict):** 2 git calls instead of 1
- **Added complexity:** Two code paths to maintain
- **False sense of coverage:** Pre-flight only caught direct checkouts, not edge cases

**Lesson:** Don't optimize before measuring. The simpler approach (try first, handle error) is both faster for the common case and handles all edge cases.

### 3. Shared Utilities Should Be Extracted Early

The `isWorktreeDirty()` function was duplicated across multiple files. During this fix, it was consolidated into `WorktreeUtils.ts`. This should have been done when the second usage appeared.

**Pattern to follow:**
- First usage: inline is fine
- Second usage: extract to shared utility
- Don't wait for the third usage

### 4. Test Coverage Should Include Edge Cases

The existing tests only covered direct checkout scenarios. Mid-rebase, cherry-pick, and bisect scenarios were not tested. These are exactly the cases where the bug manifested.

**Added tests:**
- "should detect worktree when branch is mid-rebase with conflict"
- "should remove worktree when branch is mid-rebase with no conflicts"

## Future Recommendations

### 1. Audit Other Git Error Handling

Other operations may have similar issues where we try to predict git's behavior instead of handling its errors. Candidates to audit:

- `WorktreeOperation.remove()` - What errors can git throw?
- `BranchOperation.rename()` - What if branch is locked?
- `checkout()` operations - Various failure modes

### 2. Create Structured Error Types for Common Git Errors

Following the `WorktreeConflictError` pattern, consider:

```typescript
class BranchNotFoundError extends BranchError { }
class BranchAlreadyExistsError extends BranchError { }
class DirtyWorktreeError extends WorktreeError { }
class IndexLockedError extends GitError { }
```

These should be thrown by the adapter layer, not parsed by callers.

### 3. Consider a Git Error Parser Utility

If we find ourselves parsing multiple git error formats, consider a centralized utility:

```typescript
// In adapter layer
function parseGitError(error: unknown): TypedGitError {
  const message = extractMessage(error)

  if (message.includes('used by worktree')) {
    return new WorktreeConflictError(...)
  }
  if (message.includes('not found')) {
    return new NotFoundError(...)
  }
  // ... etc

  return new GenericGitError(message)
}
```

### 4. Document the "Let Git Decide" Pattern

This pattern should be documented as a best practice:

> When git has authoritative knowledge about repository state (locks, conflicts,
> worktree associations), don't try to detect it ourselves. Attempt the operation
> and handle git's error response. This is more reliable and maintainable than
> probing git's internals.

## Files Changed

- `src/node/shared/errors.ts` - Added `WorktreeConflictError`
- `src/node/adapters/git/SimpleGitAdapter.ts` - Error parsing in adapter
- `src/node/operations/BranchOperation.ts` - Simplified deletion logic
- `src/node/operations/WorktreeUtils.ts` - Added `isWorktreeDirty()`
- `src/node/__tests__/operations/BranchOperation.test.ts` - Added edge case tests

## Timeline

1. User reports: "Delete Branch" fails but "Cleanup" works
2. Root cause identified: mid-rebase worktrees have `branch: null` in `listWorktrees()`
3. Initial fix: Probe `.git/rebase-merge/head-name` - works but fragile
4. Improved fix: Let git tell us via error parsing - simpler and complete
5. Further simplification: Remove redundant pre-flight check
