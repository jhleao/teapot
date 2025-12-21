# Issue: origin/main Shown Ahead of local main After Rebasing on Remote

## Observed Behavior

After rebasing feature branches onto `origin/main`:

- The visualization shows `origin/main` at the top of trunk
- Local `main` appears lower in the stack (behind origin/main)
- Feature branches correctly appear as spinoffs from `origin/main`
- But visually it looks like `main` is "behind" even though the workflow is correct

## Context: The Stacked Diff Workflow

In Teapot's stacked diff workflow:

1. User works on feature branches stacked on trunk
2. User rebases features onto latest `origin/main` (after fetching)
3. User's local `main` may not be updated yet
4. This is a **valid intermediate state** - local main catches up later

## Root Cause Analysis

### The Code Path

In `build-ui-state.ts`, `buildTrunkUiStack()` handles trunk visualization:

```typescript
function buildTrunkUiStack(
  branch: Branch, // local trunk (main)
  state: BuildState,
  remoteTrunk?: Branch // origin/main
): TrunkBuildResult | null {
  const localLineage = collectBranchLineage(branch.headSha, state.commitMap)

  if (remoteTrunk?.headSha && remoteTrunk.headSha !== branch.headSha) {
    const remoteLineage = collectBranchLineage(remoteTrunk.headSha, state.commitMap)
    const localSet = new Set(localLineage)
    const remoteSet = new Set(remoteLineage)

    const remoteIsAhead = remoteSet.has(branch.headSha)
    const localIsAhead = localSet.has(remoteTrunk.headSha)

    if (remoteIsAhead && !localIsAhead) {
      // Remote is strictly ahead - use remote lineage only
      // This happens after Ship it: origin/main moved forward, local main is behind
      lineage = remoteLineage // ← LOCAL LINEAGE DROPPED
    } else if (localIsAhead && !remoteIsAhead) {
      lineage = localLineage
    } else {
      // Diverged or same - merge both
      lineage = mergedLineage
    }
  }
}
```

### The Problem

When `remoteIsAhead && !localIsAhead`:

- Code uses **only remote lineage**
- Local `main`'s commit isn't in this lineage
- `main` badge gets placed on its commit, but that commit appears "orphaned" from the main trunk line

### Why Was This Logic Added?

The comment says: "This happens after Ship it: origin/main moved forward, local main is behind"

The "Ship It" feature merges a PR and the remote moves forward. After ship-it:

- `origin/main` points to the merge commit
- Local `main` points to the pre-merge commit
- The old commit is now "orphaned" - it's not in the new trunk lineage

**The intent**: Don't show orphaned commits that are no longer relevant.

**The unintended consequence**: In the "rebase on remote before pulling" workflow, the same condition triggers, but local `main` isn't orphaned - it's just not caught up yet.

## Is This a Bug or Desired Behavior?

**It's a bug in the heuristic.** The code tries to distinguish two scenarios:

| Scenario               | Local main                | Origin/main             | Desired visualization                |
| ---------------------- | ------------------------- | ----------------------- | ------------------------------------ |
| After Ship It          | Points to orphaned commit | Moved forward via merge | Show only remote lineage (correct)   |
| After rebase on remote | Behind but valid          | Ahead                   | Show both, with main at its position |

The current heuristic treats both scenarios the same, but they have different visualization needs.

## Proposed Solutions

### Option 1: Always Merge Lineages (Simple)

**Rationale**: Trunk is a concept representing shared history. Both local and remote are part of it.

```typescript
// In buildTrunkUiStack()
if (remoteTrunk?.headSha && remoteTrunk.headSha !== branch.headSha) {
  const remoteLineage = collectBranchLineage(remoteTrunk.headSha, state.commitMap)

  // Always merge both lineages, regardless of ahead/behind status
  const allShas = new Set([...localLineage, ...remoteLineage])
  lineage = Array.from(allShas).sort((a, b) => {
    const commitA = state.commitMap.get(a)
    const commitB = state.commitMap.get(b)
    if (!commitA || !commitB) return 0
    return (commitA.timeMs ?? 0) - (commitB.timeMs ?? 0)
  })
}
```

**Pros**:

- Simple, predictable behavior
- Both `main` and `origin/main` badges appear at correct positions
- Works for all ahead/behind/diverged scenarios

**Cons**:

- After Ship It, may show "orphaned" commits that are no longer relevant
- Could clutter the view with old history

**Verdict**: Good default, but may need the declutter logic to clean up post-ship-it state.

---

### Option 2: Detect "Orphaned" vs "Behind" (Smarter Heuristic)

**Rationale**: Distinguish between genuinely orphaned commits (post-merge) and simply behind (pre-pull).

A commit is "orphaned" if:

1. It's not reachable from remote trunk, AND
2. Remote trunk has moved forward via a merge (not just new commits)

```typescript
if (remoteIsAhead && !localIsAhead) {
  // Check if local head is an ancestor of any commit in remote lineage
  // If yes: local is just "behind" - include it
  // If no: local is "orphaned" (diverged history) - exclude it

  const localHeadInRemoteHistory = remoteLineage.includes(branch.headSha)

  if (localHeadInRemoteHistory) {
    // Local is behind but on the same line - merge lineages
    lineage = mergedLineage
  } else {
    // Local is truly orphaned - use remote only
    lineage = remoteLineage
  }
}
```

Wait, this is actually what `remoteIsAhead` already checks (`remoteSet.has(branch.headSha)`). Let me re-examine...

Actually, `remoteIsAhead = remoteSet.has(branch.headSha)` means "local head is IN remote lineage" - which means local is an ancestor of remote. So when `remoteIsAhead` is true, local IS in the remote lineage.

**Re-reading the code**: The issue is that even though local head is in remote lineage, we're using `lineage = remoteLineage` which should include local's commit. The problem might be in how branches are annotated, not in lineage building.

Let me trace through:

1. `remoteLineage` = [oldest, ..., localHead, ..., remoteHead]
2. `lineage = remoteLineage` includes local head
3. `main` badge should appear on local head's UiCommit

**Hypothesis**: The issue might be in `trimTrunkCommits()` or branch annotation ordering.

---

### Option 3: Review `trimTrunkCommits` Interaction

The `trimTrunkCommits` function removes "useless" history:

```typescript
function trimTrunkCommits(trunkStack: UiStack): void {
  // Find oldest commit with spinoffs or branches
  for (let i = 0; i < trunkStack.commits.length; i++) {
    const commit = trunkStack.commits[i]
    const hasSpinoffs = commit.spinoffs.length > 0
    const hasBranches = commit.branches.length > 0

    if (hasSpinoffs || hasBranches) {
      deepestUsefulIndex = i
      break
    }
  }
  // Trim commits below this point
  trunkStack.commits = trunkStack.commits.slice(deepestUsefulIndex)
}
```

If `main` badge is on a commit that:

1. Has no spinoffs
2. Is below (older than) commits with spinoffs

Then it might get trimmed! This could explain the visual issue.

**Fix**: Ensure `main` branch annotation happens BEFORE trimming, and trimming respects branch-annotated commits.

---

### Option 4: Add Visual Distinction for "Behind" State

**Rationale**: The current behavior might be intentional, but the UI doesn't communicate it well.

Add a visual indicator when local trunk is behind remote:

- Show `main` badge with a "behind" indicator (↓ icon, different color)
- Tooltip: "Local main is X commits behind origin/main"
- Clear call-to-action: "Pull to sync"

```typescript
// In UiBranch type
interface UiBranch {
  name: string
  isCurrent: boolean
  isBehindRemote?: boolean // New field
  commitsBehind?: number // New field
  // ...
}
```

**Pros**:

- Communicates state clearly without changing logic
- Teaches users about the sync state

**Cons**:

- Adds UI complexity
- Doesn't fix the underlying lineage issue

---

## Deeper Investigation Needed

Before implementing a fix, we should verify:

1. **Is the lineage actually wrong?** Add logging to confirm what `lineage` contains
2. **Is trimming the culprit?** Check if `main`'s commit survives trimming
3. **Is annotation ordering the issue?** Remote branches annotate after local - could there be a conflict?

### Debug Steps

```typescript
// Add to buildTrunkUiStack
console.log('Local lineage:', localLineage)
console.log('Remote lineage:', remoteLineage)
console.log('Final lineage:', lineage)
console.log('Local head in final:', lineage.includes(branch.headSha))
```

```typescript
// Add to trimTrunkCommits
console.log(
  'Before trim:',
  trunkStack.commits.map((c) => c.sha)
)
console.log(
  'After trim:',
  trunkStack.commits.map((c) => c.sha)
)
```

## Recommendation

1. **First**: Add debug logging to understand exactly what's happening
2. **Then**: Based on findings, likely implement **Option 1** (always merge lineages) as the safe default
3. **Finally**: Adjust `trimTrunkCommits` to never trim commits with branch annotations

The key insight is that **trunk visualization should show the union of local and remote history**, with clear visual distinction for where each branch pointer sits. The "Ship It cleanup" optimization should be handled by declutter logic that's aware of merged PR state, not by lineage selection.

## Test Cases

1. Local main == origin/main → single trunk line, both badges on same commit
2. Local main behind origin/main (rebased on remote) → trunk extends to origin/main, both badges visible at correct positions
3. After Ship It (PR merged) → old local main commit should be trimmed if no other branches point to it
4. Diverged history → both lineages shown, clear visual indication of divergence
