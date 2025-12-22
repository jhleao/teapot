# Auto-Rebase After Ship It

## Problem Statement

When shipping a mid-stack PR, child branches become stale. Their parent commit no longer matches the remote base branch, causing:

1. PRs created for child branches show duplicate commits
2. Merge conflicts appear even when there are no logical conflicts
3. User must manually rebase to fix the situation

### Example Scenario

```
Initial state:
main ← branch-A (commit 8) ← branch-B (commit 9) ← branch-C (commit 10)

After shipping PR for branch-B (commit 9 → branch-A):
- origin/branch-A now contains: 8 + 9 (merged)
- Local branch-C still has parent: local commit 9
- Creating PR for branch-C shows commits 9 + 10 (duplicate)
- GitHub detects conflicts in files modified by both 9 and 10
```

## Proposed Solution

After successfully merging a mid-stack PR via "Ship It", automatically rebase child branches onto the updated base.

## Implementation Options

### Option A: Automatic Rebase (Recommended)

After Ship It completes:

1. Fetch updated remote state
2. Detect child branches of the shipped branch
3. Rebase each child onto `origin/<shipped-branch>`
4. Force-push rebased branches
5. Update PRs if they exist

**Pros:**

- Seamless UX - stack stays healthy automatically
- Matches behavior of Graphite, ghstack, etc.

**Cons:**

- Can cause conflicts that block the operation
- Force-push changes commit SHAs (breaks links to specific commits)

### Option B: Prompt User

Show dialog after Ship It: "Branch-C needs to be rebased. Rebase now?"

**Pros:**

- User stays in control
- Can defer if they have uncommitted work

**Cons:**

- Extra click for common operation
- User might dismiss and forget

### Option C: Defer to PR Creation

When creating a PR, detect if base has diverged and offer rebase first.

**Pros:**

- Only rebases when needed
- User can create PR without rebase if they want

**Cons:**

- Conflicts surface later in workflow
- PR might be created with known issues

## Edge Cases

### 1. Multiple Child Branches

```
main ← A ← B ← C
           ↖ D
```

When shipping B, both C and D need rebasing. Order matters if D depends on C.

**Solution:** Build dependency graph, rebase in topological order.

### 2. Rebase Conflicts

Child branch has changes that conflict with merged content.

**Solution:**

- Stop rebase process
- Show conflict resolution UI
- Allow abort to restore previous state

### 3. Uncommitted Changes

User has dirty working tree when Ship It completes.

**Solution:**

- Stash changes before rebase
- Restore after rebase completes
- Or: block rebase, show warning

### 4. User on Child Branch

User is checked out to a branch that needs rebasing.

**Solution:**

- Rebase in place (branch moves with HEAD)
- Or: checkout to shipped branch first, then rebase children

### 5. Child Branch Has Unpushed Commits

Local branch has commits not yet on remote.

**Solution:**

- Still rebase - this is normal workflow
- Force-push will update remote

### 6. Child Branch PR Already Exists

PR exists but will have new commit SHAs after rebase.

**Solution:**

- Force-push updates the PR automatically
- GitHub preserves PR number and comments

### 7. Nested Stack (3+ levels)

```
main ← A ← B ← C ← D
```

Ship B: need to rebase C, then rebase D onto new C.

**Solution:** Recursive rebase in order: C first, then D.

### 8. Branch Deleted on Remote

Shipped branch was deleted as part of cleanup.

**Solution:**

- Rebase onto the PR's merge target instead (e.g., main)
- Or: rebase onto `origin/main` if that was the ultimate target

### 9. Rebase Results in Empty Commits

After rebase, a commit becomes empty (changes already in base).

**Solution:**

- Skip empty commits (`git rebase --skip` equivalent)
- Warn user if commits were dropped

### 10. Network Failure Mid-Operation

Fetch succeeds, rebase succeeds, push fails.

**Solution:**

- Local state is still valid (rebased)
- Retry push, or let user push manually later

## Data Flow

```
Ship It clicked
    │
    ▼
Merge PR via GitHub API
    │
    ▼
Fetch origin (get updated base)
    │
    ▼
Find child branches ◄── Use commit graph to find branches
    │                    whose parent is the shipped branch
    ▼
For each child (topological order):
    │
    ├─► Check for uncommitted changes
    │       └─► Stash or abort
    │
    ├─► git rebase origin/<base> <child>
    │       └─► Handle conflicts if any
    │
    └─► git push --force-with-lease origin <child>
            └─► Updates PR automatically
```

## UI Considerations

### During Rebase

- Show progress: "Rebasing branch-C onto branch-A..."
- Show which branches are queued
- Allow cancel (aborts current rebase, restores state)

### On Conflict

- Switch to conflict resolution mode (existing UI)
- Show which file(s) conflict
- Provide continue/abort options

### After Success

- Toast: "Rebased 2 branches onto branch-A"
- Stack view updates to show clean state

## Questions to Resolve

1. **Should rebase be opt-in or opt-out?**
   - Setting: "Auto-rebase children after Ship It" (default: on)

2. **What if user explicitly doesn't want to rebase?**
   - Skip button in prompt (Option B)
   - Or: always auto-rebase, user can undo via git reflog

3. **Should we update PR descriptions/targets?**
   - After rebasing, PR target might need updating if base was also shipped

4. **Force-push safety**
   - Use `--force-with-lease` to avoid overwriting others' changes
   - Warn if remote has unexpected commits

## Implementation Phases

### Phase 1: Basic Auto-Rebase

- Single child branch
- No conflict handling (abort on conflict)
- Force-push after rebase

### Phase 2: Multi-Branch Support

- Topological ordering
- Handle diamond dependencies

### Phase 3: Conflict Resolution

- Integrate with existing rebase conflict UI
- Resume/abort support

### Phase 4: Polish

- Progress UI
- Settings for behavior
- Edge case handling

## Related Code

- Ship It: `src/node/core/utils/ship-it.ts`
- Rebase: `src/node/core/utils/rebase/`
- PR update: `src/node/core/forge/`
- Branch detection: `src/node/core/utils/build-ui-state.ts`
