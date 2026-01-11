# Post-Mortem: Parallel Rebase Conflicts Not Detected in Temporary Worktrees

**Date:** January 2026
**Severity:** High (blocked parallel rebase feature entirely)
**Time to diagnose:** ~6 hours of iterative debugging

## Summary

When users attempted to rebase with uncommitted changes in their active worktree, the parallel rebase feature would create a temporary worktree for isolation. However, when conflicts occurred during the rebase, the UI would either:
1. Show no error and no conflict UI (silent failure)
2. Throw cryptic git errors like `README.md: needs merge` on subsequent operations
3. Leave the active worktree in a detached HEAD state after cancellation

## Root Causes (Multiple Interconnected Issues)

This bug was actually **7 distinct issues** that manifested as one broken feature. Each fix revealed the next layer of problems.

### Issue 1: Linked Worktree Git Directory Resolution

**Location:** `SimpleGitAdapter.ts` - `detectRebase()`, `checkForLockFile()`, `getRebaseState()`

The git adapter checked for rebase state by looking at `.git/rebase-merge/`:

```typescript
// BUGGY CODE
private async detectRebase(dir: string): Promise<boolean> {
  const gitDir = path.join(dir, '.git')
  const rebaseMerge = path.join(gitDir, 'rebase-merge')
  // ...
}
```

In linked worktrees (including temp worktrees), `.git` is a **file** containing `gitdir: /path/to/actual/git/dir`, not a directory. The rebase state files are in the linked git directory, not `.git/`.

### Issue 2: Validation Blocking Conflict Resume

**Location:** `RebaseExecutor.ts` - `execute()` for existing sessions

When resuming an existing session, the code validated "no rebase in progress":

```typescript
// BUGGY CODE - removed this check for existing sessions
const rebaseCheck = await this.validateNoRebaseInProgress(context.executionPath, git)
if (!rebaseCheck.valid) {
  return { status: 'error', errorCode: 'REBASE_IN_PROGRESS', message: rebaseCheck.message }
}
```

But when there's a conflict, a rebase IS in progress - that's expected! This validation incorrectly rejected the resume attempt.

### Issue 3: executeJobs Re-executing Conflicted Jobs

**Location:** `RebaseExecutor.ts` - `executeJobs()`

When resuming after a conflict, `executeJobs` would try to run the job again:

```typescript
// BUGGY - would call executeJob on a job that already had conflicts
const result = await this.executeJob(executionPath, job, git)
```

This attempted `git checkout` which fails with `needs merge` because there are unresolved conflicts.

### Issue 4: confirmRebaseIntent Not Returning Conflict Status

**Location:** `RebaseOperation.ts` - `confirmRebaseIntent()`

The IPC handler only handled `error` status, not `conflict`:

```typescript
// BUGGY CODE
if (result.status === 'error') {
  throw new RebaseOperationError(result.message, result.errorCode)
}
return await UiStateOperation.getUiState(repoPath)  // Lost conflict info!
```

### Issue 5: cancelRebaseIntent Not Cleaning Up Temp Worktree

**Location:** `RebaseOperation.ts` - `cancelRebaseIntent()`

The cancel function only cleared the session, leaving the temp worktree with conflict state:

```typescript
// BUGGY CODE
static async cancelRebaseIntent(repoPath: string) {
  await SessionService.clearSession(repoPath)  // That's it!
  return UiStateOperation.getUiState(repoPath)
}
```

The stored execution context persisted, and on next rebase attempt it would reuse the corrupted temp worktree.

### Issue 6: abort Not Restoring Active Worktree

**Location:** `RebaseExecutor.ts` - `abort()`

After aborting, the temp worktree was deleted but the active worktree was left in detached HEAD state - the original branch wasn't restored.

### Issue 7: getUiState Checking Wrong Path for Conflicts

**Location:** `UiStateOperation.ts` - `getUiState()`

The UI state builder got working tree status from the active worktree:

```typescript
// BUGGY CODE
const workingTreeStatus = repo.workingTreeStatus  // From active worktree
```

But conflicts exist in the temp worktree! The UI never saw `isRebasing: true` or the conflicted files.

## Why It Was Hard to Diagnose

### 1. Each Fix Revealed the Next Bug

The debugging was like peeling an onion:
- Fix linked worktree → now getting `REBASE_IN_PROGRESS` error
- Fix validation → now getting `needs merge` error
- Fix job re-execution → now no error but no UI
- Fix IPC response → now cancel doesn't work
- Fix cancel cleanup → now active worktree broken
- Fix abort restore → now conflicts not showing in UI
- Fix UI state path → finally working

### 2. Temp Worktree Isolation Made Debugging Harder

The temp worktree was hidden in `.git/teapot-worktrees/`. Debugging required:
- Manually inspecting temp worktree state
- Understanding git's linked worktree structure
- Knowing where `.git/rebase-merge` would be for linked worktrees

### 3. State Persistence Across Restarts

The stored execution context persisted to disk. Restarting the app would pick up the old corrupted state, making it seem like the same bug kept recurring even after fixes.

### 4. Multiple Valid Code Paths

The rebase flow has different paths for:
- Clean worktree (use active worktree directly)
- Dirty worktree (create temp worktree)
- Fresh rebase (create new session)
- Resume after conflict (reuse stored context)
- Resume after external continue (reconcile state)

Each path had its own bugs.

### 5. Silent Failures

Many failures were caught and logged but didn't surface to the user:
- `checkAndBreakStaleLock` errors were swallowed
- Temp worktree cleanup failures were non-fatal
- Branch restore failures were best-effort

### 6. Correct Behavior in Parts

Individual components worked correctly in isolation:
- Temp worktree creation worked
- Rebase execution worked
- Conflict detection worked (in the right directory)
- Session management worked

The bugs were in the **integration** between components.

## The Fixes

### Fix 1: Resolve Git Directory for Linked Worktrees

```typescript
private async resolveGitDir(dir: string): Promise<string> {
  const gitPath = path.join(dir, '.git')
  const stat = await fs.promises.stat(gitPath)
  if (stat.isDirectory()) return gitPath

  // It's a file - read the gitdir pointer
  const content = await fs.promises.readFile(gitPath, 'utf-8')
  const match = content.match(/^gitdir:\s*(.+)$/m)
  if (match) return path.isAbsolute(match[1]) ? match[1] : path.resolve(dir, match[1])
  return gitPath
}
```

### Fix 2: Skip Validation for Existing Sessions

Removed `validateNoRebaseInProgress` for existing session path - conflicts are expected.

### Fix 3: Detect Conflict-in-Progress State

```typescript
if (session.state.queue.activeJobId && session.state.session.status === 'awaiting-user') {
  // Return conflict state - don't try to execute
  return { status: 'conflict', job: activeJob, conflicts: workingTreeStatus.conflicted, state }
}
```

### Fix 4: Return Conflict Info from confirmRebaseIntent

```typescript
if (result.status === 'conflict') {
  return { success: false, uiState, conflicts: result.conflicts }
}
```

### Fix 5: Full Cleanup in cancelRebaseIntent

Added: abort rebase in temp worktree, release temp worktree, clear stored context, restore original branch.

### Fix 6: Restore Active Worktree in abort

```typescript
if (storedContext.isTemporary && session?.originalBranch) {
  await this.restoreActiveWorktree(activeWorktreePath, session.originalBranch, git)
}
```

### Fix 7: Check Temp Worktree for Conflict State

```typescript
const storedContext = await ExecutionContextService.getStoredContext(repoPath)
if (storedContext?.isTemporary) {
  const tempStatus = await gitAdapter.getWorkingTreeStatus(storedContext.executionPath)
  workingTreeStatus = { ...workingTreeStatus, isRebasing: tempStatus.isRebasing, conflicted: tempStatus.conflicted }
}
```

## Lessons Learned

### 1. Linked Worktrees Are Different

Git linked worktrees have different structure than main worktrees. Any code that accesses `.git/` directly needs to handle the `gitdir:` pointer.

### 2. Test the Full Lifecycle

The feature involved: create → conflict → cancel → retry → conflict → resolve → complete. Each transition needed testing.

### 3. Cleanup Is Critical

Temp resources must be cleaned up on ALL exit paths:
- Success
- Error/exception
- User cancellation
- App crash/restart

### 4. State Must Be Consistent Across Components

When state is split across:
- Session (in-memory)
- Stored context (on disk)
- Git state (in worktrees)

All three must stay synchronized.

### 5. UI Needs to Query the Right Location

When execution happens in a different location than the user's working directory, the UI state builder must know where to look.

## Prevention

1. **Worktree Abstraction Layer**: Create a unified abstraction for worktree operations that handles linked vs main worktrees transparently.

2. **Explicit State Machine**: Implement the proposed `RebasePhase` state machine with explicit transitions and guards.

3. **Integration Tests**: Add tests that cover the full parallel rebase lifecycle including:
   - Dirty worktree detection
   - Temp worktree creation
   - Conflict occurrence
   - Cancel/abort/continue paths
   - Cleanup verification

4. **Context Validation on Load**: When loading a stored execution context, validate that the referenced worktree still exists and is in the expected state.

5. **Cleanup Guarantees**: Use try/finally patterns to ensure cleanup happens even on unexpected errors.
