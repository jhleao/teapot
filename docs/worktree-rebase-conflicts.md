# Worktree Rebase Conflicts: User Stories and Edge Cases

## Background

When rebasing a branch, git requires that the branch is not checked out in any worktree. If it is, git fails with:

```
fatal: 'branch-name' is already used by worktree at '/path/to/worktree'
```

Teapot currently tries to handle this by auto-detaching clean worktrees before rebase and re-attaching them after. This document explores the edge cases and UX issues with this approach.

## Current Implementation

### Flow
1. User initiates rebase from the active worktree
2. `RebaseValidator.validateNoWorktreeConflicts()` checks if any branches being rebased are checked out in *other* worktrees
3. If conflicts exist:
   - **Dirty worktrees** → Block rebase, show error
   - **Clean worktrees** → Auto-detach (switch to detached HEAD), track in `autoDetachedWorktrees`
4. Rebase executes
5. `finalizeRebase()` ~~tries to re-checkout branches in auto-detached worktrees~~ (removed in recent fix)

### Problem
The re-checkout after rebase was failing when the branch was already checked out elsewhere, causing errors. The fix removed the re-checkout, but now worktrees are left in detached HEAD state with no notification to the user.

---

## User Stories

### Story 1: Single Worktree (Happy Path)
**Setup:** User has only the main repo, no additional worktrees.

**Flow:**
1. User rebases `feature` onto `main`
2. No worktree conflicts exist
3. Rebase completes successfully

**UX:** ✅ Works as expected.

---

### Story 2: Active Worktree Has the Branch (Happy Path)
**Setup:**
- Main repo at `/Users/me/project`
- User is working in main repo with `feature` checked out

**Flow:**
1. User rebases `feature` onto `main`
2. `feature` is in the active worktree, so no conflict detected for *other* worktrees
3. Rebase completes, `feature` is updated in place

**UX:** ✅ Works as expected.

---

### Story 3: Another Worktree Has the Branch (Current Behavior - Problematic)
**Setup:**
- Main repo at `/Users/me/project` with `feature` checked out
- Teapot worktree at `/tmp/teapot-worktree` is the active worktree

**Flow:**
1. User initiates rebase of `feature` from Teapot UI
2. Teapot detects `feature` is checked out in `/Users/me/project`
3. Main repo is clean, so Teapot auto-detaches it (switches to detached HEAD)
4. Rebase completes successfully
5. Main repo is left in detached HEAD state

**UX Issues:**
- ❌ User's main repo is silently modified
- ❌ No notification that the worktree was detached
- ❌ User discovers they're in detached HEAD later, causing confusion
- ❌ If user had terminal open in main repo, their prompt/status is now stale

---

### Story 4: Another Worktree Has the Branch and is Dirty
**Setup:**
- Main repo at `/Users/me/project` with `feature` checked out and uncommitted changes
- Teapot worktree is active

**Flow:**
1. User initiates rebase of `feature`
2. Teapot detects `feature` is checked out in `/Users/me/project`
3. Main repo is dirty, so Teapot blocks the rebase
4. Error shown: "Cannot rebase: feature is checked out in /Users/me/project with uncommitted changes"

**UX:** ⚠️ Acceptable, but could be clearer about what action to take.

---

### Story 5: Multiple Branches in Rebase, Multiple Worktrees Affected
**Setup:**
- Main repo with `feature-a` checked out
- Worktree A with `feature-b` checked out
- Worktree B with `feature-c` checked out
- User rebases a stack containing `feature-a`, `feature-b`, and `feature-c`

**Flow:**
1. Teapot detects all three branches are checked out elsewhere
2. If all are clean, all three worktrees get detached
3. Rebase completes
4. Three worktrees are now in detached HEAD state

**UX Issues:**
- ❌ Multiple worktrees silently modified
- ❌ Blast radius is large and surprising
- ❌ User may not even know these worktrees exist

---

### Story 6: Re-checkout Fails (Original Bug)
**Setup:**
- Main repo at `/Users/me/project` with `feature` checked out
- Teapot worktree at `/tmp/teapot-worktree`

**Flow (before fix):**
1. User rebases `feature`
2. Teapot auto-detaches main repo
3. Rebase completes
4. Teapot tries to checkout `feature` in `/tmp/teapot-worktree`
5. Fails: "fatal: 'feature' is already used by worktree at '/Users/me/project'"
6. Error logged, user sees warning

**What went wrong:** The re-checkout was targeting the wrong worktree, or the branch was already checked out elsewhere.

---

## Proposed Solutions

### Option A: Block All Worktree Conflicts (Recommended)
Don't auto-detach any worktrees. If a branch is checked out in another worktree, block the rebase and tell the user.

**Pros:**
- Simple, predictable behavior
- No silent modifications to other worktrees
- User is always in control

**Cons:**
- Requires user to manually switch branches in other worktrees
- Slightly more friction

**Implementation:**
1. Remove `detachCleanWorktrees()` logic
2. Treat clean and dirty worktree conflicts the same - block and show error
3. Remove `autoDetachedWorktrees` tracking entirely
4. Clean up unused code (`clearAutoDetachedWorktrees`, `mergeDetachedWorktrees`, etc.)

---

### Option B: Auto-detach with Notification
Keep auto-detach for clean worktrees, but notify the user prominently.

**Pros:**
- Less friction for users who want to rebase quickly

**Cons:**
- Still modifies other worktrees without explicit consent
- Notification might be missed
- User still ends up with detached HEAD worktrees

**Implementation:**
1. After rebase, show a modal/toast: "The following worktrees were detached: [list]. You may want to checkout your branches again."
2. Don't attempt auto re-checkout

---

### Option C: Ask Before Detaching
When conflicts are detected, prompt the user: "Branch X is checked out in worktree Y. Detach it to continue?"

**Pros:**
- User is informed and consents
- Explicit about what will happen

**Cons:**
- More UI complexity
- Interrupts the rebase flow

---

## Recommendation

**Option A (Block All Worktree Conflicts)** is the cleanest solution:

1. It's the simplest to implement and maintain
2. It follows the principle of least surprise
3. It doesn't modify worktrees the user isn't actively working in
4. The "friction" of switching branches manually is minimal and makes the user aware of what's happening

The auto-detach feature was likely added to reduce friction, but the edge cases and failure modes make it more trouble than it's worth.

---

## Code Cleanup Required

If we proceed with Option A, the following should be removed:

### In `RebaseOperation.ts`:
- `detachCleanWorktrees()` method
- `mergeDetachedWorktrees()` method
- `autoDetachedWorktrees` parameter passing
- Logic that partitions conflicts into clean/dirty

### In `SessionService.ts`:
- `autoDetachedWorktrees` field in session
- `clearAutoDetachedWorktrees()` function

### In `RebaseValidator.ts`:
- `partitionWorktreeConflicts()` method (unless used elsewhere)

### In `store.ts`:
- `DetachedWorktree` type (if unused elsewhere)

### In types:
- `autoDetachedWorktrees` field in `StoredRebaseSession`

### In tests:
- Update tests that verify auto-detach behavior
