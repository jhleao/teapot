# Idea: Block All Worktree Conflicts During Rebase

**Source:** `worktree-rebase-conflicts.md` (user stories document)
**Status:** Proposed
**Priority:** High (UX, reliability)
**Effort:** Medium (1 week)

## Problem

When rebasing a branch that's checked out in another worktree, the current implementation:

1. **Silently auto-detaches** clean worktrees (switches to detached HEAD)
2. **Blocks** dirty worktrees with an error
3. **Leaves worktrees in detached state** after rebase completes (no re-attachment)

This creates multiple UX issues:

### User Story: Silent Modification

1. User has `feature` checked out in `/Users/me/project` (their main repo)
2. User opens Teapot in a separate worktree and initiates rebase of `feature`
3. Teapot auto-detaches the main repo (switches to detached HEAD)
4. Rebase completes successfully
5. Main repo is left in detached HEAD state with no notification
6. User discovers they're in detached HEAD later, causing confusion

### Additional Issues

- User's terminal prompt/status becomes stale
- If user had editor state (open files, undo history) tied to specific commits, it's now disconnected
- User may not even know the rebase was triggered from another window
- Multiple worktrees can be silently modified during a stack rebase

### Root Cause

The auto-detach feature was added to reduce friction, but the edge cases and failure modes make it more trouble than it's worth. The re-checkout after rebase was failing when branches were already checked out elsewhere, so it was removed—leaving worktrees permanently detached.

## Proposed Solution

**Option A (Recommended): Block all worktree conflicts.** Don't auto-detach any worktrees. If a branch is checked out in another worktree, block the rebase and tell the user.

```typescript
// Before: Complex logic to partition and auto-detach
async function validateNoWorktreeConflicts(
  repoPath: string,
  branches: string[]
): Promise<ValidationResult> {
  const conflicts = await detectWorktreeConflicts(repoPath, branches)

  const { clean, dirty } = partitionByDirtiness(conflicts)

  if (dirty.length > 0) {
    return { blocked: true, reason: 'dirty worktrees' }
  }

  // Auto-detach clean worktrees (problematic!)
  await detachCleanWorktrees(clean)
  return { blocked: false, autoDetached: clean }
}

// After: Simple blocking
async function validateNoWorktreeConflicts(
  repoPath: string,
  branches: string[]
): Promise<ValidationResult> {
  const conflicts = await detectWorktreeConflicts(repoPath, branches)

  if (conflicts.length > 0) {
    return {
      blocked: true,
      reason: 'branches checked out in other worktrees',
      conflicts: conflicts.map(c => ({
        branch: c.branch,
        worktreePath: c.worktreePath
      }))
    }
  }

  return { blocked: false }
}
```

### User-Facing Error

```
Cannot rebase: The following branches are checked out in other worktrees:

  • feature-a → /Users/me/project
  • feature-b → /Users/me/project/.worktrees/feature-b

Please switch these worktrees to a different branch before rebasing.
```

### Benefits

1. **Simple, predictable behavior**: No silent modifications
2. **User stays in control**: Must explicitly switch branches
3. **No orphaned detached states**: Worktrees always have branches
4. **Easier to maintain**: Removes complex auto-detach/re-attach logic

### Trade-offs

- Requires user to manually switch branches in other worktrees
- Slightly more friction for the "quick rebase" use case

These trade-offs are acceptable because:
- Switching branches is a quick operation
- User is made aware of what's happening
- Prevents confusion and unexpected state

---

## Architecture Design Decision

### ADR-001: Block Over Auto-Detach

**Decision:** Block rebase when any branch is checked out in another worktree. Do not auto-detach worktrees.

**Rationale:**
- Principle of least surprise: user's worktrees are not modified without consent
- Simpler implementation: no need to track `autoDetachedWorktrees` or attempt re-checkout
- Avoids orphaned detached HEAD states
- Error message clearly tells user what to do

**Alternatives Considered:**
1. **Auto-detach with notification**: Rejected - still modifies worktrees without consent
2. **Ask before detaching**: Rejected - interrupts flow, adds UI complexity
3. **Auto re-checkout after rebase**: Rejected - fails when branch is checked out elsewhere

### ADR-002: Remove Auto-Detach Infrastructure

**Decision:** Remove all code related to `autoDetachedWorktrees`, including session storage, cleanup logic, and re-checkout attempts.

**Rationale:**
- Dead code if we're not using it
- Reduces maintenance burden
- Removes potential source of bugs

### ADR-003: Clear Error Messages

**Decision:** Error messages should list all conflicting branches and their worktree paths.

**Rationale:**
- User can fix all issues at once
- No guessing about which worktree needs attention
- Actionable: user knows exactly what to do

---

## First Implementation Steps

### Step 1: Update RebaseValidator (1 hour)

```typescript
// src/node/rebase/RebaseValidator.ts

interface WorktreeConflict {
  branch: string
  worktreePath: string
}

interface ValidationResult {
  valid: boolean
  conflicts?: WorktreeConflict[]
}

export async function validateNoWorktreeConflicts(
  repoPath: string,
  activeWorktreePath: string,
  branches: string[]
): Promise<ValidationResult> {
  const worktrees = await git.listWorktrees(repoPath)

  const conflicts: WorktreeConflict[] = []

  for (const branch of branches) {
    const conflict = worktrees.find(
      wt => wt.branch === branch && wt.path !== activeWorktreePath
    )
    if (conflict) {
      conflicts.push({
        branch,
        worktreePath: conflict.path
      })
    }
  }

  if (conflicts.length > 0) {
    return { valid: false, conflicts }
  }

  return { valid: true }
}
```

### Step 2: Update Error Message (30 min)

```typescript
// src/node/rebase/RebaseOperation.ts

function formatWorktreeConflictError(conflicts: WorktreeConflict[]): string {
  const lines = [
    'Cannot rebase: The following branches are checked out in other worktrees:',
    ''
  ]

  for (const { branch, worktreePath } of conflicts) {
    lines.push(`  • ${branch} → ${worktreePath}`)
  }

  lines.push('')
  lines.push('Please switch these worktrees to a different branch before rebasing.')

  return lines.join('\n')
}
```

### Step 3: Remove Auto-Detach Logic (2 hours)

Remove from `RebaseOperation.ts`:
- `detachCleanWorktrees()` method
- `mergeDetachedWorktrees()` method
- `autoDetachedWorktrees` parameter passing
- Logic that partitions conflicts into clean/dirty

```typescript
// Before: Complex partitioning
const { clean, dirty } = partitionWorktreeConflicts(conflicts)
if (dirty.length > 0) {
  throw new RebaseBlockedError(formatDirtyWorktreeError(dirty))
}
await detachCleanWorktrees(repoPath, clean)

// After: Simple blocking
if (conflicts.length > 0) {
  throw new RebaseBlockedError(formatWorktreeConflictError(conflicts))
}
```

### Step 4: Remove Session State (1 hour)

Remove from `SessionService.ts`:
- `autoDetachedWorktrees` field in session interface
- `clearAutoDetachedWorktrees()` function

Remove from `store.ts`:
- `DetachedWorktree` type
- `autoDetachedWorktrees` field in `StoredRebaseSession`

```typescript
// Before
interface StoredRebaseSession {
  queue: RebaseQueue
  activeJobId?: string
  autoDetachedWorktrees?: DetachedWorktree[]  // Remove this
  // ...
}

// After
interface StoredRebaseSession {
  queue: RebaseQueue
  activeJobId?: string
  // autoDetachedWorktrees removed
}
```

### Step 5: Remove Finalization Re-checkout (30 min)

```typescript
// src/node/rebase/RebaseExecutor.ts

// Before: Attempted re-checkout
async function finalizeRebase(): Promise<void> {
  // ... rebase complete logic ...

  // Re-checkout auto-detached worktrees (problematic!)
  for (const { worktreePath, branch } of autoDetachedWorktrees) {
    try {
      await git.checkout(worktreePath, branch)
    } catch (error) {
      log.warn(`Failed to re-checkout ${branch} in ${worktreePath}`)
    }
  }
}

// After: Clean finalization
async function finalizeRebase(): Promise<void> {
  // ... rebase complete logic ...

  // No re-checkout needed - branches were never detached
}
```

### Step 6: Update Tests (1 hour)

```typescript
// src/node/__tests__/rebase/RebaseValidator.test.ts

describe('validateNoWorktreeConflicts', () => {
  it('blocks when branch is checked out in another worktree', async () => {
    // Setup: branch checked out in different worktree
    const result = await validateNoWorktreeConflicts(
      repoPath,
      activeWorktreePath,
      ['feature']
    )

    expect(result.valid).toBe(false)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts![0].branch).toBe('feature')
  })

  it('allows rebase when branch is only in active worktree', async () => {
    const result = await validateNoWorktreeConflicts(
      repoPath,
      worktreeWithFeature,  // Active worktree has the branch
      ['feature']
    )

    expect(result.valid).toBe(true)
  })

  // Remove tests for auto-detach behavior
})
```

---

## Code Cleanup Checklist

### In `RebaseOperation.ts`:
- [ ] Remove `detachCleanWorktrees()` method
- [ ] Remove `mergeDetachedWorktrees()` method
- [ ] Remove `autoDetachedWorktrees` parameter passing
- [ ] Remove logic that partitions conflicts into clean/dirty

### In `SessionService.ts`:
- [ ] Remove `autoDetachedWorktrees` field in session
- [ ] Remove `clearAutoDetachedWorktrees()` function

### In `RebaseValidator.ts`:
- [ ] Remove `partitionWorktreeConflicts()` method
- [ ] Simplify to only return conflicts (no clean/dirty distinction)

### In `store.ts`:
- [ ] Remove `DetachedWorktree` type
- [ ] Remove `autoDetachedWorktrees` from `StoredRebaseSession`

### In tests:
- [ ] Update tests that verify auto-detach behavior
- [ ] Add tests for blocking behavior

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| User friction (must switch branches) | Clear error message with actionable instructions |
| Breaking existing workflows | Behavior change is intentional; document in release notes |
| Partial migration (old sessions have field) | Ignore `autoDetachedWorktrees` in old sessions if present |
| Stack rebases more disruptive | Consider future "switch and rebase" feature if needed |
