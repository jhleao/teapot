# Large Repository Optimization Plan

## Problem Analysis

Currently, the application crashes when opening large repositories due to:

1. **Full History Loading**: In [build-repo.ts:140-150](src/node/core/utils/build-repo.ts#L140-L150), `git.log()` fetches the **entire commit history** for every branch without any depth limit
2. **All Remote Branches**: Lines 58-79 fetch **all remote branches** from all remotes, then traverse their full histories
3. **Memory Explosion**: For repos with thousands of commits and dozens of remote branches, this creates a massive `Commit[]` array
4. **O(n*m) Complexity**: n branches × m commits per branch = exponential memory/time

### Current Flow
```
buildRepoModel()
  ↓
collectBranchDescriptors() → Lists ALL local + remote branches
  ↓
collectCommitsFromDescriptors() → For EACH branch:
  ↓
collectCommitsForRef() → git.log() with NO DEPTH LIMIT
  ↓
Result: Full history × all branches loaded into memory
```

---

## Optimization Strategy: Lazy Loading Architecture

### Phase 1: Local-Only Initial Load (Quick Win)
**Goal**: Reduce initial load time by 80-90% for large repos

#### 1.1 Skip Remote Branches on Initial Load
**File**: [build-repo.ts:39-82](src/node/core/utils/build-repo.ts#L39-L82)

**Changes**:
- Add `skipRemotes?: boolean` parameter to `buildRepoModel()` and `collectBranchDescriptors()`
- Default to `skipRemotes: true` for initial load
- Only fetch local branches + trunk's remote tracking branch (if exists)

**Rationale**:
- Stacked diff workflows primarily work with local branches
- Remote branches are mainly for awareness, not primary operations
- Most users work with 5-15 local branches vs. 50-200+ remote branches

#### 1.2 Depth-Limited Commit History
**File**: [build-repo.ts:140-150](src/node/core/utils/build-repo.ts#L140-L150)

**Changes**:
```typescript
async function collectCommitsForRef(
  dir: string,
  ref: string,
  commitsMap: Map<string, Commit>,
  options: { depth?: number } = {}
): Promise<void> {
  const { depth = 100 } = options // Default to recent 100 commits

  try {
    const logEntries = await git.log({
      fs,
      dir,
      ref,
      depth // Add depth parameter to isomorphic-git call
    })
    // ... rest of logic
  }
}
```

**Rationale**:
- Stacked diffs are typically 2-10 commits per stack item
- Most work happens within the last 100-200 commits
- Older history can be loaded on-demand if needed

---

### Phase 2: Smart Depth Calculation
**Goal**: Load just enough history to build the UI properly

#### 2.1 Calculate Required Depth from Trunk
**New Function**: `calculateRequiredDepth()`

```typescript
async function calculateRequiredDepth(
  dir: string,
  localBranches: Branch[],
  trunkRef: string
): Promise<number> {
  // Find the oldest merge-base between trunk and all local branches
  let maxDistance = 0

  for (const branch of localBranches) {
    if (branch.ref === trunkRef) continue

    try {
      // Get merge-base between trunk and this branch
      const mergeBase = await git.findMergeBase({
        fs,
        dir,
        oids: [branch.headSha, trunk.headSha]
      })

      // Count commits from merge-base to branch tip
      const distance = await countCommitDistance(dir, mergeBase, branch.headSha)
      maxDistance = Math.max(maxDistance, distance)
    } catch {
      // If branches have no common ancestor, fall back to default
    }
  }

  // Add buffer for comfort (2x) + trunk depth (100)
  return Math.min(maxDistance * 2 + 100, 500) // Cap at 500
}
```

**Integration**:
- Call before `collectCommitsFromDescriptors()`
- Pass calculated depth to all `collectCommitsForRef()` calls

**Rationale**:
- Loads exactly what's needed for the stack visualization
- Adapts to repository structure (shallow vs. deep stacks)
- Prevents loading ancient history that won't be displayed

---

### Phase 3: Incremental Remote Loading
**Goal**: Load remote branches progressively without blocking UI

#### 3.1 Async Remote Branch Loading
**New File**: `src/node/core/utils/load-remote-branches.ts`

```typescript
export async function loadRemoteBranchesAsync(
  dir: string,
  depth: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ branches: Branch[], commits: Commit[] }> {
  const remotes = await git.listRemotes({ fs, dir })
  const remoteBranches: BranchDescriptor[] = []
  const commitsMap = new Map<string, Commit>()

  let loadedCount = 0

  for (const remote of remotes) {
    const branches = await git.listBranches({ fs, dir, remote: remote.remote })

    for (const branch of branches) {
      if (isSymbolicBranch(branch)) continue

      const descriptor = {
        ref: `${remote.remote}/${branch}`,
        fullRef: `refs/remotes/${remote.remote}/${branch}`,
        isRemote: true
      }

      remoteBranches.push(descriptor)

      // Load commits for this remote branch
      await collectCommitsForRef(dir, descriptor.fullRef, commitsMap, { depth })

      loadedCount++
      onProgress?.(loadedCount, branches.length)
    }
  }

  return {
    branches: remoteBranches.map(d => ({ /* ... */ })),
    commits: Array.from(commitsMap.values())
  }
}
```

#### 3.2 Background Loading via IPC
**New Handler**: [repo.ts](src/node/handlers/repo.ts)

```typescript
const loadRemoteBranches: IpcHandlerOf<'loadRemoteBranches'> = async (
  event,
  { repoPath }
) => {
  const config: Configuration = { repoPath }
  const repo = await buildRepoModel(config) // Local only
  const depth = await calculateRequiredDepth(/* ... */)

  // Start background loading
  const { branches, commits } = await loadRemoteBranchesAsync(
    repoPath,
    depth,
    (loaded, total) => {
      event.sender.send(IPC_EVENTS.remoteLoadProgress, { loaded, total })
    }
  )

  // Merge with existing repo data
  const updatedRepo = {
    ...repo,
    branches: [...repo.branches, ...branches],
    commits: mergeCommits(repo.commits, commits)
  }

  return buildUiStack(updatedRepo)
}
```

**UI Integration**:
- Initial load shows local branches (fast)
- Progress indicator for remote loading
- UI updates incrementally as remotes load
- User can start working immediately

---

### Phase 4: Commit Range Optimization for Stacked Diffs
**Goal**: Only load commits relevant to active stack items

#### 4.1 Stack-Aware Commit Loading
**New Function**: `collectCommitsForStacks()`

```typescript
async function collectCommitsForStacks(
  dir: string,
  branches: Branch[],
  trunkBranch: Branch
): Promise<Commit[]> {
  const commitsMap = new Map<string, Commit>()

  // 1. Load trunk with reasonable depth
  await collectCommitsForRef(dir, trunkBranch.fullRef, commitsMap, { depth: 100 })

  // 2. For each feature branch, only load commits not in trunk
  for (const branch of branches) {
    if (branch.isTrunk || branch.isRemote) continue

    // Find merge-base with trunk
    const mergeBase = await git.findMergeBase({
      fs,
      dir,
      oids: [branch.headSha, trunkBranch.headSha]
    })

    // Only load commits from merge-base to branch tip
    await collectCommitsInRange(
      dir,
      mergeBase,
      branch.headSha,
      commitsMap
    )
  }

  return Array.from(commitsMap.values())
}
```

**Rationale**:
- Each stack item only needs its delta commits
- Avoids loading redundant trunk history multiple times
- Mirrors the visual structure of the stacked diff UI

---

### Phase 5: Intelligent Caching Strategy
**Goal**: Prevent redundant git operations across operations

#### 5.1 In-Memory Cache Layer
**New File**: `src/node/core/utils/repo-cache.ts`

```typescript
type CacheKey = string // repoPath + ref + depth
type CacheEntry = {
  commits: Commit[]
  timestamp: number
  headSha: string
}

class RepoCache {
  private cache = new Map<CacheKey, CacheEntry>()
  private readonly TTL = 30_000 // 30 seconds

  async getCommits(
    key: CacheKey,
    loader: () => Promise<Commit[]>,
    currentHeadSha: string
  ): Promise<Commit[]> {
    const cached = this.cache.get(key)

    // Invalidate if branch moved or expired
    if (
      cached &&
      cached.headSha === currentHeadSha &&
      Date.now() - cached.timestamp < this.TTL
    ) {
      return cached.commits
    }

    const commits = await loader()
    this.cache.set(key, {
      commits,
      timestamp: Date.now(),
      headSha: currentHeadSha
    })

    return commits
  }

  invalidate(repoPath: string): void {
    // Clear all entries for a repo when git operations occur
    for (const key of this.cache.keys()) {
      if (key.startsWith(repoPath)) {
        this.cache.delete(key)
      }
    }
  }
}
```

**Integration Points**:
- Cache at `collectCommitsForRef()` level
- Invalidate on: commit, rebase, checkout, branch operations
- Survives across UI refreshes from [git-watcher.ts](src/node/core/git-watcher.ts)

---

### Phase 6: Virtual Scrolling for Commit Graph
**Goal**: Render only visible commits in the UI tree

#### 6.1 Windowed Commit Rendering
**UI Change**: `src/web/` components

```typescript
// Use react-window or similar for tree virtualization
import { FixedSizeTree } from 'react-vtree'

function StackTree({ stack }: { stack: UiStack }) {
  // Only render commits currently in viewport
  return (
    <FixedSizeTree
      treeWalker={createTreeWalker(stack)}
      itemSize={40}
      height={600}
    >
      {CommitNode}
    </FixedSizeTree>
  )
}
```

**Rationale**:
- Even with optimized loading, repos can have 500-1000 commits
- DOM nodes are expensive; only render what's visible
- Reduces initial render time from seconds to milliseconds

---

## Implementation Phases

### Week 1: Foundation (Biggest Impact)
- [ ] Phase 1.1: Skip remote branches by default
- [ ] Phase 1.2: Add depth parameter (default 100)
- [ ] Test with large repos (Linux kernel, Chromium)
- [ ] **Expected Impact**: 80-90% faster initial load

### Week 2: Smart Loading
- [ ] Phase 2.1: Implement `calculateRequiredDepth()`
- [ ] Phase 4.1: Stack-aware commit loading
- [ ] **Expected Impact**: 50% memory reduction

### Week 3: Progressive Enhancement
- [ ] Phase 3.1: Async remote loading
- [ ] Phase 3.2: UI progress indicators
- [ ] **Expected Impact**: Non-blocking UI, perceived performance boost

### Week 4: Polish
- [ ] Phase 5.1: Caching layer
- [ ] Phase 6.1: Virtual scrolling (if needed)
- [ ] Performance profiling and tuning
- [ ] **Expected Impact**: Smooth UX even with 100+ branches

---

## Configuration API

Add to `Configuration` type in [types/repo.ts](src/shared/types/repo.ts):

```typescript
export type Configuration = {
  repoPath: string
  performance?: {
    /** Load remote branches on initial load. Default: false */
    loadRemotes?: boolean
    /** Max commit depth per branch. Default: 100 */
    commitDepth?: number
    /** Enable aggressive caching. Default: true */
    enableCache?: boolean
    /** Max branches to load. Default: unlimited */
    maxBranches?: number
  }
}
```

---

## Success Metrics

### Before Optimization (Large Repo - 1000 commits, 50 remote branches)
- Initial load: 15-30 seconds
- Memory usage: 500MB+
- UI blocks: 5+ seconds
- Crashes: Frequent

### After Phase 1 (Target)
- Initial load: 1-3 seconds
- Memory usage: 50MB
- UI blocks: < 500ms
- Crashes: None

### After All Phases (Target)
- Initial load: < 1 second
- Memory usage: 20-30MB
- UI blocks: 0 (background loading)
- Crashes: None
- Smooth 60fps rendering

---

## Backward Compatibility

All changes are additive:
- Default behavior focuses on common case (local branches)
- Power users can enable full remote loading via settings
- Existing tests continue to pass with depth limits
- Cache is transparent (implementation detail)

---

## Alternative Approaches Considered

### ❌ Git Log with Graph
Using `git log --graph --all` is faster but:
- Parsing output is brittle
- Loses structured data from isomorphic-git
- Harder to implement incremental loading

### ❌ Switch to NodeGit/Simple-git
Native bindings are faster but:
- Adds native dependencies (harder builds)
- isomorphic-git is already embedded
- Optimization pays off across tool

### ❌ Lazy Load on Scroll
Loading commits only when branches are expanded:
- Breaks merge-base calculations
- Complicates stacked diff logic
- Better as Phase 7 enhancement

---

## Risk Mitigation

### Risk: Incomplete history breaks operations
**Mitigation**:
- Always load merge-bases fully
- Track "shallow" flag in Repo model
- Auto-extend depth when operations need more history

### Risk: Cache invalidation bugs
**Mitigation**:
- Conservative TTL (30s)
- Explicit invalidation on ALL write operations
- Cache keys include headSha for safety

### Risk: Remote branches needed for rebase
**Mitigation**:
- Load remote tracking branches for local branches
- Fetch on-demand when rebasing onto remote refs
- User can force-load all remotes via setting

---

## Future Enhancements (Post-MVP)

1. **Partial Clone Support**: Use `git clone --filter=blob:none` for massive repos
2. **SQLite Storage**: Persist commit graph to disk, load from DB
3. **Multi-threaded Loading**: Use worker threads for parallel branch processing
4. **Smart Prefetch**: Predict which branches user will expand, preload them
5. **Commit Graph API**: If available, use Git's commit-graph file for faster traversal

---

## Testing Strategy

### Unit Tests
- Test depth limiting with known commit counts
- Verify cache hit/miss scenarios
- Test merge-base calculations with shallow clones

### Integration Tests
- Clone Linux kernel (~1M commits) locally
- Measure load times with different configurations
- Test rebase operations with limited history

### Performance Benchmarks
Create synthetic repos:
- Small: 100 commits, 5 branches
- Medium: 1K commits, 20 branches
- Large: 10K commits, 50 branches
- Huge: 100K commits, 200 branches

Track metrics:
- Time to first render
- Memory high-water mark
- CPU usage during load
- Responsiveness (frame rate)

---

## Code Structure Changes

```
src/node/core/utils/
├── build-repo.ts               (Modified: add depth, skip remotes)
├── load-remote-branches.ts     (New: async remote loading)
├── repo-cache.ts               (New: caching layer)
├── calculate-depth.ts          (New: smart depth calculation)
└── merge-commits.ts            (New: dedup commits from multiple loads)

src/node/handlers/
└── repo.ts                     (Modified: add loadRemoteBranches handler)

src/shared/types/
└── repo.ts                     (Modified: add performance config)

src/web/components/
└── StackTree.tsx               (Modified: virtual scrolling)
```

---

## Key Insights for Architecture

1. **Lazy is Better**: Only load what you need, when you need it
2. **Depth is Your Friend**: 99% of work happens in recent history
3. **Remotes are Expensive**: They 10x your branch count for minimal benefit
4. **Cache Aggressively**: Git doesn't change that fast, cache everything
5. **Progressive is Professional**: Show something fast, load rest in background

This plan transforms a blocking, monolithic load into a fast, incremental, and resilient system that scales to any repository size while maintaining the stacked diff workflow integrity.
