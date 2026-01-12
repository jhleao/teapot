# Architecture Issues: Rebase Worktree Lifecycle Management

This document identifies structural issues in how the rebase system manages worktree lifecycles, particularly around the interaction between temporary execution worktrees and user worktrees that have branches checked out.

## Background

When a user triggers a rebase from the kanban UI, the system may need to rebase a branch that is currently checked out in a different worktree. For example:

- User has `feature-x` checked out in `/worktrees/feature-x/`
- User opens the kanban in `/worktrees/main/` and drags `feature-x` to rebase it
- The system must handle the fact that `feature-x` is "in use" by another worktree

The current implementation:
1. Detaches HEAD in the original worktree (freeing the branch ref)
2. Creates a temporary worktree (`teapot-exec-*`) to perform the rebase
3. After rebase completes, attempts to re-checkout the branch in its original worktree

## Issue 1: Implicit Assumptions About User Intent

The system assumes that after rebasing a branch, the user wants their original worktree to be updated to point to the rebased branch. This assumption is embedded deeply in the `autoDetachedWorktrees` mechanism and the `finalizeRebase` function.

However, this assumption may not match user expectations:

- The user may have been in the middle of reviewing specific commits in that worktree
- The user may have editor state (open files, cursor positions, undo history) tied to the pre-rebase commit tree
- The user may not even be aware that a rebase was triggered from another window

The system provides no opt-out from this behavior. The re-checkout happens automatically, and failures are reported as warnings rather than prompting the user for input.

This creates a situation where the system is making decisions about worktree state on behalf of the user, without the user having explicitly requested that behavior. The "helpful" automation becomes a source of confusion when it fails or produces unexpected results.

## Issue 2: Lifecycle Coupling Between Execution Context and Finalization

The temporary execution worktree is managed by `ExecutionContextService`, which follows an acquire/release pattern:

```
acquire() → [operation runs] → release()
```

The `executeWithContext` helper enforces this pattern, calling `release()` after the operation callback completes. However, `finalizeRebase` runs *inside* that callback and needs to perform operations that conflict with the execution context still existing.

Specifically, `finalizeRebase` needs to:
1. Re-checkout branches in their original worktrees
2. These branches may still be checked out in the temp worktree
3. Git refuses to checkout a branch that's in use by another worktree

This creates a temporal dependency: finalization logic needs the temp worktree to be released, but release happens *after* finalization. The current fix (detaching HEAD in the temp worktree at the start of finalization) is a workaround that reaches into the execution context's internal state to work around the lifecycle mismatch.

This coupling manifests as:
- `finalizeRebase` knowing about and manipulating the execution worktree's HEAD
- Error handling that must account for the execution context being in an intermediate state
- The finalization logic being unable to cleanly separate "rebase complete" from "cleanup complete"

## Issue 3: Distributed State Across Multiple Services

Rebase operation state is spread across several locations:

| State | Location | Persistence |
|-------|----------|-------------|
| Rebase jobs and progress | `SessionService` (in-memory + file) | `.git/teapot-rebase-session.json` |
| Execution worktree path | `ExecutionContextService` (in-memory) | `.git/teapot-exec-context.json` |
| Which worktrees were detached | `StoredRebaseSession.autoDetachedWorktrees` | Part of session file |
| Lock state | Lock file | `.git/teapot-exec.lock` |

This distribution creates several problems:

**Inconsistent persistence timing**: The session might be updated but the context not yet persisted, or vice versa. A crash at the wrong moment leaves state partially written.

**Recovery complexity**: On startup, the system must read multiple files, cross-reference them, and infer what operation was in progress. The `cleanupOrphans` function attempts to handle stale temp worktrees, but it cannot know whether an orphaned worktree represents a crashed operation or a bug.

**Unclear ownership**: When `finalizeRebase` modifies `autoDetachedWorktrees` state, it's reaching across service boundaries. The session service "owns" this data, but the rebase executor modifies it directly.

**Race conditions**: Multiple windows can interact with the same repository. While locking prevents concurrent rebase operations, the distributed state makes it harder to reason about what each window sees at any given moment.

## Issue 4: Error Handling Philosophy Mismatch

The codebase mixes two different error handling philosophies:

**Fail-fast with user intervention**: Some operations throw errors that bubble up and require user action. For example, worktree conflicts with dirty changes block the rebase entirely.

**Best-effort with silent degradation**: Other operations catch errors and continue. For example, the re-checkout failures are logged and shown as warnings, but the rebase is still considered "successful."

This inconsistency makes it difficult to predict system behavior:

- If detaching a worktree fails, the rebase is blocked (fail-fast)
- If re-attaching a worktree fails, a warning is shown (best-effort)
- If the temp worktree cleanup fails, it's logged but ignored (silent)

The re-checkout operation sits in an awkward middle ground: it's important enough to attempt and warn about, but not important enough to fail the operation. This suggests the feature itself may be mis-scoped—either it's critical (and should fail properly) or it's optional (and should be explicitly opt-in).

## Issue 5: Implicit Worktree Relationships

The system tracks worktrees through `autoDetachedWorktrees`, which is a flat list of `{worktreePath, branch}` tuples. This representation loses context:

- Why was this worktree detached? (conflict with rebase target? user request?)
- What was the original commit before detaching?
- What is the relationship between this worktree and the rebase operation?

When re-checkout fails, the error message includes the worktree path and branch name, but doesn't help the user understand:
- What state their worktree is now in
- Whether they need to take action
- How to recover

The flat list also doesn't capture ordering or dependencies. If multiple worktrees were detached, should they be re-attached in a specific order? What if re-attaching one affects another?

## Issue 6: Temp Worktree as Branch Container

The temporary execution worktree checks out branches during rebase operations. When rebasing branch X:

1. Temp worktree is created (initially at main, detached)
2. Branch X is checked out in the temp worktree
3. Rebase operations run
4. Branch X now points to new commits
5. Temp worktree still has branch X checked out

At step 5, the temp worktree is "holding" the branch reference. Any other worktree attempting to checkout branch X will fail with Git's "branch is already used by worktree" error.

This holding pattern is invisible to the rest of the system. The `ExecutionContext` object doesn't expose which branch (if any) is currently checked out. The release logic doesn't explicitly handle branch handoff.

The fix of detaching HEAD before finalization works, but it's a symptom of a missing abstraction: the system needs to explicitly manage which worktree "owns" a branch reference at any given time, rather than having this be an implicit side effect of checkout operations.

## Issue 7: Recovery Path Complexity

Consider what happens if the application crashes mid-rebase:

1. On restart, `ExecutionContextService` checks for persisted context
2. If found and not stale, it returns the existing context (continuing the operation)
3. If stale (>24h), it clears the context and creates a new one
4. Meanwhile, `SessionService` may have a persisted session with `autoDetachedWorktrees`
5. The user's worktrees may be in detached HEAD state
6. Orphaned temp worktrees may exist in `.git/teapot-worktrees/`

The recovery logic must handle all combinations:
- Session exists, context exists: continue operation
- Session exists, context missing: recreate context, continue
- Session missing, context exists: orphaned context, cleanup
- Session missing, context missing: clean state
- Any of the above + detached user worktrees: ???

The `autoDetachedWorktrees` list becomes stale if the session is cleared but the worktrees weren't re-attached. There's no mechanism to detect "user worktrees that should have been re-attached but weren't."

## Observations

These issues share a common theme: the system is trying to provide a seamless experience (rebase from anywhere, worktrees stay in sync) but the implementation complexity required to achieve this creates fragility.

The worktree lifecycle during rebase involves:
- Multiple Git repositories (main repo + worktrees)
- Multiple processes (Electron windows)
- Multiple state stores (session, context, Git refs)
- Asynchronous operations with partial failure modes

Each layer adds complexity, and the interactions between layers create edge cases that are difficult to test and reason about.

The current implementation handles the happy path well but accumulates technical debt in error handling, recovery, and state management. The fixes tend to be point solutions (like detaching HEAD before finalization) rather than addressing the underlying architectural tension.
