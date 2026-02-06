# Teapot Remodeling Proposals

Comprehensive recommendations for improving Teapot's architecture, data models, and data flows.

---

## Table of Contents

1. [Unified Data Model](#1-unified-data-model)
2. [State Management Redesign](#2-state-management-redesign)
3. [Cache Architecture Improvements](#3-cache-architecture-improvements)
4. [IPC Communication Overhaul](#4-ipc-communication-overhaul)
5. [Git Abstraction Enhancements](#5-git-abstraction-enhancements)
6. [File Watcher Improvements](#6-file-watcher-improvements)
7. [Forge Integration Refactoring](#7-forge-integration-refactoring)
8. [Domain Logic Consolidation](#8-domain-logic-consolidation)
9. [Code Organization Restructuring](#9-code-organization-restructuring)
10. [New Abstractions to Introduce](#10-new-abstractions-to-introduce)
11. [DRY Refactoring Opportunities](#11-dry-refactoring-opportunities)
12. [Naming Convention Standards](#12-naming-convention-standards)

---

## 1. Unified Data Model

### 1.1 Support Merge Commits Properly

**Current Problem**: Commit type only has single parentSha, losing merge parent information.

**Proposed Solution**: Extend Commit to support multiple parents:

```
Commit {
  sha: string
  message: string
  timestampMs: number
  parentShas: string[]      // Array of all parent SHAs (first is primary)
  childrenShas: string[]
  isMergeCommit: boolean    // Derived: parentShas.length > 1
}
```

The commit ownership and lineage algorithms should be updated to follow only the primary parent by default, but have an option to consider all parents when needed.

### 1.2 Create Single StackNode Type

**Current Problem**: Three different stack representations (StackNodeState, UiStack, indices).

**Proposed Solution**: Create a single immutable StackNode type that serves all purposes:

```
StackNode {
  branchRef: string
  headSha: string
  baseSha: string
  ownedCommitShas: string[]   // Computed once, stored
  children: StackNode[]

  // Computed flags (can be derived but cached for performance)
  isDirectlyOffTrunk: boolean
  isForkPoint: boolean
  depth: number
}
```

Build this structure once when loading the repo, then derive both UI representation and rebase intent from it. The UiStateBuilder becomes a simple projection rather than a complex re-computation.

### 1.3 Compute Ownership Once and Cache

**Current Problem**: Commit ownership is re-computed in multiple places.

**Proposed Solution**: Compute ownership during model building and store it:

```
RepoModel {
  commits: Map<sha, Commit>
  branches: Map<ref, Branch>
  ownershipIndex: Map<sha, BranchOwnership>  // Pre-computed
  stackRoot: StackNode                        // Pre-computed tree
}

BranchOwnership {
  ownerBranchRef: string | null  // null if fork point
  distanceFromHead: number
}
```

This moves computation to a single point (RepoModelService) and makes it available everywhere without recalculation.

### 1.4 Split UiBranch into Composed Types

**Current Problem**: UiBranch has 20+ properties mixing different concerns.

**Proposed Solution**: Compose UiBranch from focused sub-types:

```
UiBranch {
  core: BranchCore {
    ref: string
    headSha: string
    isTrunk: boolean
    isRemote: boolean
    isCurrent: boolean
  }

  permissions: BranchPermissions {
    canRename: boolean
    canDelete: boolean
    canSquash: boolean
    canShip: boolean
    canCreatePr: boolean
    canCreateWorktree: boolean

    // All restrictions have reasons
    restrictions: BranchRestriction[]
  }

  prInfo: BranchPrInfo | null {
    pullRequest: UiPullRequest
    isInSync: boolean
    hasBaseDrift: boolean
    expectedBase: string
  }

  stackInfo: BranchStackInfo {
    ownedCommitShas: string[]
    parentBranch: string | null
    isDirectlyOffTrunk: boolean
  }

  worktreeInfo: WorktreeInfo | null
}

BranchRestriction {
  permission: string  // e.g., "canSquash"
  reason: string      // e.g., "parent_is_trunk"
  userMessage: string // e.g., "Cannot squash into trunk branch"
}
```

### 1.5 Standardize Optionality

**Current Problem**: Inconsistent use of `?` vs explicit `| null`.

**Proposed Solution**: Establish clear conventions:

- Use `| null` for fields that can be explicitly absent (like `prInfo: BranchPrInfo | null`)
- Use `?` only for fields that are legitimately optional based on context
- Never use `?` for booleans - they should always be defined
- Document processing stages that populate optional fields

---

## 2. State Management Redesign

### 2.1 Single Source of Truth for Merged Status

**Current Problem**: Multiple sources for "merged" status that can disagree.

**Proposed Solution**: Create a MergedBranchResolver with explicit priority:

```
MergedBranchResolver {
  // Priority order (first match wins):
  // 1. PR state === 'merged' (authoritative)
  // 2. Local git ancestry detection (fallback)

  isMerged(branchRef: string): MergedStatus {
    source: 'pr_api' | 'git_ancestry' | 'unknown'
    merged: boolean
    confidence: 'high' | 'medium' | 'low'
    mergedIntoRef: string | null
  }
}
```

Call this resolver once during model building and store the result on the branch.

### 2.2 Unify Optimistic Updates with Server State

**Current Problem**: Optimistic updates stored separately, can conflict.

**Proposed Solution**: Implement optimistic state as overlay with automatic reconciliation:

```
ForgeState {
  serverState: GitForgeState        // Last successful fetch
  optimisticOverlay: OptimisticChanges  // Pending optimistic changes

  getEffectiveState(): GitForgeState {
    // Merge overlay onto server state
    // Automatically clear overlay when server state catches up
  }
}

OptimisticChanges {
  prStateOverrides: Map<number, PrState>
  checksStatusOverrides: Map<number, ChecksStatus>
  appliedAt: number  // Timestamp for auto-expiry
}
```

When server state arrives, compare with overlay and clear matched changes. If overlay is older than threshold (e.g., 30 seconds), clear it regardless.

### 2.3 Replace Context Cascade with State Slice Pattern

**Current Problem**: Context nesting causes full re-mounts on repo change.

**Proposed Solution**: Use a flatter state structure with selective subscriptions:

```
// Single top-level context with sliced subscriptions
AppState {
  repos: LocalReposSlice
  currentRepo: CurrentRepoSlice | null
  forge: ForgeSlice | null
  theme: ThemeSlice
}

// Components subscribe to specific slices
function BranchList() {
  const stack = useAppStateSlice(s => s.currentRepo?.uiState.stack)
  const forge = useAppStateSlice(s => s.forge?.state)
  // Only re-renders when these specific values change
}
```

This avoids provider nesting and gives fine-grained subscription control.

### 2.4 Automatic Request Versioning

**Current Problem**: Manual version guard calls are error-prone.

**Proposed Solution**: Create an automatic versioned async wrapper:

```
function useVersionedAsync<T>(
  asyncFn: () => Promise<T>,
  deps: DependencyList
): VersionedAsyncState<T> {
  // Internally manages version tracking
  // Automatically discards stale results
  // Returns { data, loading, error, refresh }
}

// Usage
const { data: uiState, loading, refresh } = useVersionedAsync(
  () => window.api.getRepo(repoPath),
  [repoPath]
)
```

### 2.5 Replace Manual Flags with State Machine

**Current Problem**: skipWatcherUpdatesRef is manual and error-prone.

**Proposed Solution**: Model the "operation in progress" state explicitly:

```
OperationState =
  | { status: 'idle' }
  | { status: 'pending', operation: OperationType, startedAt: number }
  | { status: 'executing', operation: OperationType, suppressWatcher: boolean }
  | { status: 'awaiting_user', operation: OperationType, prompt: UserPrompt }

// Watcher behavior derived from state
function shouldProcessWatcherEvent(opState: OperationState): boolean {
  return opState.status === 'idle' || !opState.suppressWatcher
}
```

---

## 3. Cache Architecture Improvements

### 3.1 Use Content-Addressed Cache for Commits

**Current Problem**: Commit cache never expires, force-pushes leave stale entries.

**Proposed Solution**: Commits are already content-addressed (SHA is content hash). Keep the cache but add:

```
CommitCache {
  commits: Map<sha, CachedCommit>
  accessOrder: LinkedList<sha>  // For LRU

  // Proactive cleanup when branches are deleted
  pruneCacheForRemovedBranches(removedBranchHeads: string[]) {
    // Walk from removed heads, mark commits as pruneable
    // Prune if not reachable from any current branch
  }
}
```

### 3.2 Unified Cache Invalidation Events

**Current Problem**: Multiple invalidation points make reasoning difficult.

**Proposed Solution**: Create a centralized cache coordinator:

```
CacheCoordinator {
  invalidationReasons: Set<InvalidationReason>

  // All invalidation goes through here
  invalidate(reason: InvalidationReason) {
    this.invalidationReasons.add(reason)
    this.scheduleFlush()
  }

  private scheduleFlush() {
    // Debounce and batch invalidations
    // Emit single invalidation event with all reasons
    // Consumers can filter by reason
  }
}

InvalidationReason =
  | { type: 'file_change', paths: string[] }
  | { type: 'git_operation', operation: string }
  | { type: 'ttl_expired', cache: string }
  | { type: 'manual_refresh' }
  | { type: 'window_focus' }
```

### 3.3 Reliable Disk Cache Flushing

**Current Problem**: Debounced writes may not complete before app closes.

**Proposed Solution**: Implement write-through with confirmation:

```
PersistentCache<T> {
  memoryState: T
  diskState: T
  pendingWrite: Promise<void> | null

  async set(value: T) {
    this.memoryState = value
    await this.writeThrough()  // Wait for disk write
  }

  // On app quit, wait for pending writes
  async flush(): Promise<void> {
    if (this.pendingWrite) {
      await this.pendingWrite
    }
  }
}

// Register with Electron's before-quit
app.on('before-quit', async (event) => {
  event.preventDefault()
  await cacheCoordinator.flushAll()
  app.quit()
})
```

### 3.4 Versioned Session State with Merge

**Current Problem**: Concurrent session writes overwrite without merge.

**Proposed Solution**: Implement compare-and-swap with conflict detection:

```
SessionStore<T> {
  async update(
    sessionId: string,
    updater: (current: T) => T
  ): Promise<T> {
    const current = await this.read(sessionId)
    const expectedVersion = current.version
    const updated = updater(current.data)

    const result = await this.compareAndSwap(
      sessionId,
      expectedVersion,
      updated
    )

    if (!result.success) {
      // Another process updated - retry with fresh data
      return this.update(sessionId, updater)
    }

    return result.value
  }
}
```

---

## 4. IPC Communication Overhaul

### 4.1 Structured Error Types Instead of Encoded Names

**Current Problem**: Error codes encoded in error.name string.

**Proposed Solution**: Define proper error result types:

```
// All IPC handlers return Result type
type IpcResult<T> =
  | { ok: true, value: T }
  | { ok: false, error: IpcError }

type IpcError = {
  code: ErrorCode  // Enum, not string
  message: string
  userMessage: string  // Always present, always user-friendly
  details?: Record<string, unknown>
  recoverable: boolean
  suggestedAction?: SuggestedAction
}

SuggestedAction =
  | { type: 'retry' }
  | { type: 'configure', setting: string }
  | { type: 'manual_intervention', instructions: string }
```

### 4.2 Move Dialogs Out of Handlers

**Current Problem**: Blocking dialogs in handlers cause unpredictable delays.

**Proposed Solution**: Return dialog requirements to frontend:

```
// Handler returns need for confirmation
type DeleteBranchResult =
  | { status: 'success', uiState: UiState }
  | { status: 'needs_confirmation', prompt: ConfirmationPrompt }
  | { status: 'error', error: IpcError }

ConfirmationPrompt {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  severity: 'info' | 'warning' | 'danger'
}

// Frontend shows dialog and retries with confirmation flag
async function deleteBranch(branchRef: string) {
  const result = await api.deleteBranch({ branchRef })

  if (result.status === 'needs_confirmation') {
    const confirmed = await showConfirmDialog(result.prompt)
    if (confirmed) {
      return api.deleteBranch({ branchRef, confirmed: true })
    }
  }

  return result
}
```

### 4.3 Handler Registration Validation

**Current Problem**: Missing handlers silently hang.

**Proposed Solution**: Validate at startup:

```
function registerHandlers() {
  const registeredChannels = new Set<string>()

  // Register each handler and track
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler)
    registeredChannels.add(channel)
  }

  // Validate all channels have handlers
  const missingHandlers = Object.values(IPC_CHANNELS)
    .filter(ch => !registeredChannels.has(ch))

  if (missingHandlers.length > 0) {
    throw new Error(`Missing handlers: ${missingHandlers.join(', ')}`)
  }
}
```

### 4.4 Standardize Handler Return Types

**Current Problem**: Inconsistent return types across handlers.

**Proposed Solution**: Define handler categories with standard returns:

```
// Category 1: State mutations - always return Result<UiState>
type StateMutationHandler = (req: Request) => Promise<IpcResult<UiState>>

// Category 2: Queries - return Result<QueryType>
type QueryHandler<T> = (req: Request) => Promise<IpcResult<T>>

// Category 3: Commands - return Result<void>
type CommandHandler = (req: Request) => Promise<IpcResult<void>>

// Category 4: Complex operations - return specific result union
type ComplexHandler<T> = (req: Request) => Promise<IpcResult<T>>
```

Document which category each handler belongs to in IpcContract.

---

## 5. Git Abstraction Enhancements

### 5.1 Make Advanced Operations Non-Optional

**Current Problem**: Optional methods require runtime checks.

**Proposed Solution**: Create adapter levels:

```
// Base adapter - always available
interface GitAdapterBase {
  listBranches(): Promise<Branch[]>
  log(): Promise<Commit[]>
  checkout(): Promise<void>
  // ... basic operations
}

// Extended adapter - available when Git supports it
interface GitAdapterExtended extends GitAdapterBase {
  rebase(): Promise<void>
  merge(): Promise<void>
  cherryPick(): Promise<void>
}

// Factory returns appropriate level
function createGitAdapter(repoPath: string): GitAdapterBase | GitAdapterExtended {
  const capabilities = detectGitCapabilities(repoPath)
  if (capabilities.supportsRebase) {
    return new ExtendedGitAdapter(repoPath)
  }
  return new BaseGitAdapter(repoPath)
}

// Type narrowing via capability check
function isExtended(adapter: GitAdapterBase): adapter is GitAdapterExtended {
  return 'rebase' in adapter
}
```

### 5.2 Transaction Abstraction

**Current Problem**: Each operation manages its own cleanup.

**Proposed Solution**: Create a GitTransaction abstraction:

```
class GitTransaction {
  private operations: GitOperation[] = []
  private undoStack: UndoOperation[] = []

  async execute<T>(
    op: GitOperation<T>,
    undo: UndoOperation
  ): Promise<T> {
    this.operations.push(op)
    this.undoStack.push(undo)

    try {
      return await op.execute()
    } catch (error) {
      // Auto-rollback on failure
      await this.rollback()
      throw error
    }
  }

  async rollback(): Promise<void> {
    // Execute undo operations in reverse order
    for (const undo of this.undoStack.reverse()) {
      await undo.execute()
    }
  }

  async commit(): Promise<void> {
    // Clear undo stack - changes are permanent
    this.undoStack = []
  }
}

// Usage
async function rebaseWithChildren(branches: string[]) {
  const tx = new GitTransaction()

  try {
    for (const branch of branches) {
      await tx.execute(
        () => git.rebase(branch, targetBase),
        () => git.rebase(branch, originalBase)  // Undo
      )
    }
    await tx.commit()
  } catch {
    // Rollback happens automatically
  }
}
```

### 5.3 Consistent Shallow Clone Policy

**Current Problem**: Inconsistent handling across functions.

**Proposed Solution**: Define explicit policy:

```
ShallowClonePolicy {
  // On missing commit, choose behavior:
  behavior: 'error' | 'skip' | 'fetch'

  // If 'fetch', how to fetch:
  fetchStrategy: 'deepen' | 'unshallow' | 'fetch_commit'
}

// Apply policy in all commit-walking code
function walkCommits(
  startSha: string,
  policy: ShallowClonePolicy
): AsyncGenerator<Commit> {
  // Consistent handling everywhere
}
```

### 5.4 Use GitAdapter for All Git Operations

**Current Problem**: WorktreeOperation uses raw exec.

**Proposed Solution**: Add worktree methods to GitAdapter:

```
interface GitAdapter {
  // Existing methods...

  // Worktree operations
  addWorktree(path: string, branch: string): Promise<void>
  removeWorktree(path: string, force?: boolean): Promise<void>
  listWorktrees(): Promise<Worktree[]>
  pruneWorktrees(): Promise<void>
}
```

### 5.5 Distributed Lock for Cross-Process Safety

**Current Problem**: Lock is process-local only.

**Proposed Solution**: Implement file-based lock with heartbeat:

```
class DistributedLock {
  private lockPath: string
  private heartbeatInterval: NodeJS.Timer | null = null

  async acquire(timeout: number): Promise<LockHandle> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const lockInfo = await this.tryReadLock()

      if (!lockInfo || this.isStale(lockInfo)) {
        if (await this.tryWriteLock()) {
          this.startHeartbeat()
          return new LockHandle(this)
        }
      }

      await sleep(100)
    }

    throw new LockTimeoutError()
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.updateHeartbeat()
    }, 1000)
  }

  private isStale(info: LockInfo): boolean {
    return Date.now() - info.heartbeat > 5000
  }
}
```

---

## 6. File Watcher Improvements

### 6.1 Use Robust Watcher Library

**Current Problem**: fs.watch has cross-platform issues.

**Proposed Solution**: Switch to chokidar or @parcel/watcher:

```
import { watch } from '@parcel/watcher'

class GitWatcher {
  private subscription: AsyncSubscription | null = null

  async start(repoPath: string) {
    this.subscription = await watch(repoPath, (err, events) => {
      if (err) {
        this.handleError(err)
        return
      }

      const gitEvents = this.filterGitRelevantEvents(events)
      if (gitEvents.length > 0) {
        this.handleChanges(gitEvents)
      }
    }, {
      ignore: [
        '**/node_modules/**',
        '**/.git/objects/**',  // Don't watch object database
      ]
    })
  }
}
```

### 6.2 Smart .git Directory Filtering

**Current Problem**: All .git changes trigger refresh, including irrelevant ones.

**Proposed Solution**: Filter to meaningful git state changes:

```
GIT_RELEVANT_PATHS = [
  '.git/HEAD',           // Current checkout
  '.git/refs/**',        // Branch pointers
  '.git/index',          // Staging area
  '.git/MERGE_HEAD',     // Merge in progress
  '.git/REBASE_HEAD',    // Rebase in progress
  '.git/CHERRY_PICK_HEAD',
]

function isGitRelevantChange(path: string): boolean {
  return GIT_RELEVANT_PATHS.some(pattern =>
    minimatch(path, pattern)
  )
}
```

### 6.3 Typed Change Events

**Current Problem**: Single pendingChange boolean loses information.

**Proposed Solution**: Track specific change types:

```
PendingChanges {
  headsChanged: boolean      // Branch pointers changed
  indexChanged: boolean      // Staging area changed
  workingTreeChanged: boolean  // Files modified
  rebaseStateChanged: boolean  // Rebase in progress

  any(): boolean {
    return this.headsChanged || this.indexChanged ||
           this.workingTreeChanged || this.rebaseStateChanged
  }

  merge(other: PendingChanges): PendingChanges {
    // Combine changes
  }
}
```

### 6.4 Configurable Debounce

**Current Problem**: 100ms debounce is hardcoded.

**Proposed Solution**: Make debounce configurable with smart defaults:

```
WatcherConfig {
  debounceMs: number  // Default: 100
  maxWaitMs: number   // Maximum wait before forced emit (default: 1000)

  // Auto-adjust based on disk type
  static autoConfig(repoPath: string): WatcherConfig {
    const diskType = detectDiskType(repoPath)
    return diskType === 'ssd'
      ? { debounceMs: 50, maxWaitMs: 500 }
      : { debounceMs: 200, maxWaitMs: 2000 }
  }
}
```

### 6.5 Handle Watch Limit Exceeded

**Current Problem**: ENOSPC not handled.

**Proposed Solution**: Detect and provide guidance:

```
async function startWatcher(path: string): Promise<Watcher> {
  try {
    return await createWatcher(path)
  } catch (error) {
    if (error.code === 'ENOSPC') {
      // Linux inotify limit exceeded
      throw new WatchLimitError(
        'File watcher limit exceeded. ' +
        'Increase fs.inotify.max_user_watches or use polling mode.',
        { canUsePollMode: true }
      )
    }
    throw error
  }
}
```

---

## 7. Forge Integration Refactoring

### 7.1 Unified Fetch with Provider Abstraction

**Current Problem**: Dual GraphQL/REST paths with different behaviors.

**Proposed Solution**: Create unified fetch layer:

```
interface ForgeFetcher {
  fetchPullRequests(): Promise<ForgePullRequest[]>
  fetchPrDetails(number: number): Promise<PrDetails>
  // Returns normalized data regardless of underlying API
}

class GitHubFetcher implements ForgeFetcher {
  private graphqlClient: GraphQLClient
  private restClient: RestClient

  async fetchPullRequests(): Promise<ForgePullRequest[]> {
    try {
      return await this.fetchViaGraphQL()
    } catch (error) {
      if (this.shouldFallbackToRest(error)) {
        return await this.fetchViaRest()
      }
      throw error
    }
  }

  // Both paths return identical ForgePullRequest shape
}
```

### 7.2 Explicit PR-Branch Linking

**Current Problem**: Implicit linking via headRefName string match.

**Proposed Solution**: Create explicit link registry:

```
PrBranchLinkRegistry {
  links: Map<branchRef, PrLink>

  link(branchRef: string, prNumber: number, source: LinkSource) {
    this.links.set(branchRef, { prNumber, source, linkedAt: Date.now() })
  }

  unlink(branchRef: string) {
    this.links.delete(branchRef)
  }

  // On branch rename, update link
  handleBranchRename(oldRef: string, newRef: string) {
    const link = this.links.get(oldRef)
    if (link) {
      this.links.delete(oldRef)
      this.links.set(newRef, link)
    }
  }
}

LinkSource = 'api_match' | 'user_linked' | 'created_together'
```

### 7.3 Transparent PR Selection

**Current Problem**: findBestPr priority rules are hidden.

**Proposed Solution**: Make selection visible and overridable:

```
PrSelector {
  selectBest(
    branchRef: string,
    prs: ForgePullRequest[],
    preferences?: PrPreferences
  ): PrSelectionResult {
    const candidates = this.findCandidates(branchRef, prs)
    const ranked = this.rankCandidates(candidates, preferences)

    return {
      selected: ranked[0],
      alternatives: ranked.slice(1),
      selectionReason: this.explainSelection(ranked[0])
    }
  }
}

PrSelectionResult {
  selected: ForgePullRequest | null
  alternatives: ForgePullRequest[]
  selectionReason: string  // e.g., "Selected open PR #42 over closed PR #30"
}
```

### 7.4 Eliminate Polling for Created PRs

**Current Problem**: Polling after PR creation wastes API quota.

**Proposed Solution**: Trust the create response:

```
async createPullRequest(params: CreatePrParams): Promise<ForgePullRequest> {
  const createdPr = await this.adapter.createPullRequest(params)

  // Immediately add to state without re-fetching
  this.updateStateOptimistically(state => ({
    ...state,
    pullRequests: [createdPr, ...state.pullRequests]
  }))

  // Schedule background refresh for eventual consistency
  // but don't block on it
  this.scheduleBackgroundRefresh(5000)

  return createdPr
}
```

### 7.5 Proactive Rate Limit Management

**Current Problem**: Rate limiting only reactive.

**Proposed Solution**: Implement token bucket with proactive throttling:

```
RateLimitManager {
  remaining: number
  resetAt: number
  requestsInFlight: number

  async withRateLimit<T>(request: () => Promise<T>): Promise<T> {
    // Wait if we'd exceed safe threshold
    while (this.remaining - this.requestsInFlight < SAFE_BUFFER) {
      await this.waitForReset()
    }

    this.requestsInFlight++
    try {
      const result = await request()
      this.updateFromResponse(result)
      return result
    } finally {
      this.requestsInFlight--
    }
  }

  // Adjust polling based on remaining quota
  getRecommendedPollInterval(): number {
    const percentRemaining = this.remaining / this.limit
    if (percentRemaining < 0.1) return 60000  // 60s
    if (percentRemaining < 0.25) return 30000 // 30s
    if (percentRemaining < 0.5) return 15000  // 15s
    return 5000  // 5s
  }
}
```

---

## 8. Domain Logic Consolidation

### 8.1 Centralized Trunk Resolution

**Current Problem**: Trunk detection duplicated across codebase.

**Proposed Solution**: Single TrunkService with cached result:

```
class TrunkService {
  private cache: Map<repoPath, TrunkInfo> = new Map()

  resolve(repo: Repo): TrunkInfo {
    const cached = this.cache.get(repo.path)
    if (cached && cached.version === repo.version) {
      return cached
    }

    const trunk = this.computeTrunk(repo)
    this.cache.set(repo.path, { ...trunk, version: repo.version })
    return trunk
  }

  private computeTrunk(repo: Repo): TrunkInfo {
    // Single implementation of trunk resolution
    // Returns TrunkInfo with explanation of why it was chosen
  }
}

TrunkInfo {
  localRef: string | null
  remoteRef: string | null
  effectiveHeadSha: string
  selectionReason: string  // For debugging
}
```

### 8.2 Handle Multiple Parent Candidates Gracefully

**Current Problem**: Throws error when multiple eligible parents exist.

**Proposed Solution**: Return choices to UI:

```
type ParentResolutionResult =
  | { status: 'resolved', parent: string }
  | { status: 'ambiguous', candidates: ParentCandidate[], recommendation: string | null }
  | { status: 'none', reason: string }

ParentCandidate {
  branchRef: string
  distance: number
  hasActivePr: boolean
  recommendation: boolean  // Based on heuristics
}

// UI can show selection dialog for ambiguous cases
```

### 8.3 Explicit Session State Reconciliation

**Current Problem**: Resume uses heuristics that may surprise users.

**Proposed Solution**: Make reconciliation explicit:

```
ReconciliationResult {
  sessionState: RebaseSessionState
  gitState: GitRebaseState
  conflicts: StateConflict[]
  resolution: ResolvedState
  confidence: 'high' | 'medium' | 'low'
}

StateConflict {
  field: string
  sessionValue: unknown
  gitValue: unknown
  resolution: unknown
  reason: string
}

// If confidence is low, prompt user
async function resumeSession(sessionId: string): Promise<ReconciliationResult> {
  const result = reconcileStates(...)

  if (result.confidence === 'low') {
    // Return to UI for user confirmation
    return { needsUserConfirmation: true, result }
  }

  return { confirmed: true, result }
}
```

### 8.4 Comprehensive Worktree Conflict Detection

**Current Problem**: Only checks direct branch checkout, not indirect dependencies.

**Proposed Solution**: Full dependency graph check:

```
WorktreeConflictDetector {
  detectConflicts(
    operation: Operation,
    repo: Repo
  ): WorktreeConflict[] {
    const affectedBranches = this.computeAffectedBranches(operation, repo)
    const affectedCommits = this.computeAffectedCommits(affectedBranches, repo)

    const conflicts: WorktreeConflict[] = []

    for (const worktree of repo.worktrees) {
      if (worktree.isMain) continue

      // Direct branch conflict
      if (affectedBranches.has(worktree.branch)) {
        conflicts.push({ type: 'direct_checkout', worktree, branch: worktree.branch })
      }

      // Indirect dependency conflict
      const worktreeHead = worktree.headSha
      if (affectedCommits.has(worktreeHead)) {
        conflicts.push({ type: 'depends_on_affected', worktree, commit: worktreeHead })
      }
    }

    return conflicts
  }
}
```

---

## 9. Code Organization Restructuring

### 9.1 Clear Layer Boundaries

**Proposed Structure**:

```
src/
  shared/
    types/           # Pure type definitions only
    constants/       # Shared constants

  domain/            # Pure business logic (no I/O)
    models/          # Domain model types
    services/        # Pure computation services
    validators/      # Validation logic

  infrastructure/    # I/O and external integrations
    git/             # Git adapter and operations
    forge/           # GitHub adapter and operations
    storage/         # Electron store, file system
    ipc/             # IPC handler registration

  application/       # Orchestration layer
    operations/      # High-level operations
    services/        # Application services (use domain + infrastructure)

  web/               # UI layer
    components/      # React components
    contexts/        # React contexts
    hooks/           # React hooks
```

### 9.2 Separate Types from Runtime Code

**Current Problem**: Shared types mixed with utility functions.

**Proposed Solution**: Strict separation:

```
shared/types/
  git-forge.ts      # Only type definitions
  repo.ts           # Only type definitions

shared/utils/
  git-forge-utils.ts  # findBestPr, hasChildPrs, etc.
  repo-utils.ts       # Utility functions
```

### 9.3 Consistent Test Organization

**Proposed Convention**:

```
src/
  domain/
    services/
      TrunkService.ts
      TrunkService.test.ts  # Co-located unit test

  __integration__/          # Integration tests at root
    rebase.integration.test.ts

  __e2e__/                  # E2E tests at root
    smoke.e2e.test.ts
```

### 9.4 Explicit Exports Instead of Barrels

**Current Problem**: Index files re-export everything.

**Proposed Solution**: Explicit, curated exports:

```
// Bad: export * from './everything'

// Good: Explicit exports with intent
export {
  // Public API
  TrunkService,
  type TrunkInfo,

  // Internal - exported for testing only
  // (consider moving to separate test-exports file)
} from './TrunkService'
```

---

## 10. New Abstractions to Introduce

### 10.1 OperationResult Type

```
type OperationResult<T> = {
  ok: true
  value: T
  warnings: Warning[]
} | {
  ok: false
  error: OperationError
  partialResult?: Partial<T>
}

Warning {
  code: string
  message: string
  recoverable: true
}

OperationError {
  code: string
  message: string
  userMessage: string
  recoverable: boolean
  context: Record<string, unknown>
}
```

### 10.2 BranchIdentity

```
BranchIdentity {
  id: string            // Stable UUID
  currentRef: string    // Current name
  previousRefs: string[] // Historical names
  createdAt: number

  // Track across renames
  handleRename(oldRef: string, newRef: string) {
    this.previousRefs.push(oldRef)
    this.currentRef = newRef
  }
}
```

### 10.3 CommitIdentity

```
CommitIdentity {
  id: string           // Stable UUID
  currentSha: string   // Current SHA
  previousShas: string[] // SHAs before rebases

  // When commit is rewritten during rebase
  recordRewrite(oldSha: string, newSha: string) {
    this.previousShas.push(oldSha)
    this.currentSha = newSha
  }

  // Check if a SHA is "the same" commit
  matches(sha: string): boolean {
    return sha === this.currentSha || this.previousShas.includes(sha)
  }
}
```

### 10.4 OperationQueue

```
class OperationQueue {
  private queue: QueuedOperation[] = []
  private running: Operation | null = null

  async enqueue<T>(
    operation: Operation<T>,
    priority: Priority = 'normal'
  ): Promise<T> {
    const queued = new QueuedOperation(operation, priority)
    this.queue.push(queued)
    this.queue.sort((a, b) => b.priority - a.priority)

    return queued.promise
  }

  private async processQueue() {
    while (this.queue.length > 0 && !this.running) {
      const next = this.queue.shift()!
      this.running = next.operation

      try {
        const result = await next.operation.execute()
        next.resolve(result)
      } catch (error) {
        next.reject(error)
      } finally {
        this.running = null
      }
    }
  }
}
```

### 10.5 UndoStack

```
class UndoStack {
  private stack: UndoableAction[] = []
  private redoStack: UndoableAction[] = []

  record(action: UndoableAction) {
    this.stack.push(action)
    this.redoStack = []  // Clear redo on new action

    // Limit stack size
    if (this.stack.length > MAX_UNDO) {
      this.stack.shift()
    }
  }

  async undo(): Promise<void> {
    const action = this.stack.pop()
    if (!action) throw new Error('Nothing to undo')

    await action.undo()
    this.redoStack.push(action)
  }

  async redo(): Promise<void> {
    const action = this.redoStack.pop()
    if (!action) throw new Error('Nothing to redo')

    await action.redo()
    this.stack.push(action)
  }
}

interface UndoableAction {
  description: string
  undo(): Promise<void>
  redo(): Promise<void>
}
```

---

## 11. DRY Refactoring Opportunities

### 11.1 Unified Commit Walker

```
// Single implementation for all commit walking
class CommitWalker {
  constructor(private commits: Map<sha, Commit>) {}

  *walkBackward(
    startSha: string,
    options: WalkOptions = {}
  ): Generator<Commit, void, void> {
    const visited = new Set<string>()
    let current = startSha
    let depth = 0

    while (current && depth < (options.maxDepth ?? Infinity)) {
      if (visited.has(current)) break
      visited.add(current)

      const commit = this.commits.get(current)
      if (!commit) {
        if (options.onMissing === 'error') throw new Error(`Missing commit: ${current}`)
        break
      }

      if (options.stopAt?.(commit)) break

      yield commit
      current = commit.parentSha
      depth++
    }
  }

  collectLineage(startSha: string, options?: WalkOptions): Commit[] {
    return Array.from(this.walkBackward(startSha, options))
  }

  isAncestor(childSha: string, ancestorSha: string): boolean {
    for (const commit of this.walkBackward(childSha)) {
      if (commit.sha === ancestorSha) return true
    }
    return false
  }

  countBetween(childSha: string, ancestorSha: string): number {
    let count = 0
    for (const commit of this.walkBackward(childSha)) {
      if (commit.sha === ancestorSha) return count
      count++
    }
    return -1  // Not found
  }
}
```

### 11.2 Unified Branch Filter

```
// Single place for branch filtering logic
class BranchFilter {
  static forUiDisplay(branches: Branch[], trunk: TrunkInfo): Branch[] {
    return branches.filter(b =>
      !b.isRemote ||
      b.isTrunk ||
      b.ref === trunk.remoteRef
    )
  }

  static forOwnershipCalculation(branches: Branch[]): Branch[] {
    return branches.filter(b => !b.isRemote)
  }

  static forStackAnalysis(branches: Branch[]): Branch[] {
    return branches.filter(b => !b.isRemote && !b.isTrunk)
  }
}
```

### 11.3 Unified Working Tree Check

```
// Single function for working tree cleanliness
function isWorkingTreeClean(status: WorkingTreeStatus): boolean {
  return status.allChangedFiles.length === 0
}

function requireCleanWorkingTree(status: WorkingTreeStatus): void {
  if (!isWorkingTreeClean(status)) {
    throw new DirtyWorkingTreeError(
      'Working tree has uncommitted changes. Commit or stash first.',
      status.allChangedFiles
    )
  }
}
```

### 11.4 Centralized Error Messages

```
// Error message registry
const ERROR_MESSAGES = {
  dirty_tree: {
    title: 'Uncommitted Changes',
    message: 'You have uncommitted changes. Commit or stash them first.',
    suggestion: 'Run `git stash` to temporarily save your changes.'
  },
  rebase_in_progress: {
    title: 'Rebase In Progress',
    message: 'A rebase is already in progress.',
    suggestion: 'Complete or abort the current rebase first.'
  },
  // ...
} as const

function getUserError(code: keyof typeof ERROR_MESSAGES): UserError {
  return ERROR_MESSAGES[code]
}
```

---

## 12. Naming Convention Standards

### 12.1 Standardize Stack Terminology

```
// Consistent terminology:
// - "parent" and "child" for branch relationships
// - "ancestor" and "descendant" for commit relationships
// - "spinoff" deprecated, use "child branch"

// Old: commit.spinoffs, StackNodeState.children
// New:
BranchRelationships {
  parentBranch: string | null     // Branch this one forked from
  childBranches: string[]         // Branches that fork from this one
}

CommitRelationships {
  ancestorShas: string[]          // Commits before this one
  descendantShas: string[]        // Commits after this one
}
```

### 12.2 Standardize Rebase Terminology

```
// Clear distinction:
// - Intent: What the user wants to do (immutable once created)
// - Plan: Intent + computed state (still planning phase)
// - Session: Active execution state (during rebase)
// - Job: Single branch rebase within a session

RebaseIntent     // User clicks "rebase X onto Y"
RebasePlan       // System computes affected branches
RebaseSession    // Execution begins
RebaseJob        // Individual branch being rebased
```

### 12.3 Disambiguate "Head"

```
// Always qualify "head":
branchHeadSha: string     // The commit a branch points to
gitHead: GitHead          // What's checked out (branch or detached SHA)
prHeadSha: string         // The commit at PR's head branch tip

GitHead =
  | { type: 'branch', ref: string, sha: string }
  | { type: 'detached', sha: string }
```

### 12.4 Distinguish Working Tree vs Worktree

```
// Explicit naming:
WorkingDirectory {        // Changes in current working dir
  stagedFiles: File[]
  modifiedFiles: File[]
  // ...
}

GitWorktree {             // Git worktree feature
  path: string
  branch: string | null
  headSha: string
  // ...
}
```

### 12.5 Consistent Boolean Naming

```
// Convention:
// - "is" prefix for state booleans: isTrunk, isRemote, isCurrent
// - "has" prefix for possession: hasPr, hasChildren, hasConflicts
// - "can" prefix for permissions: canDelete, canSquash, canShip
// - "should" prefix for computed recommendations: shouldRebase, shouldPush

// All booleans are always defined (not optional)
// Use explicit false rather than undefined
```

### 12.6 Consistent Async Naming

```
// Convention:
// - No "Async" suffix (async is the default expectation)
// - Use "sync" suffix for rare synchronous variants

// Good:
async function fetchPullRequests(): Promise<PR[]>
function fetchPullRequestsSync(): PR[]  // Only if truly needed

// Bad:
async function fetchPullRequestsAsync(): Promise<PR[]>
```
