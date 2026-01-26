# Teapot Current State Analysis

A comprehensive conceptual analysis of Teapot's architecture, data models, state management, and data flows.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Model Layers](#2-data-model-layers)
3. [State Management Architecture](#3-state-management-architecture)
4. [Caching Strategy](#4-caching-strategy)
5. [Data Flow Patterns](#5-data-flow-patterns)
6. [Git Abstraction Layer](#6-git-abstraction-layer)
7. [File System Watching](#7-file-system-watching)
8. [Forge Integration](#8-forge-integration)
9. [IPC Communication](#9-ipc-communication)
10. [Rebase State Machine](#10-rebase-state-machine)
11. [Domain Logic Patterns](#11-domain-logic-patterns)
12. [UI State Management](#12-ui-state-management)

---

## 1. Architecture Overview

### Process Model

Teapot is an Electron application with a clear separation between three execution contexts:

- **Main Process**: Runs Node.js, handles all git operations, file system access, and business logic
- **Renderer Process**: Runs React, handles UI rendering and user interactions
- **Preload Script**: Bridges the two processes with type-safe IPC bindings

### Layer Organization

The codebase follows a layered architecture:

- **Shared Types Layer**: Type definitions shared between main and renderer processes
- **Domain Layer**: Pure functions for stack analysis, validation, and state machines
- **Services Layer**: Caching, file watching, model building
- **Operations Layer**: High-level git operations orchestration
- **Adapters Layer**: Git CLI abstraction, GitHub API integration
- **Handlers Layer**: Thin IPC routing to operations
- **Web Layer**: React contexts, components, and hooks

### Design Philosophy

The architecture embodies several key principles:

- **Local-first**: Git operations never block on network requests
- **Eventual consistency**: GitHub data loads asynchronously and merges at render time
- **Pure domain logic**: All domain functions are pure with no I/O dependencies
- **Immutable state transitions**: State machines enforce immutable transformations
- **Graceful degradation**: Stale data displayed on network failures rather than errors

---

## 2. Data Model Layers

Teapot maintains three distinct data representation layers, each serving a specific purpose:

### Layer 1: Raw Git Data Model

This layer represents the underlying git state as closely as possible to the actual git repository structure:

**Repo**: The root model containing all repository information
- Lists of commits, branches, and worktrees with their exact git state
- Working tree status including staged, modified, deleted, and conflicted files
- Multiple worktree support with tracking of which is active

**Commit**: Minimal commit representation
- SHA, message, timestamp, single parent SHA, multiple children SHAs
- Notably assumes linear history (single parent) despite git's support for merges
- Deliberately simplified for stacked diffs workflow

**Branch**: Simple branch reference with metadata
- Basic flags: isTrunk, isRemote
- Head SHA to identify commit pointer
- No complex branch relationship tracking at this level

**Worktree**: Git worktree support
- Path, head SHA, branch reference, status flags
- Tracks whether worktree is main, stale, or dirty
- Treats worktrees as independent working contexts

**WorkingTreeStatus**: Comprehensive working tree state snapshot
- Fine-grained file change tracking across all change types
- Rebase state detection via isRebasing flag
- Detached HEAD tracking

### Layer 2: Domain Models

These are derived and computed models that represent business concepts used for operations:

**StackNodeState**: Hierarchical branch model for stacked diffs
- Each node represents a branch with its ownership and children
- Recursive structure: a branch can have multiple child branches
- Contains ownedShas: commits owned by this specific branch (head first, oldest last)
- Enables visualization and manipulation of branch stacks

**RebaseIntent**: User's intention to rebase branches
- Targets: array of branches to rebase with their target base commit
- Represents a "what-if" scenario before execution
- Used by planning phase before actual rebase execution

**RebaseState**: Complete rebase operation state machine
- Session: metadata about the overall rebase operation
- Jobs by ID: individual rebase jobs (one per branch being rebased)
- Queue: which jobs are pending versus active
- Commit map: tracks old to new commit rewrites for UI reconciliation

**RebaseJob**: Single branch rebase operation
- Tracks original base/head and target base
- Status progression: queued, applying, awaiting-user, completed, failed
- Conflict file tracking with multi-stage git data

### Layer 3: UI State Model

Optimized for rendering with pre-computed permissions and enriched metadata:

**UiState**: Complete UI-ready state
- Stack: the visual tree to render
- Working tree: file changes for the diff view
- Trunk head SHA: cached for rebase operations

**UiStack**: Visual branch tree with rendering metadata
- Commits: array of UI commits in the stack
- Flags: canRebaseToTrunk, isDirectlyOffTrunk
- These are pre-computed permissions from backend

**UiCommit**: Branch commit with full metadata
- SHA, name (commit message), timestamp
- Spinoffs: array of child stacks (alternative branches from this commit)
- Rebase status: state for UI interaction (prompting, idle, running, conflicted, resolved, queued, null)
- Is current: highlighted if HEAD points here
- Branches: all branch tips at this commit
- Is independent: true if this is a fork point (multiple spinoffs, no single owner)

**UiBranch**: Rich branch information for UI
- Basic properties: name, isCurrent, isRemote, isTrunk
- Pull request: embedded PR data if exists
- Worktree: which worktree has this checked out (if any)
- Owned commit SHAs: computed ownership chain
- Expected PR base: computed target branch for PR creation
- Computed permissions: canRename, canDelete, canSquash, canCreateWorktree, canShip, canCreatePr
- Error reasons: squashDisabledReason, createPrBlockedReason
- State flags: isMerged, hasStaleTarget

**UiPullRequest**: GitHub-ready PR data
- Number, title, URL, state (open, closed, merged, draft)
- Is in sync: local branch tip matches PR head SHA
- Is mergeable: combines GitHub's mergeable plus mergeable_state
- Merge readiness: detailed CI and branch protection status
- Has multiple open PRs: warning condition
- Has base drift: PR target doesn't match computed local target

---

## 3. State Management Architecture

### Multi-Layer State Architecture

Teapot maintains state across three distinct layers:

**Backend State (Node Layer)**
- Git forge service holds clients per repository
- Manages GitHub PAT from configuration store
- Lazy initializes clients on first access
- Two-tier invalidation: per-repo or clear all

**Frontend State (React Layer)**
- Stores PR data as React state
- Manages fetch status (idle, fetching, error, success)
- Provides optimistic update methods
- Tracks rate limit information for adaptive polling
- Provides refresh capability on demand

**Disk Cache (Persistent)**
- Stores latest forge state in configuration store
- Loaded on repo initialization for instant display
- Debounced writes prevent excessive I/O

### React Context Hierarchy

The application uses six primary React contexts organized hierarchically:

1. **ThemeContext** (root): Manages light/dark theme preference, persists to localStorage, subscribes to system theme changes

2. **LocalStateContext** (global): Manages list of added repositories, tracks selected/active repository, loads repos on mount

3. **ForgeStateProvider** (repo-dependent): Fetches GitHub PR data independently, implements adaptive polling, provides optimistic mutations

4. **UiStateProvider** (repo-dependent): Manages local git state, implements versioning to prevent race conditions, watches repository for changes, handles all git operations as IPC-wrapped async functions

5. **UtilityModalsContext** (UI-specific): Provides generic confirmation and alert modals, returns promises for async modal handling

6. **DragProvider** (interaction-specific): Manages drag-and-drop UI state, implements auto-scroll at edges, tracks forbidden drop targets

---

## 4. Caching Strategy

### Repository Model Cache

**What Is Cached**
- Individual commits (SHA to message, timestamp, parent SHA) - up to 5,000 per repo
- Merged branch detection results keyed by trunk HEAD SHA - up to 5 entries

**Cache Limits and Eviction**
- Maximum commits per repo: 5,000 (one cache per repo, 10 repos max in memory)
- Eviction strategy: LRU by commit timestamp when cache is full - evicts oldest 10% to make room
- Merged branches: FIFO eviction - oldest trunk head is removed when exceeding 5 entries

**Why This Strategy**
- Commits are immutable once stored in git - no staleness risk
- Merged branch detection is keyed by trunk HEAD SHA, so changes automatically use new key
- LRU eviction maximizes cache value for active branches
- Avoids redundant git log traversals in large repos

### Forge State Cache

**What Is Cached**
- GitHub pull request list with all fields from GraphQL query
- Rate limit information from GitHub API
- Last successful fetch timestamp

**Cache Strategy**
- In-memory TTL: 15 seconds (balance between freshness and API rate limiting)
- Error retry: 2 seconds on fetch failure (shorter TTL to recover faster)
- Disk persistence: Cached state written to electron-store after successful fetch (debounced 2 seconds)
- Startup reload: Cached state loaded from disk on client initialization

**Request Deduplication**
- Concurrent requests for the same state return a shared Promise
- Prevents thundering herd on rapid successive calls

### Session and Context Cache

**Session State (Rebase Operations)**
- Location: electron-store (disk) plus SessionService (memory cache)
- Two-tier write-through: Memory for fast lookups, disk for crash recovery
- What is stored: Rebase intent, rebase state, job queue, original branch, worktree detach info
- Lifecycle: Created before rebase, updated during job execution, cleared on completion/abort

**Execution Context (Temp Worktrees)**
- Location: Persisted JSON file in git directory
- What is stored: Temp worktree path, creation timestamp, operation type, repo path
- TTL: 24 hours - older contexts are considered stale/orphaned
- Purpose: Survives crashes during conflict resolution so UI can resume from saved worktree

---

## 5. Data Flow Patterns

### Primary Data Flow: Git State to UI

```
Backend (Node.js)
  → Computes UiState (stack, working tree, rebase status)
  → IPC invoke getRepo with repoPath
  → UiStateProvider receives UiState
  → Components consume via useUiStateContext
```

### File System Change Detection Flow

```
Backend file watcher
  → Detects git directory changes
  → IPC send repoChange event
  → useGitWatcher hook listens
  → Calls refreshRepo
  → getRepo IPC call refreshes UiState
  → Version guard prevents stale updates
```

### GitHub State Flow

```
Backend calls getForgeState via IPC
  → Returns ForgeStateResult with PRs, status, rate limit info
  → ForgeStateProvider processes and caches
  → At render time, enrichStackWithForge merges PR data into stack
  → Components read enriched stack from UiStateContext
```

### Enrichment Process (Async Merge)

- Backend returns minimal git state
- GitHub state loads independently with its own polling schedule
- At component render time, enrichStackWithForge merges PR data into branches
- Creates new stack structure with computed properties (canShip, isInSync, hasBaseDrift)
- Does not mutate original stack - creates new tree structure

### Request Path for getRepo IPC Handler

1. UI calls ipc.invoke getRepo with repoPath
2. Handler calls UiStateOperation.getUiState
3. Parallel fetches: RepoModelService.buildRepoModel, SessionService.getSession, ExecutionContextService.getStoredContext
4. buildRepoModel orchestrates:
   - List local/remote branches (git command)
   - Resolve trunk branch (cached via TrunkResolver)
   - For each branch, load commits (check RepoModelCache first, if miss run git log and cache)
   - Load working tree status (git command)
   - Load worktrees list (git command)
5. Detect merged branches (check cache keyed by trunk HEAD SHA, if miss run parallel merge-base checks)
6. Build UI state via UiStateBuilder.buildFullUiState (pure function, no network calls)
7. Return UiState to UI

---

## 6. Git Abstraction Layer

### Two-Tier Interface Architecture

**GitAdapter Interface**: Defines a unified contract for git operations independent of underlying implementation
- Uses optional methods for advanced features (rebase, cherry-pick, merge) with corresponding type guards
- Type guards like supportsRebase and supportsMergeBase enable feature detection

**SimpleGitAdapter Implementation**: The sole implementation using the simple-git library
- Wraps native Git CLI
- Allows entire app to operate on git abstractions rather than CLI invocations

### Operation Grouping

- Repository Creation: clone
- Repository Inspection: listBranches, log, resolveRef, getWorkingTreeStatus, listWorktrees
- Repository Mutation: add, commit, branch, checkout, reset
- Network Operations: push, fetch
- Advanced Operations: rebase, cherry-pick, merge, rebaseAbort, rebaseContinue, rebaseSkip

### Execution Layers

**Level 5: High-Level Operations**
- BranchOperation (checkout, delete, cleanup, create)
- CommitOperation (amend, uncommit, commitToNewBranch)
- PullRequestOperation (ship-it)
- RebaseOperation (submitIntent, confirmIntent, continue, abort, skip)
- WorktreeOperation (checkoutBranch, remove, discard)

**Level 4: Execution Orchestration**
- RebaseExecutor (executes rebase jobs, handles conflicts, manages state)
- ExecutionContextService (acquires/releases clean execution contexts)

**Level 3: State Management**
- RebaseStateMachine (pure state transitions)
- SessionService (persistent session storage via electron-store)
- TransactionService (write-ahead log for crash recovery)

**Level 2: Repository Introspection**
- RepoModelService (builds complete repo state from git)
- RebaseValidator (validates preconditions)
- BranchUtils, StackAnalyzer (domain logic)

**Level 1: Git Adapter**
- SimpleGitAdapter (raw git operations)

### Atomicity Strategy

The app uses a "Pragmatic Atomic Unit" approach rather than traditional ACID atomicity:

**Execution Context Isolation**
- All git operations (especially rebases) execute in a temporary worktree, not the user's working directory
- Ensures the active worktree remains unaffected by in-progress operations
- Temp worktree always created at trunk with detached HEAD for clean isolation

**State Machine Checkpoints**
- Jobs complete atomically: either they finish fully (new commit SHA recorded) or they pause at conflicts
- No partial job completion
- State transitions recorded in SessionService before proceeding to next job

**Write-Ahead Log (TransactionService)**
- Intent written to git directory BEFORE operation starts
- Intent statuses: pending → executing → completed → cleared
- On crash recovery: if intent is executing, operation may need rollback via rebase abort
- 1-hour TTL on stale intents prevents orphaned recovery logs

---

## 7. File System Watching

### Architecture Overview

Teapot uses a single, centralized file system watcher based on Node.js's native fs.watch API:

- **GitWatcherService**: A singleton service running on the main Electron process that monitors file system changes
- **useGitWatcher hook**: A React hook in the renderer process that sets up IPC listeners for watcher events
- **Bidirectional communication**: IPC channels (watchRepo, unwatchRepo, onRepoChange, onRepoError) connect the renderer and main processes

### Event Flow

1. File System Change Detection: Files in the watched repository directory change (recursive watching enabled)
2. FSWatcher Callback Triggered: fs.watch invokes the callback when file modifications occur
3. Debouncing (100ms): handleFileChange sets a debounce timer to batch rapid file changes
4. Cache Invalidation: When debounce timer fires, CacheService.invalidateRepoCache clears the merged branches cache
5. IPC Event Emission: GitWatcher sends an onRepoChange event via webContents.send
6. Hook Listener Activation: The useGitWatcher hook receives the change notification
7. Refresh Trigger: refreshRepo is called, which invokes window.api.getRepo
8. Version Guard: useRequestVersioning checks if the response is still current
9. React State Update: setUiState updates the UI with fresh git state

### Watcher Lifecycle

**Initialization Phase**
- Triggered by watchRepo IPC handler when a repo is selected
- GitWatcher.watch is called with the working tree path
- A bound destroyed listener is registered on the WebContents
- fs.watch with recursive option begins monitoring the directory tree

**Active Monitoring Phase**
- File changes trigger the watcher callback
- Debounce mechanism (100ms timeout) prevents UI thrashing
- Pause/resume capability allows suppression during multi-step operations

**Cleanup Phase**
- Triggered by WebContents destroyed, unwatchRepo IPC handler, or sendSafe failure
- webContents.removeListener removes the destroyed handler
- currentWatcher.close stops the fs.watch
- Pending debounce timer is cleared

### Pause/Resume for Multi-Step Operations

**Pause Mechanism**
- GitWatcher.pause sets paused to true and clears pendingChange flag
- While paused, file changes set pendingChange to true instead of sending IPC events
- Used before complex operations to prevent showing intermediate states

**Resume Mechanism**
- GitWatcher.resume sets paused to false
- If pendingChange is true, immediately invalidates cache and sends a single consolidated repoChange event
- Ensures UI always shows final state, not intermediate states

---

## 8. Forge Integration

### Adapter Pattern

**Layer 1: Interface Definition (GitForgeAdapter)**
- Defines the contract for all forge providers (currently GitHub)
- Methods: fetchState, createPullRequest, updatePullRequestBase, deletePrBranch, mergePullRequest, fetchPrDetails
- Designed for future providers like GitLab

**Layer 2: Provider Implementation (GitHubAdapter)**
- Implements GitHub-specific logic using both GraphQL and REST APIs
- Primary strategy: GraphQL queries that fetch all PR data in a single request
- Fallback mechanism: Switches to REST if GraphQL fails

**Layer 3: Client Layer (GitForgeClient)**
- Manages caching with 15-second in-memory TTL plus disk persistence
- Deduplicates concurrent requests
- Implements retry logic for transient errors

### PR Data Model

**Core PR Types**
- ForgePullRequest: Lightweight PR data (number, title, state, headRefName, headSha, baseRefName, isMergeable)
- MergeReadiness: Detailed merge status (canMerge, blockers, checksStatus, individual status checks)
- GitForgeState: Collection of PRs plus detected merged branch names for fallback sync
- ForgeStateResult: Wraps state with metadata (status, error, lastSuccessfulFetch, rateLimit)

**PR State Management**
- States: open, draft, closed, merged
- Active states (open or draft) used for stack-based operations
- Helper functions provide type-safe queries: findOpenPr, findActivePr, findBestPr, hasChildPrs, hasMergedPr

### Adaptive Polling

- 5-second interval when CI checks are pending
- 15-second interval during normal activity
- 30-second interval when tab is hidden
- 60-second interval when rate limit is low (remaining less than 10% of limit)
- Window focus event triggers cache-busting refresh

### Optimistic Updates

**markPrAsMerged (after merge initiated)**
- Prevents "Ship It" button from re-enabling during GitHub refresh
- Sets PR state to merged and isMergeable to false immediately
- Cleared when fresh forge state arrives

**markPrChecksPending (after push)**
- When user pushes new commits, CI hasn't registered yet
- Immediately sets checksStatus to pending
- Clears failed checks, adds checks_pending blocker

### Branch-PR Relationship

**Primary Link: headRefName**
- PR's headRefName matches the local branch name
- Used by findBestPr for lookup

**Multiple PRs Per Branch**
- Handled with findBestPr using priority: open > draft > merged > closed
- Within same state: prefers most recently created
- UI warns when multiple open PRs exist for same branch

**Sync Detection**
- Compares PR's headSha with commit SHA where branch is positioned
- If equal: PR is in sync with local state
- If different: Local branch has diverged

---

## 9. IPC Communication

### Channel Structure

The IPC channels are organized into a single immutable IPC_CHANNELS object containing 59 named channels, grouped by feature domain:

- Repository Management: getRepo, getForgeState, watchRepo, unwatchRepo
- Rebase Planning: submitRebaseIntent, confirmRebaseIntent, cancelRebaseIntent, resolveWorktreeConflictAndRebase
- Rebase Execution: continueRebase, abortRebase, skipRebaseCommit, getRebaseStatus, resumeRebaseQueue
- Working Tree Operations: discardStaged, amend, getCommitMessage, commit, setFilesStageStatus
- Branch Management: checkout, deleteBranch, cleanupBranch, createBranch, renameBranch
- Pull Request Operations: createPullRequest, updatePullRequest, shipIt, getSquashPreview, squashIntoParent
- Repository Selection: getLocalRepos, selectLocalRepo, addLocalRepo, removeLocalRepo, showFolderPicker
- Settings/Configuration: getGithubPat, setGithubPat, getPreferredEditor, setPreferredEditor
- Worktree Management: getActiveWorktree, switchWorktree, removeWorktree, createWorktree

Event channels for one-way notifications:
- repoChange: File system watcher detects git repository changes
- repoError: Critical error in repository operations
- rebaseWarning: Warnings during rebase execution
- updateDownloading/updateDownloaded: Update lifecycle events

### Type Safety

**IpcContract Interface**: Maps each channel to an object containing request and response types

**Type Helpers**
- IpcRequest: Extracts request type for a channel
- IpcResponse: Extracts response type for a channel
- IpcHandler: Defines handler signature with proper argument variance
- IpcHandlerOf: Alias for type-safe handler declarations

### Request/Response Patterns

**Simple State Return** (most common)
- Handler performs operation, returns updated UiState
- UI updates state immediately via React context

**Union Type Success/Failure** (complex operations)
- Handler returns union type with success boolean discriminator
- UI pattern matches on discriminator to handle different outcomes

**Pure Data Returns** (queries)
- Handler returns query results without updating state

**Void Returns** (configuration mutations)
- Handler performs mutation, returns nothing

### Error Handling

**Electron IPC Error Serialization**
- Thrown errors are caught by Electron's IPC layer
- Error properties serialized to JSON
- Renderer receives Promise rejection with serialized error

**Custom Error Classes**
- RebaseOperationError implements custom serialization
- Error code encoded in error.name
- Frontend can extract error codes using extractErrorCode

### Request Versioning

- Renderer maintains version counter for each request
- When response arrives, renderer checks if version is still current
- Discards stale responses from earlier requests
- Prevents watcher updates from overwriting newer mutations

---

## 10. Rebase State Machine

### Three-Layer Rebase Model

**RebasePhase**: High-level explicit state machine with 8 phases
- idle → planning → queued → executing → conflicted → finalizing → completed/error
- Tracks user-facing state with detailed phase transitions and validation

**RebaseStateMachine**: Pure immutable state machine
- Creates rebase plans from intents
- Manages job queues (branches to rebase)
- Tracks job completion
- Records conflicts
- Resumes sessions from Git state

**RebaseValidator**: Pure validation logic
- Checks preconditions before starting a rebase
- Validates clean working tree, no existing rebase, no detached HEAD
- Checks branch hasn't moved, worktree conflicts

### RebaseIntent and StackNodeState

The rebase intent captures the user's desire to rebase branches:
- Targets: The branches to rebase and their new base SHAs
- Node tree: The full stack of branches to be rebased (parent plus all descendants)
- Timestamp: When the intent was created

The StackNodeState tree within the intent contains:
- Branch name, current head/base SHAs
- All commits owned by this branch (ownedShas)
- Child StackNodeStates (branches that depend on this one)

### Job Queue Processing

A rebase is decomposed into atomic jobs:
- Each job represents rebasing a single branch
- Jobs are queued in topological order (parents before children)
- The queue processes jobs sequentially, recording completion with the new HEAD SHA
- After a parent completes, its children are enqueued with the parent's new HEAD as their base

### Conflict Handling

When Git encounters a merge conflict during rebase:
1. The job transitions to awaiting-user state
2. Conflict files are recorded in the job
3. User resolves conflicts in the working tree
4. The git rebase continue command is executed
5. The job completes with the new HEAD SHA

### Session Resumption

If the app crashes or user navigates away, the rebase can be resumed:
- resumeRebaseSession reconciles the persisted session with current Git state
- Updates job statuses based on whether Git is still rebasing and conflict state
- Can resume a conflicted rebase, continue after conflict resolution, or detect completion

---

## 11. Domain Logic Patterns

### Core Abstraction: Stacks

Teapot conceptualizes Git workflow around "stacks" of branches—a linear chain where each branch depends on its parent. This models the popular "stacked diffs" pattern.

**Trunk/Main branch**: The source of truth (main, master, develop, or trunk). Marked with isTrunk flag.

**Feature branches**: Non-trunk branches that depend on either the trunk or other feature branches.

**Stacks**: Tree-structured collections of branches where each branch has zero or more child branches.

### Commit Ownership

A branch owns all commits from its HEAD back to (but not including):
1. A trunk commit
2. Another branch head
3. A fork point (a commit with multiple non-trunk children)
4. The root commit

**Fork Points**: When a commit has multiple branches forking from it, that commit is marked as a fork point and becomes independent. No single branch owns it. This prevents surprising cascading moves when rebasing one sibling.

**Branchless Commits**: Commits with no branch pointing to them that lie between a branch head and its fork point are owned by that branch and move with it during rebase.

### Stack Analysis

StackAnalyzer provides a toolkit for manipulating stack structures:
- Tree operations: Walk, flatten, compute depth, count nodes
- Node finding: Search by branch name within trees or rebase intents
- Commit lineage: Walk backwards through commit history, collect lineage, count commits
- Branch hierarchy: Build indices mapping commits to branches, build parent-child relationships

### Trunk Resolution

TrunkResolver uses a priority-based selection:
1. Marked branches first (isTrunk and not remote)
2. Any marked trunk
3. Canonical names (main, master, develop, trunk) among local branches
4. Remote canonical names
5. Fallback to first branch

### PR Target Resolution

PrTargetResolver walks backward from the branch's parent commit:
- Stops at trunk (most common case)
- Stops at another branch (stack parent)
- Skips merged branches
- Distinguishes between siblings vs stack members

### Validation Patterns

**RebaseValidator**: Centralizes all precondition checks with clear error codes
- Clean working tree
- No existing rebase in progress
- No detached HEAD
- Branch hasn't moved
- Worktree conflicts

**SquashValidator**: Validates squash operations
- Cannot squash trunk
- Cannot squash during rebase
- Cannot squash dirty current branch
- Cannot squash non-linear branches
- Worktree conflicts block squash

---

## 12. UI State Management

### State Subscription and Updates

**Pull-Based Updates**
- Components call useUiStateContext hook
- Context value is memoized to prevent unnecessary re-renders
- Only re-renders when actual data changes

**Push-Based Updates**
- File system watcher emits repoChange events via IPC
- useGitWatcher hook listens and triggers refreshRepo
- Calls getRepo IPC which pulls fresh UiState

### Adaptive Polling (ForgeState)

- Intelligent polling intervals based on application state
- Poll rates vary: 5s (pending checks), 15s (foreground), 30s (background), 60s (rate-limited)
- Stops polling when tab is hidden
- Resumes on window focus with cache invalidation

### Optimistic Updates

- markPrAsMerged: Immediately updates forge state when merge completes
- markPrChecksPending: Shows pending checks status before GitHub registers new runs
- Prevents brief UI flickers during network round trips
- Applied to forge state, not git state

### State Derivation and Transformation

**Backend Derivation**
- Computes stack hierarchy from git refs
- Calculates isDirectlyOffTrunk
- Determines branch permissions
- Sets rebase status during rebase sessions
- Marks merged branches via git ancestry checks

**Frontend Enrichment (render-time)**
- enrichStackWithForge merges PR data into stack
- Computes canShip, isInSync, hasBaseDrift, hasMultipleOpenPrs
- Detects isMerged from PR state or git ancestry fallback

### Drag-and-Drop Flow

1. User mousedowns on commit dot
2. User moves mouse to maybeStartDrag which captures bounding boxes
3. Mouse moves over targets via updateDropTarget which finds closest commit
4. Mouse move near edges triggers performAutoScroll via requestAnimationFrame
5. User releases, handleMouseUp validates target and calls submitRebaseIntent
6. submitRebaseIntent IPC returns new UiState or worktree conflicts dialog

### Version Guard Pattern

- UiStateProvider uses useRequestVersioning hook with incrementing version counter
- Each async operation acquires a version number at start
- Results only applied if version matches current (not stale)
- Prevents old IPC responses from overwriting fresh mutations
- Essential when file watcher fires while mutation in flight
