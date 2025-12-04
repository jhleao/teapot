# Fix: Remote Trunk Loading Strategy - Fill the Gap

## Problem

When local main is far behind origin/main (or vice versa), using fixed depth limits could create gaps in the commit history.

### Example Scenario

```
origin/main: commit 350 (HEAD)
local main: commit 200 (HEAD)
```

**Previous approach** (fixed depth for both):
- Local trunk: loads commits 200 → 1 (depth 200)
- Remote trunk: loads commits 350 → 151 (depth 200)

**Gap**: Commits 201-350 are NOT loaded! ❌

This means:
- Can't show relationship between `origin/main` and `main`
- Missing commits in the UI
- `origin/main` badge might not appear

## Solution: Load Until Known Commit

Instead of using a fixed depth for remote trunk, load commits **until we find a commit already in the map** from the local trunk load.

### New Loading Strategy

**Step 1**: Load local trunk with depth limit (200 commits)
```
Loads: commits 200 → 1
commitsMap: {200, 199, 198, ..., 2, 1}
```

**Step 1.5**: Load remote trunk **until we hit a known commit**
```
Start: commit 350 (origin/main HEAD)
Load: 350 → not in map, add it
Load: 349 → not in map, add it
...
Load: 201 → not in map, add it
Load: 200 → FOUND in map! Stop here.

Result: Loaded commits 350-201
commitsMap: {350, 349, ..., 201, 200, 199, ..., 1}
```

**Outcome**: No gaps! ✅

### Implementation

**File**: [src/node/core/utils/build-repo.ts:231-281](src/node/core/utils/build-repo.ts#L231-281)

```typescript
// Step 1: Load local trunk with depth limit
const trunkBranch = branches.find((b) => b.ref === trunkBranchName && !b.isRemote)
const remoteTrunkBranch = branches.find((b) => b.isTrunk && b.isRemote)

if (trunkBranch?.headSha) {
  const trunkDescriptor = branchDescriptors.find((d) => d.ref === trunkBranch.ref)
  if (trunkDescriptor) {
    await collectCommitsForRef(dir, trunkDescriptor.fullRef, commitsMap, {
      depth: trunkDepth,  // 200 commits
      maxCommits: maxCommitsPerBranch
    })
  }
}

// Step 1.5: Load remote trunk commits until we find a known commit
// This fills the gap between local and remote trunk
if (remoteTrunkBranch?.headSha) {
  const remoteTrunkDescriptor = branchDescriptors.find((d) => d.ref === remoteTrunkBranch.ref)
  if (remoteTrunkDescriptor) {
    await collectCommitsUntilKnown(dir, remoteTrunkDescriptor.fullRef, commitsMap, {
      maxCommits: maxCommitsPerBranch  // Safety limit (1000)
    })
  }
}

// Step 2: Load feature branches completely
for (const branch of branches) {
  if (branch.isTrunk) {
    continue  // Skip both local and remote trunk
  }
  // Load feature branch...
}
```

### New Helper Function: `collectCommitsUntilKnown`

**File**: [src/node/core/utils/build-repo.ts:298-354](src/node/core/utils/build-repo.ts#L298-L354)

```typescript
/**
 * Loads commits from a ref until we find a commit already in the map.
 * This is used for remote trunk to fill the gap between local and remote.
 */
async function collectCommitsUntilKnown(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: {
    maxCommits?: number
  } = {}
): Promise<void> {
  const { maxCommits = 1000 } = options

  try {
    const logEntries = await git.log({
      fs,
      dir,
      ref
    })

    let processedCount = 0
    for (const entry of logEntries) {
      if (processedCount >= maxCommits) {
        break  // Safety limit
      }

      const sha = entry.oid

      // If we've already seen this commit, stop loading
      // This means we've reached the point where histories merge
      if (commitsMap.has(sha)) {
        break  // ← Key logic: stop when we find a known commit
      }

      const commit = ensureCommit(commitsMap, sha)
      commit.message = entry.commit.message.trim()
      commit.timeMs = (entry.commit.author?.timestamp ?? 0) * 1000
      // ... parent/child relationships

      processedCount++
    }
  } catch {
    // Ignore branches we cannot traverse
  }
}
```

## How It Works in Different Scenarios

### Scenario 1: Remote Ahead by 150 Commits

```
origin/main: commit 350
local main: commit 200
```

**Load sequence**:
1. Load local trunk (200 commits): 200 → 1
2. Load remote trunk until known:
   - Start at 350
   - Walk backwards: 350, 349, 348, ..., 201
   - Hit commit 200 (already in map) → STOP

**Result**: Commits 1-350 loaded (no gap)

### Scenario 2: Local Ahead by 50 Commits

```
local main: commit 250
origin/main: commit 200
```

**Load sequence**:
1. Load local trunk (200 commits): 250 → 51
2. Load remote trunk until known:
   - Start at 200
   - Already in map! → STOP immediately

**Result**: Commits 51-250 loaded (no gap)

### Scenario 3: Remote Ahead by 500 Commits

```
origin/main: commit 700
local main: commit 200
```

**Load sequence**:
1. Load local trunk (200 commits): 200 → 1
2. Load remote trunk until known:
   - Start at 700
   - Walk backwards: 700, 699, ..., 201
   - Hit commit 200 → STOP
   - Total loaded: 500 commits (201-700)

**Safety**: Still capped at `maxCommits: 1000`

**Result**: Commits 1-700 loaded (no gap)

### Scenario 4: Diverged Histories (Rare)

If local and remote have diverged (force push, rebase), the function will load up to 1000 commits before stopping (safety limit).

## Performance Characteristics

### Best Case: Remote and Local in Sync
- Remote trunk load: 0 commits (immediately finds local main)
- **Cost**: O(1)

### Typical Case: Remote Ahead by 10-50 Commits
- Local trunk: 200 commits
- Remote trunk: 10-50 commits (until merge point)
- **Total**: 210-250 commits
- **Cost**: Minimal overhead

### Worst Case: Remote Ahead by 1000+ Commits
- Local trunk: 200 commits
- Remote trunk: Up to 1000 commits (safety limit)
- **Total**: Up to 1200 commits
- **Cost**: Still reasonable, prevents unbounded loading

## Benefits

✅ **No gaps**: Always captures full range between local and remote trunk
✅ **Efficient**: Stops as soon as histories merge
✅ **Safe**: Capped at 1000 commits (safety limit)
✅ **Smart**: Adapts to actual gap size (not fixed depth)
✅ **Correct badges**: `origin/main` badge always appears

## Edge Cases Handled

### 1. Remote Behind Local
Remote trunk load finds local main immediately → 0 additional commits

### 2. Remote and Local in Sync
Both point to same commit → 0 additional commits

### 3. Shallow Clone
`git.log()` may fail → caught and ignored gracefully

### 4. No Remote Trunk
`remoteTrunkBranch` is null → Step 1.5 skipped entirely

### 5. Very Large Gap (> 1000 commits)
Safety limit kicks in → loads first 1000 commits from remote trunk

## Testing

### Test 1: Remote Ahead

```bash
# In local repo
git reset --hard origin/main~150

# Open app
# Expected: All commits from local main to origin/main are shown
# origin/main badge appears 150 commits ahead
```

### Test 2: Local Ahead

```bash
# Create 50 local commits
for i in {1..50}; do git commit --allow-empty -m "local $i"; done

# Open app
# Expected: All commits shown, main badge 50 commits ahead of origin/main
```

### Test 3: In Sync

```bash
git pull origin main

# Open app
# Expected: Both badges on same commit
```

## Summary

**What**: Smart remote trunk loading that fills the gap between local and remote

**Where**: [src/node/core/utils/build-repo.ts](src/node/core/utils/build-repo.ts)

**How**: Load commits from remote trunk until we find one already loaded from local trunk

**Why**: Ensures complete commit history between local and remote trunk, no matter the gap

**Performance**:
- Best case: O(1) (in sync)
- Typical case: O(gap size)
- Worst case: O(1000) (safety limit)

**Status**: ✅ Implemented and built successfully
