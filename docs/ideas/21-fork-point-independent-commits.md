# Idea: Fork Point Independent Commits

**Source:** UX analysis of commit ownership ambiguity with multiple spinoffs
**Status:** Partially Implemented (core logic done, drag feature proposed)
**Priority:** Medium (UX clarity, prevents surprising rebases)
**Effort:** Low (core) / Medium (drag feature)

## Problem

### The Ownership Ambiguity

In Teapot's stacked diffs workflow, each branch "owns" commits from its head back to the nearest boundary (trunk commit, another branch head, or root). This ownership determines which commits move during a rebase.

**The problem arises when a branchless commit has multiple spinoffs:**

```
trunk:  A ─ B ─ C
             │
             └─ D (branchless, two spinoffs)
                 ├─ E ─ F [feature-left]
                 └─ G ─ H [feature-right]
```

**Before this change:**
- `feature-left` ownership walk: F → E → D → stops at C (trunk)
- `feature-right` ownership walk: H → G → D → stops at C (trunk)
- Both branches "own" commit D

**This causes surprising behavior:**
- Rebasing `feature-left` moves D, breaking `feature-right`
- Rebasing `feature-right` moves D, breaking `feature-left`
- User expectation: sibling branches should be independent

### User Confusion

Users don't understand why rebasing one branch affects its siblings. The stacked diffs mental model suggests that sibling branches forking from the same point should be independent operations.

## Implemented Solution

### Fork Point Detection

A commit is a **fork point** if it has multiple non-trunk children (spinoffs). Fork points are treated as **independent commits** that no single branch owns.

```typescript
export function isForkPoint(commit: Commit, trunkShas: Set<string>): boolean {
  const nonTrunkChildren = commit.childrenSha.filter((sha) => !trunkShas.has(sha))
  return nonTrunkChildren.length > 1
}
```

### Ownership Walk Stops at Fork Points

The `calculateCommitOwnership` function now stops at fork points:

```
trunk:  A ─ B ─ C
             │
             └─ D (fork point - independent)
                 ├─ E ─ F [feature-left]  owns: F, E
                 └─ G ─ H [feature-right] owns: H, G
```

**After this change:**
- `feature-left` ownership: F → E → stops at D (fork point). Owns: [F, E]
- `feature-right` ownership: H → G → stops at D (fork point). Owns: [H, G]
- Commit D is owned by neither branch - it's a stable waypoint

### Visual Distinction

Independent commits are rendered with muted styling (`stroke-muted-foreground/50`) to indicate they're not owned by any branch. This helps users understand the commit graph structure.

---

## Proposed Enhancement: Drag Independent Commits

### The Vision

Allow users to **drag independent commits directly** to move entire subtrees. When you drag a fork point, all branches that spinoff from it move together.

```
Before drag:
trunk:  A ─ B ─ C
             │
             └─ D (fork point)
                 ├─ E ─ F [feature-left]
                 └─ G ─ H [feature-right]

After dragging D onto new-base:
trunk:  A ─ B ─ C ─ new-base
                       │
                       └─ D' (rebased)
                           ├─ E' ─ F' [feature-left]
                           └─ G' ─ H' [feature-right]
```

### Why This Matters

1. **Intuitive subtree management**: Users can reorganize work by dragging the common ancestor
2. **Atomic operations**: All dependent branches move together, maintaining relationships
3. **Efficient rebasing**: Single operation instead of rebasing each branch individually
4. **Visual feedback**: The commit graph already shows the fork structure

### Implementation Approach

```typescript
interface DragTarget {
  type: 'branch' | 'independent-commit'
  sha: string
  // For independent commits, calculate all affected branches
  affectedBranches?: string[]
}

function handleDragIndependentCommit(
  forkPointSha: string,
  targetSha: string
): RebaseIntent {
  // Find all branches that spinoff from this fork point
  const spinoffBranches = findSpinoffBranches(forkPointSha)

  // Create a rebase intent that moves the fork point
  // and cascades to all spinoff branches
  return {
    type: 'subtree-rebase',
    forkPoint: forkPointSha,
    onto: targetSha,
    branches: spinoffBranches
  }
}
```

---

## Edge Cases and Considerations

### Edge Case 1: Nested Fork Points

Multiple levels of fork points in a single subtree.

```
trunk:  A ─ B
             │
             └─ C (fork point 1)
                 ├─ D (fork point 2)
                 │   ├─ E [branch-a]
                 │   └─ F [branch-b]
                 └─ G [branch-c]
```

**Considerations:**
- Dragging C moves the entire subtree (D, E, F, G)
- Dragging D moves only its subtree (E, F), leaving G in place
- UI should show the scope of the drag operation before confirming

### Edge Case 2: Three or More Spinoffs

Fork points can have any number of spinoffs (3+).

```
trunk:  A ─ B
             │
             └─ C (fork point - 3 spinoffs)
                 ├─ D [branch-a]
                 ├─ E [branch-b]
                 └─ F [branch-c]
```

**Considerations:**
- All three branches are independent
- Dragging C moves all three together
- Visual clarity becomes more important with more spinoffs

### Edge Case 3: Orphaned Ancestor Commits

When a branch has multiple commits before reaching the fork point.

```
trunk:  A ─ B
             │
             └─ C (fork point)
                 ├─ D ─ E ─ F [feature-left]  owns: F, E, D
                 └─ G [feature-right]         owns: G
```

**Considerations:**
- Commits D and E are owned by `feature-left`
- Rebasing `feature-left` moves D, E, F but NOT C
- C remains as a stable waypoint for `feature-right`

### Edge Case 4: Fork Point Becomes Non-Fork

When one spinoff branch is deleted or merged.

```
Before:
  └─ C (fork point)
      ├─ D [feature-left]
      └─ E [feature-right]

After deleting feature-right:
  └─ C (no longer a fork point)
      └─ D [feature-left]  now owns: D, C
```

**Considerations:**
- Ownership should recalculate when branch structure changes
- C transitions from independent to owned by `feature-left`
- Visual styling should update accordingly

### Edge Case 5: Deep Ancestry

Fork point far from any branch head.

```
trunk:  A ─ B
             │
             └─ C (fork point)
                 ├─ D ─ E ─ F ─ G ─ H [feature-left]
                 └─ I ─ J ─ K ─ L ─ M [feature-right]
```

**Considerations:**
- Ownership walk correctly stops at C for both branches
- Dragging C would rebase many commits - need confirmation
- Performance: ownership calculation is O(n) per branch

### Edge Case 6: Conflict During Subtree Rebase

What happens if rebasing the subtree encounters conflicts?

**Considerations:**
- Need to handle partial failures
- Options:
  1. Abort entire operation on first conflict
  2. Complete what's possible, report failures
  3. Interactive conflict resolution for each branch
- Recommendation: Abort on conflict, let user rebase branches individually

---

## UX Considerations

### Visual Feedback

1. **Hover preview**: When hovering over an independent commit, highlight all branches that would move
2. **Drag cursor**: Use a distinct cursor (e.g., `cursor-move`) for draggable independent commits
3. **Drop zones**: Clearly indicate valid drop targets during drag
4. **Scope indicator**: Show "Moving 3 branches" tooltip during drag

### Confirmation

For subtree rebases, show a confirmation dialog:
```
Move subtree?

This will rebase the following branches:
- feature-left (3 commits)
- feature-right (2 commits)

From: commit C (abc1234)
To: main (def5678)

[Cancel] [Move Subtree]
```

### Error States

1. **Conflict detected**: "Conflict in feature-left. The subtree move was cancelled. Try rebasing branches individually."
2. **Partial ownership**: "Some commits in this subtree are owned by other branches and won't move."
3. **Circular dependency**: "Cannot move subtree onto one of its own descendants."

### Accessibility

1. **Keyboard support**: Tab to independent commits, Enter to initiate move, arrow keys to select target
2. **Screen reader**: "Independent commit D with 2 spinoff branches: feature-left, feature-right"
3. **Color independence**: Use shape/pattern in addition to color for independent commits

---

## Architecture Decisions

### ADR-001: Fork Point Detection Location

**Decision:** Fork point detection in `CommitOwnership.ts` as shared utility.

**Rationale:**
- Single source of truth for ownership rules
- Used by both UI (visual styling) and operations (rebase)
- Easy to test in isolation

### ADR-002: Independence is Computed, Not Stored

**Decision:** `isIndependent` is computed at UI build time, not stored in commit data.

**Rationale:**
- Independence depends on current branch structure
- Changes when branches are created/deleted
- No stale state to manage
- Small computation cost (O(children count))

### ADR-003: Drag Feature as Separate Intent Type

**Decision:** Implement subtree drag as new `RebaseIntent` type.

**Rationale:**
- Distinct from single-branch rebase
- Clear scope in intent makes testing easier
- Can be rejected at validation if too complex
- Audit trail shows what user intended

---

## Implementation Status

### Completed
- [x] Fork point detection (`isForkPoint` utility)
- [x] Ownership walk stops at fork points
- [x] `isIndependent` flag on `UiCommit`
- [x] Visual styling for independent commits
- [x] Unit tests for fork point scenarios

### Proposed (Not Implemented)
- [ ] Drag handlers for independent commits
- [ ] Subtree rebase intent type
- [ ] Hover preview of affected branches
- [ ] Confirmation dialog for subtree moves
- [ ] Keyboard accessibility for subtree operations

---

## Related Ideas

- **#20 Branch Ownership Tracking**: Both deal with ownership concepts, but #20 tracks worktree-branch ownership while this tracks commit-branch ownership
- **Rebase Intent Builder**: The subtree rebase feature would extend the existing intent system

---

## Files Modified (Core Implementation)

| File | Changes |
|------|---------|
| `src/node/domain/CommitOwnership.ts` | Added `isForkPoint()`, fork point detection in ownership walk |
| `src/shared/types/ui.ts` | Added `isIndependent?: boolean` to `UiCommit` |
| `src/node/domain/UiStateBuilder.ts` | Uses `isForkPoint()` to set `isIndependent` |
| `src/web/components/SvgPaths.tsx` | Added 'independent' variant styling |
| `src/web/components/StackView.tsx` | Uses `isIndependent` for variant selection |
| `src/node/domain/__tests__/CommitOwnership.test.ts` | Tests for fork point scenarios |
