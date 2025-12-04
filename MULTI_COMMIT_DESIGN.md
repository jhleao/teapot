# Multi-Commit Branch Design for Stacked Diff Workflow

## Current State Analysis

### How the App Currently Works

Looking at [build-ui-state.ts:181-195](src/node/core/utils/build-ui-state.ts#L181-L195) and [build-ui-state.ts:214-264](src/node/core/utils/build-ui-state.ts#L214-L264):

**Current Behavior:**
```typescript
// Trunk: Loads ENTIRE lineage from HEAD to root
collectBranchLineage(branch.headSha)
  → Traverses ALL parents until no more commits

// Feature branches: Loads commits until hitting trunk
buildNonTrunkUiStack(startSha)
  → Keeps adding commits until reaching a commit already in trunk
  → Each commit in the stack is displayed
```

**The app ALREADY handles multi-commit branches!**

Each `UiStack` contains an array of `UiCommit[]`. The UI displays:
- **Trunk**: All commits from HEAD back to root (or as far as loaded)
- **Feature stacks**: All commits from branch tip until merge-base with parent stack

### The Real Problem

The issue is NOT that the app can't handle multiple commits per branch. The issue is:

1. **Performance**: Loading entire trunk history (potentially thousands of commits)
2. **Memory**: Storing all commits even if they're not relevant to active work
3. **Crashes**: In large repos, this becomes unbounded

---

## Design Decision: What to Display vs. What to Load

### Key Insight: Separation of Concerns

```
┌─────────────────────────────────────────────────────────┐
│  LOADING STRATEGY (Git Layer)                          │
│  - How much history to fetch from git                  │
│  - Performance optimization                             │
│  - Prevents crashes                                     │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  DISPLAY STRATEGY (UI Layer)                           │
│  - What to show in the tree                            │
│  - User experience                                      │
│  - Stacked diff workflow clarity                       │
└─────────────────────────────────────────────────────────┘
```

These are **separate decisions** that should be configurable independently.

---

## Recommended Approach: Smart Loading with Full Display

### Strategy 1: Trunk Depth Limiting (Performance)
**Load trunk with bounded depth, display everything loaded**

```typescript
// In build-repo.ts
async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: {
    depth?: number
    isTrunk?: boolean
  } = {}
): Promise<void> {
  const { depth, isTrunk } = options

  // Trunk: Load reasonable depth (100-500 commits)
  // Feature branches: Load until merge-base (unbounded, but typically small)
  const effectiveDepth = isTrunk ? (depth ?? 100) : undefined

  const logEntries = await git.log({
    fs,
    dir,
    ref,
    depth: effectiveDepth
  })

  // ... process entries
}
```

**Rationale:**
- **Trunk typically has 100s-1000s of commits** → limit to recent history
- **Feature branches typically have 1-10 commits** → load completely
- Prevents crashes while keeping feature branches fully visible

### Strategy 2: Merge-Base Range Loading (Precision)
**Load only commits relevant to active stacks**

```typescript
async function collectCommitsForFeatureBranch(
  dir: string,
  branch: Branch,
  trunkBranch: Branch,
  commitsMap: Map<string, Commit>
): Promise<void> {
  // Find where this branch diverged from trunk
  const mergeBase = await git.findMergeBase({
    fs,
    dir,
    oids: [branch.headSha, trunkBranch.headSha]
  })

  // Load only commits from divergence point to branch tip
  await collectCommitsInRange(
    dir,
    mergeBase,  // Start (exclusive)
    branch.headSha,  // End (inclusive)
    commitsMap
  )
}
```

**Benefits:**
- Each feature branch loads only its delta commits
- Trunk loads once with depth limit
- Memory proportional to active work, not repo age

---

## Visual Representation

### Scenario: Large Repo with Multi-Commit Branches

```
main (trunk) - 5000 commits total
├─ [commit 1]
├─ [commit 2]
├─ ... (4800 commits)
├─ [commit 4900] ← Load starts here (depth=100)
├─ [commit 4901]
├─ ...
├─ [commit 4998]
├─ [commit 4999] ← merge-base for feature-A
│   └─ feature-A (3 commits)
│       ├─ [commit A1] "Add login form"
│       ├─ [commit A2] "Add validation"
│       └─ [commit A3] "Add tests" ← branch tip
├─ [commit 5000] ← trunk HEAD
    └─ feature-B (7 commits)
        ├─ [commit B1] "Refactor API"
        ├─ [commit B2] "Add caching"
        ├─ ... (5 more commits)
        └─ [commit B7] "Update docs" ← branch tip
```

**What to Load:**
```typescript
Trunk:        Commits 4900-5000  (100 commits)
Feature-A:    Commits A1-A3       (3 commits)
Feature-B:    Commits B1-B7       (7 commits)
─────────────────────────────────────────────
Total:        110 commits loaded  ✅
Not:          4899 commits         ❌ (skipped ancient history)
```

**What to Display:**
- ✅ All 100 trunk commits (fully navigable)
- ✅ All 3 feature-A commits (complete changeset)
- ✅ All 7 feature-B commits (complete changeset)
- ✅ Spinoffs from each trunk commit where branches diverged

---

## Implementation: Modified Architecture

### Phase 1: Depth-Limited Trunk + Full Feature Branches

#### Change 1: Update `buildRepoModel()` signature
**File**: [build-repo.ts:13-37](src/node/core/utils/build-repo.ts#L13-L37)

```typescript
export type BuildRepoOptions = {
  /** Max commits to load for trunk branch. Default: 100 */
  trunkDepth?: number
  /** Load remote branches. Default: false */
  loadRemotes?: boolean
  /** Max commits for any single branch. Safety limit. Default: 1000 */
  maxCommitsPerBranch?: number
}

export async function buildRepoModel(
  config: Configuration,
  options: BuildRepoOptions = {}
): Promise<Repo> {
  const {
    trunkDepth = 100,
    loadRemotes = false,
    maxCommitsPerBranch = 1000
  } = options

  const dir = config.repoPath
  const localBranches = await git.listBranches({ fs, dir })
  const branchDescriptors = await collectBranchDescriptors(
    dir,
    localBranches,
    { includeRemotes: loadRemotes }
  )
  const branchNameSet = new Set<string>(localBranches)
  branchDescriptors.forEach((descriptor) => {
    branchNameSet.add(getBranchName(descriptor))
  })

  const trunkBranch = await getTrunkBranchRef(config, Array.from(branchNameSet))
  const branches = await buildBranchesFromDescriptors(dir, branchDescriptors, trunkBranch)

  // KEY CHANGE: Pass options to commit collection
  const commits = await collectCommitsFromDescriptors(
    dir,
    branchDescriptors,
    branches,
    trunkBranch,
    { trunkDepth, maxCommitsPerBranch }
  )

  const workingTreeStatus = await collectWorkingTreeStatus(dir, branchDescriptors)

  return {
    path: dir,
    commits,
    branches,
    workingTreeStatus
  }
}
```

#### Change 2: Smart Commit Collection
**File**: [build-repo.ts:105-126](src/node/core/utils/build-repo.ts#L105-L126)

```typescript
async function collectCommitsFromDescriptors(
  dir: string,
  branchDescriptors: BranchDescriptor[],
  branches: Branch[],
  trunkBranchName: string | null,
  options: {
    trunkDepth: number
    maxCommitsPerBranch: number
  }
): Promise<Commit[]> {
  const commitsMap = new Map<string, Commit>()
  const { trunkDepth, maxCommitsPerBranch } = options

  // Step 1: Load trunk first with depth limit
  const trunkBranch = branches.find(
    (b) => b.ref === trunkBranchName && !b.isRemote
  )

  if (trunkBranch?.headSha) {
    await collectCommitsForRef(
      dir,
      `refs/heads/${trunkBranch.ref}`,
      commitsMap,
      {
        depth: trunkDepth,
        maxCommits: maxCommitsPerBranch
      }
    )
  }

  // Step 2: Load feature branches (without depth limit, they're typically small)
  for (let i = 0; i < branchDescriptors.length; i += 1) {
    const descriptor = branchDescriptors[i]
    if (!descriptor) continue

    const branch = branches[i]
    if (!branch?.headSha) continue

    // Skip trunk (already loaded)
    if (branch.isTrunk && !branch.isRemote) continue

    // Skip remote branches if they're just tracking locals
    if (branch.isRemote && hasMatchingLocal(branch, branches)) continue

    // Load feature branch commits
    await collectCommitsForRef(
      dir,
      descriptor.fullRef,
      commitsMap,
      {
        depth: undefined,  // No depth limit for feature branches
        maxCommits: maxCommitsPerBranch  // Safety limit
      }
    )
  }

  return Array.from(commitsMap.values()).sort((a, b) => b.timeMs - a.timeMs)
}

function hasMatchingLocal(remoteBranch: Branch, branches: Branch[]): boolean {
  // Check if there's a local branch with the same name
  const normalizedName = remoteBranch.ref.split('/').pop()
  return branches.some(
    (b) => !b.isRemote && b.ref === normalizedName && b.headSha === remoteBranch.headSha
  )
}
```

#### Change 3: Update `collectCommitsForRef()`
**File**: [build-repo.ts:140-171](src/node/core/utils/build-repo.ts#L140-L171)

```typescript
async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: {
    depth?: number
    maxCommits?: number
  } = {}
): Promise<void> {
  const { depth, maxCommits = 1000 } = options

  try {
    const logEntries = await git.log({
      fs,
      dir,
      ref,
      ...(depth !== undefined && { depth })  // Only pass if defined
    })

    // Safety: Cap at maxCommits even if git.log returns more
    const entriesToProcess = logEntries.slice(0, maxCommits)

    for (const entry of entriesToProcess) {
      const sha = entry.oid

      // Skip if already processed (happens when branches share history)
      if (commitsMap.has(sha)) {
        // Still update parent-child relationships
        updateParentChildRelationships(commitsMap, entry)
        continue
      }

      const commit = ensureCommit(commitsMap, sha)
      commit.message = entry.commit.message.trim()
      commit.timeMs = (entry.commit.author?.timestamp ?? 0) * 1000

      const parentSha = entry.commit.parent?.[0] ?? ''
      commit.parentSha = parentSha

      if (parentSha) {
        const parentCommit = ensureCommit(commitsMap, parentSha)
        if (!parentCommit.childrenSha.includes(sha)) {
          parentCommit.childrenSha.push(sha)
        }
      }
    }
  } catch {
    // Ignore branches we cannot traverse
  }
}

function updateParentChildRelationships(
  commitsMap: Map<string, Commit>,
  entry: any
): void {
  const sha = entry.oid
  const parentSha = entry.commit.parent?.[0]

  if (parentSha && commitsMap.has(parentSha)) {
    const parentCommit = commitsMap.get(parentSha)!
    if (!parentCommit.childrenSha.includes(sha)) {
      parentCommit.childrenSha.push(sha)
    }
  }
}
```

---

## UI Behavior: Display Everything Loaded

### Current UI Code (No Changes Needed!)

The existing [build-ui-state.ts](src/node/core/utils/build-ui-state.ts) already:
- Displays all commits in `UiStack.commits[]`
- Shows all commits until hitting a parent already in another stack
- Supports multiple commits per branch through the while loop in `buildNonTrunkUiStack()`

**The UI naturally adapts** - if you load:
- 1 commit per branch → displays 1 commit per stack item
- 5 commits per branch → displays 5 commits per stack item
- 100 trunk commits → displays 100 trunk commits

### Optional: Visual Indicator for Truncated History

Add to `UiStack` type in [types/ui.ts:11-14](src/shared/types/ui.ts#L11-L14):

```typescript
export type UiStack = {
  commits: UiCommit[]
  isTrunk: boolean
  /** True if history was truncated (more commits exist but weren't loaded) */
  isTruncated?: boolean
  /** SHA of oldest loaded commit (boundary) */
  oldestLoadedSha?: string
}
```

Display in UI:
```
┌────────────────────────────┐
│ main (trunk)               │
├────────────────────────────┤
│ ⋯ (4899 older commits)     │  ← Shows when isTruncated=true
├────────────────────────────┤
│ [commit 4900]              │
│ [commit 4901]              │
│ ...                        │
│ [commit 5000] ← HEAD       │
└────────────────────────────┘
```

---

## Advanced: On-Demand History Extension

### User Action: "Load More History"

When user scrolls to oldest commit or clicks "Show more":

```typescript
// New IPC handler
const extendHistory: IpcHandlerOf<'extendHistory'> = async (
  _event,
  { repoPath, fromSha, additionalDepth }
) => {
  const config: Configuration = { repoPath }

  // Load more commits starting from the boundary
  const moreCommits = await loadAdditionalCommits(
    repoPath,
    fromSha,
    additionalDepth ?? 100
  )

  // Merge with existing data
  const repo = await buildRepoModel(config, { trunkDepth: 100 })
  repo.commits.push(...moreCommits)

  return buildUiStack(repo)
}

async function loadAdditionalCommits(
  dir: string,
  fromSha: string,
  depth: number
): Promise<Commit[]> {
  const commitsMap = new Map<string, Commit>()

  // Start from parent of fromSha
  const fromCommit = await git.readCommit({ fs, dir, oid: fromSha })
  const startSha = fromCommit.commit.parent?.[0]

  if (!startSha) return []

  // Load next batch
  const entries = await git.log({
    fs,
    dir,
    ref: startSha,
    depth
  })

  // Convert to Commit objects
  return processLogEntries(entries)
}
```

---

## Configuration Strategy

### Default Configuration (Safe for All Repos)
```typescript
const DEFAULT_OPTIONS: BuildRepoOptions = {
  trunkDepth: 100,          // Recent 100 trunk commits
  loadRemotes: false,        // Local only
  maxCommitsPerBranch: 1000  // Safety cap
}
```

### Power User Configuration
```typescript
const POWER_USER_OPTIONS: BuildRepoOptions = {
  trunkDepth: 500,           // More trunk history
  loadRemotes: true,         // Show remote branches
  maxCommitsPerBranch: 5000  // Higher safety cap
}
```

### Small Repo Optimization
```typescript
const SMALL_REPO_OPTIONS: BuildRepoOptions = {
  trunkDepth: undefined,     // Load all (if < 1000 commits)
  loadRemotes: true,
  maxCommitsPerBranch: 10000
}
```

**Auto-Detection:**
```typescript
async function detectRepoSize(dir: string): Promise<'small' | 'medium' | 'large'> {
  const branches = await git.listBranches({ fs, dir })
  const mainBranch = branches.find(b => b === 'main' || b === 'master') || branches[0]

  if (!mainBranch) return 'small'

  // Quick commit count check
  const sample = await git.log({ fs, dir, ref: mainBranch, depth: 1000 })

  if (sample.length < 1000) return 'small'   // < 1K commits
  if (sample.length < 1000) return 'medium'  // Hit depth limit, likely < 5K
  return 'large'                              // Hit depth limit, likely 5K+
}

// Use auto-detected size
const options = await getOptionsForRepoSize(
  await detectRepoSize(repoPath)
)
```

---

## Summary: Recommended Behavior

### 1. **Load Strategy**
```
✅ Trunk:           Load recent 100-500 commits (configurable)
✅ Feature branches: Load ALL commits (typically 1-20)
✅ Remote branches:  Skip by default, load on-demand
✅ Safety cap:       1000 commits per branch maximum
```

### 2. **Display Strategy**
```
✅ Show ALL loaded commits in the tree
✅ Each stack item displays all its commits
✅ Trunk shows depth-limited history
✅ Feature stacks show complete changesets
✅ Optional "load more" for trunk history
```

### 3. **Why This Works**
- **Prevents crashes**: Bounded trunk history
- **Full feature visibility**: All commits in active stacks visible
- **Stacked diff friendly**: Each stack shows complete context
- **Performance**: Loads 100-200 commits instead of 10,000+
- **Memory efficient**: ~10MB instead of ~500MB

### 4. **Code Changes Required**
- ✏️ [build-repo.ts:13](src/node/core/utils/build-repo.ts#L13): Add `BuildRepoOptions` parameter
- ✏️ [build-repo.ts:105](src/node/core/utils/build-repo.ts#L105): Update `collectCommitsFromDescriptors()` signature
- ✏️ [build-repo.ts:140](src/node/core/utils/build-repo.ts#L140): Add `depth` parameter to `collectCommitsForRef()`
- ✏️ [repo.ts:35](src/node/handlers/repo.ts#L35): Pass options to `buildRepoModel()`
- ➕ [types/ui.ts:11](src/shared/types/ui.ts#L11): Add `isTruncated` flag (optional)
- ✅ [build-ui-state.ts](src/node/core/utils/build-ui-state.ts): No changes needed!

---

## Migration Path

### Phase 1: Add Depth Limiting (Week 1)
- Add `depth` parameter to `collectCommitsForRef()`
- Default trunk depth to 100
- Test with large repos

### Phase 2: Smart Branch Loading (Week 2)
- Separate trunk vs. feature branch loading
- Skip redundant remote branches
- Add safety caps

### Phase 3: UI Indicators (Week 3)
- Add "truncated" flag to UiStack
- Show "load more" button in UI
- Implement `extendHistory` handler

### Phase 4: Auto-Configuration (Week 4)
- Detect repo size
- Adjust defaults automatically
- Add user settings

---

## Testing Scenarios

### Test 1: Single-Commit Branches (Current Workflow)
```
main: 100 commits
├─ feature-1: 1 commit
└─ feature-2: 1 commit

Expected: All commits visible, fast load
```

### Test 2: Multi-Commit Branches
```
main: 100 commits
├─ feature-A: 5 commits (refactoring)
└─ feature-B: 10 commits (big feature)

Expected: All feature commits visible, trunk limited to 100
```

### Test 3: Large Repo
```
main: 5000 commits (limited to 100)
├─ feature-1: 3 commits
├─ feature-2: 7 commits
└─ 50 other local branches

Expected: Loads in < 2s, doesn't crash, all features visible
```

### Test 4: Ancient Branch
```
main: 5000 commits
└─ ancient-feature: branched 2000 commits ago, has 5 commits

Expected:
- Trunk shows recent 100
- ancient-feature shows all 5 commits
- Merge-base might not be visible (that's OK)
- Operations still work (git finds merge-base internally)
```

---

## Key Insight: Trust Git, Limit Display

**Philosophy:**
- Load what you **display** with limits
- Trust Git to **calculate** merge-bases internally (it's fast)
- Operations like rebase work even if merge-base isn't in loaded commits

**Example:**
```typescript
// This still works even if merge-base isn't in repo.commits[]
await git.merge({
  fs,
  dir,
  ours: 'feature-branch',
  theirs: 'main'
})
// Git internally finds merge-base, we don't need it in memory
```

---

## Conclusion: Best Approach

✅ **Load trunk with depth limit (100-500 commits)**
✅ **Load feature branches completely (unbounded, they're small)**
✅ **Display everything loaded**
✅ **Add "load more" for trunk history expansion**
✅ **No changes to UI rendering logic**

This approach:
- Prevents crashes by limiting trunk
- Shows complete feature changesets
- Maintains stacked diff workflow
- Keeps code simple
- Scales to any repo size

The **one commit per branch assumption** was never in the code - it already handles multiple commits. The real issue is **unbounded trunk loading**, which this design fixes.
