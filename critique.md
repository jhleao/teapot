# Teapot Architecture Critique

A comprehensive analysis of architectural problems, design issues, and improvement opportunities in Teapot.

---

## Table of Contents

1. [Data Model Issues](#1-data-model-issues)
2. [State Management Problems](#2-state-management-problems)
3. [Cache Coherence Issues](#3-cache-coherence-issues)
4. [IPC Communication Problems](#4-ipc-communication-problems)
5. [Git Abstraction Issues](#5-git-abstraction-issues)
6. [File Watcher Limitations](#6-file-watcher-limitations)
7. [Forge Integration Problems](#7-forge-integration-problems)
8. [Domain Logic Issues](#8-domain-logic-issues)
9. [Code Organization Problems](#9-code-organization-problems)
10. [Missing Abstractions](#10-missing-abstractions)
11. [Non-DRY Patterns](#11-non-dry-patterns)
12. [Naming and Clarity Issues](#12-naming-and-clarity-issues)

---

## 1. Data Model Issues

### 1.1 Commit Parent Assumption is Fundamentally Flawed

The entire data model assumes single-parent commits (linear history) despite Git supporting merge commits with multiple parents. The Commit type only has `parentSha` (singular) while tracking `childrenSha` (plural). This is an asymmetric design that loses information about merge commits.

**Impact**: Incorrect commit ancestry calculations in repositories with merge commits. The model silently drops non-primary parent references, potentially breaking stack detection and rebase operations on merge-heavy repositories.

### 1.2 Three Redundant Stack Representations

The codebase maintains three different representations of branch stacks:

- **StackNodeState**: Used by rebase intent and state machine
- **UiStack/UiCommit**: Used by the UI layer
- **Parent/children indices**: Built dynamically by StackAnalyzer

These representations are conceptually similar but structurally different, requiring complex transformation logic (UiStateBuilder) and creating opportunities for inconsistency.

### 1.3 Commit Ownership is Re-Computed Everywhere

The CommitOwnership calculation is a critical piece of logic that determines which commits belong to which branch. However, this calculation is performed multiple times:

- During UiState building
- During rebase intent creation
- During projected stack calculation

Each computation is done from scratch rather than cached or passed through. This is both wasteful and creates risk of inconsistent results if the underlying data changes between calls.

### 1.4 UiBranch is Overloaded with Responsibilities

UiBranch has grown to contain 20+ properties mixing:

- Basic branch data (name, headSha)
- Computed permissions (canRename, canDelete, canSquash, canShip, canCreatePr, canCreateWorktree)
- PR data (pullRequest, hasStaleTarget, expectedPrBase, hasBaseDrift)
- Worktree data (worktree, ownedCommitShas)
- Error reasons (squashDisabledReason, createPrBlockedReason)

This violates single responsibility and makes the type difficult to reason about. The permissions should be a separate computed object.

### 1.5 Inconsistent Optionality

Some fields use `?` for optionality while others use `| undefined`. The codebase inconsistently mixes:

- `canShip?: boolean`
- `isIndependent?: boolean`
- `worktree?: UiWorktreeBadge`

This makes it unclear which fields are truly optional versus which are always present after a certain processing stage.

---

## 2. State Management Problems

### 2.1 Multiple Sources of Truth for Merged Status

A branch can be marked as "merged" from three different sources:

1. PR state equals 'merged' (from GitHub API)
2. Local git detection via getMergedBranchNames (ancestry check)
3. GitForgeState.mergedBranchNames (fallback array)

These sources can disagree, and the resolution logic is scattered across enrichStackWithForge and UiStateBuilder. There is no single authoritative source.

### 2.2 Optimistic Updates Can Conflict with Server State

ForgeStateProvider has markPrAsMerged and markPrChecksPending for optimistic updates, but these can conflict with the next server refresh. If GitHub's eventual consistency returns stale data, the UI might flicker between states.

The version checking helps but doesn't fully solve the problem because optimistic state is stored separately from fetched state.

### 2.3 React Context Nesting Creates Re-Mount Cascades

The context hierarchy (ThemeContext → LocalStateContext → ForgeStateProvider → UiStateProvider → ...) means that changing the selected repo causes full tree re-mounts of all child providers. This is expensive and can cause visible loading flashes.

### 2.4 Version Guard is Manual and Error-Prone

The useRequestVersioning pattern requires developers to manually call acquireVersion before async operations and checkVersion before applying state. Forgetting either call creates race condition bugs that are hard to detect.

### 2.5 skipWatcherUpdatesRef is a Leaky Abstraction

UiStateContext uses a ref flag (skipWatcherUpdatesRef) to suppress watcher updates during certain operations. This manual flag management is error-prone—if an operation throws before resetting the flag, watcher updates remain suppressed.

### 2.6 No State Reconciliation on Window Focus

When the user returns to Teapot after working in terminal (running manual git commands), there is no comprehensive state reconciliation. The watcher will trigger a refresh, but complex state like rebase sessions may be out of sync with actual git state.

---

## 3. Cache Coherence Issues

### 3.1 Merged Branch Cache Keyed by Trunk SHA Only

The merged branches cache uses trunk HEAD SHA as the key. This means:

- If trunk moves, old entries become unreferenced but not cleared (memory leak bounded to 5 entries)
- If branches are deleted, cached results may include stale branch names
- No invalidation when non-trunk branches change

### 3.2 Commit Cache Never Expires

Commits are treated as immutable, so the cache never expires entries based on time. However, force-push operations rewrite history, creating new commits with the same conceptual identity but different SHAs. The old SHAs remain cached indefinitely.

### 3.3 Forge Cache Has Multiple Invalidation Points

Forge state can be invalidated via:

- TTL expiration (15 seconds)
- Explicit refreshWithStatus call
- Error retry (2 seconds)
- Window focus event

These multiple invalidation points make it hard to reason about cache freshness and can lead to unexpected refreshes or stale data.

### 3.4 Disk Cache Writes Are Debounced Without Flushing

Forge state disk writes are debounced to 2 seconds. If the app closes within 2 seconds of the last state change, that change may not be persisted. While there is a flushCache method, it is not reliably called on app shutdown.

### 3.5 Session State Version Without Conflict Detection

SessionService tracks version numbers but doesn't actually detect or resolve conflicts. If two processes (unlikely but possible) write session state simultaneously, the later write wins without merge logic.

---

## 4. IPC Communication Problems

### 4.1 Error Codes Encoded in Error.name is Fragile

RebaseOperationError encodes error codes in the error.name property using string concatenation (e.g., "RebaseOperationError:WORKTREE_CREATION_FAILED"). This pattern:

- Depends on exact string formatting
- Is not type-safe (typos in error codes are not caught)
- Requires manual extraction on the frontend
- Cannot be extended with additional metadata

### 4.2 Dialogs in Handlers Block IPC

Several handlers (deleteBranch, cleanupBranch, createPullRequest, shipIt) show blocking dialog.showMessageBox calls. This means:

- IPC requests can hang waiting for user input
- Multiple dialogs may appear out of order
- The renderer has no way to know why its request is delayed

### 4.3 No Handler Registration Validation

There is no compile-time or runtime verification that all IPC_CHANNELS have registered handlers. If a handler is missing, the channel will silently hang until the frontend's timeout (10 seconds).

### 4.4 Sandbox Disabled for Node Module Access

webPreferences.sandbox is set to false, which reduces security isolation. While necessary for native module access, this increases attack surface and should be documented in a threat model.

### 4.5 All Errors Expose Stack Traces

Thrown errors include full stack traces in production, which are then displayed in toast notifications. This can reveal sensitive internal paths and structure to users.

### 4.6 Inconsistent Return Types Across Handlers

Some handlers return UiState, some return structured result objects with success flags, some return void, and some return nullable values. This inconsistency makes it hard to build generic error handling on the frontend.

---

## 5. Git Abstraction Issues

### 5.1 GitAdapter Optional Methods Create Runtime Errors

Advanced git operations (rebase, merge, cherry-pick) are optional on the GitAdapter interface. Code must use type guards like `supportsRebase(git)` before calling these methods. If a developer forgets the check, a runtime error occurs.

### 5.2 No Transaction/Rollback Abstraction

While the codebase has write-ahead logging (TransactionService), there is no high-level transaction abstraction. Each operation manually manages its own cleanup on failure, leading to duplicated error handling code.

### 5.3 Shallow Clone Handling is Inconsistent

Different functions handle shallow clones differently:

- buildTrunkShaSet gracefully handles missing commits
- CommitOwnership logs a warning and continues
- Some operations silently fail or degrade

There is no consistent policy for shallow clone behavior.

### 5.4 Worktree Operations Use Raw exec

WorktreeOperation uses child_process.exec directly instead of going through GitAdapter. This creates inconsistency in error handling and logging, and bypasses any future adapter-level features.

### 5.5 Lock File is Process-Local Only

The ExecutionContextService mutex lock only works within a single process. If two Electron processes run simultaneously (unlikely but possible with certain launch scenarios), race conditions could occur.

### 5.6 No Commit Rewrite Tracking Beyond Single Session

Commit rewrites (old SHA → new SHA mappings) are tracked only within a single rebase session. If the user performs multiple rebases, or reruns a rebase later, old mappings are lost. This makes it impossible to track the "identity" of a commit across history rewrites.

---

## 6. File Watcher Limitations

### 6.1 Using fs.watch Instead of Robust Alternative

Node.js fs.watch is known to have cross-platform inconsistencies. Libraries like chokidar or @parcel/watcher provide more reliable behavior. The current implementation may miss events or produce duplicates on certain platforms.

### 6.2 Watching Entire Repository Including .git

The watcher monitors the entire repository directory recursively, including the .git directory. This generates many events during git operations that don't affect the conceptual state. Better filtering (ignoring internal .git changes that don't affect refs) would reduce noise.

### 6.3 Single pendingChange Boolean Loses Information

The pause/resume mechanism tracks only a single boolean (pendingChange). If multiple different types of changes occur while paused, this information is lost. The resume always sends a generic "repoChange" event.

### 6.4 No Debounce Configuration

The 100ms debounce is hardcoded. Large repos or slow disks may need longer debounce times, while fast SSDs could use shorter times. This should be configurable.

### 6.5 Watch Overflow Not Handled

fs.watch can fail with ENOSPC on Linux if the inotify watch limit is exceeded. There is no handling or user notification for this scenario.

### 6.6 No Differentiation Between Git and Non-Git Changes

The watcher doesn't distinguish between changes to git state (refs, objects) and changes to working tree files. Both trigger the same refresh, but they have different implications for what data is stale.

---

## 7. Forge Integration Problems

### 7.1 Dual Fetch Mechanisms (GraphQL + REST) Are Partially Duplicated

Both GraphQL and REST code paths exist for fetching PR data. While this provides fallback capability, the two paths:

- Have different error handling
- Return slightly different data shapes
- Handle rate limits differently (GraphQL returns rateLimit, REST doesn't reliably)

### 7.2 PR-Branch Linking is Implicit via headRefName

The connection between a PR and a branch is solely through matching the headRefName. This is fragile:

- Branch renames break the link
- Multiple repos could have same-named branches
- No explicit foreign key relationship

### 7.3 findBestPr Priority Rules are Implicit

When multiple PRs exist for a branch, findBestPr uses priority rules (open > draft > merged > closed). These rules are hardcoded and not configurable. Users have no visibility into why a particular PR was selected.

### 7.4 Eventual Consistency Polling is Wasteful

After creating a PR, the code polls GitHub until the PR appears (up to 10 attempts). This is wasteful because:

- The PR data was already returned from the create call
- Optimistic update could be used instead of polling
- Each poll consumes API quota

### 7.5 Rate Limit Handling is Reactive Only

The system only adapts to rate limits after they occur (60-second polling when remaining < 10%). There is no proactive throttling to prevent hitting limits in the first place.

### 7.6 No GitLab or Other Forge Support Despite Interface

The GitForgeAdapter interface suggests multi-provider support, but only GitHub is implemented. The GraphQL queries and URL parsing are GitHub-specific, meaning adding GitLab would require significant refactoring.

---

## 8. Domain Logic Issues

### 8.1 Fork Point Detection Depends on Trunk Classification

Fork point detection identifies commits with multiple non-trunk children. If trunk classification is wrong (e.g., unusual trunk name not in canonical list), fork points may be incorrectly identified, causing ownership calculation errors.

### 8.2 Multiple Parent Candidates Throws Error Instead of Handling

PrTargetResolver throws an error when multiple eligible parent branches exist at the same commit. This forces users to manually clean up stale branches rather than providing a UI to choose.

### 8.3 Rebase Session Resume Uses Heuristics

resumeRebaseSession infers session state from Git state using heuristics (is Git rebasing? are there conflicts?). If Git state and stored session state disagree, the resolution logic may not match user expectations.

### 8.4 Worktree Conflict Detection is Shallow

Rebase validation checks if affected branches are checked out in other worktrees, but doesn't validate indirect dependencies. A worktree could have uncommitted changes that depend on branches being rebased.

### 8.5 Squash Validation is Tightly Coupled to Branch Structure

SquashValidator contains many checks (is trunk, parent is trunk, has siblings, is linear, etc.) that are specific to the stacked diffs model. This makes it hard to support alternative workflows or relax constraints.

### 8.6 Commit Ownership Cycles Silently Break

The commit ownership walk has a maxDepth limit and visited set to prevent infinite loops. If a cycle exists (git corruption), the walk silently terminates without clear error indication.

---

## 9. Code Organization Problems

### 9.1 Operations Layer Has Inconsistent Boundaries

Some operations (RebaseOperation) are thin wrappers around executors and state machines, while others (PullRequestOperation, BranchOperation) contain significant business logic. The boundary between operation and domain logic is unclear.

### 9.2 Services vs Domain Distinction is Blurry

CacheService manages caching (appropriate for services), but RepoModelService also contains business logic for building models. The distinction between "service" and "domain" is not consistently applied.

### 9.3 Handlers Contain Some Business Logic

While handlers are supposed to be thin routing layers, some contain business logic:

- Working path resolution
- Retrying with prune
- Dialog display decisions

This makes handlers harder to test and understand.

### 9.4 Shared Types Mixing Pure Types with Utilities

The shared/types directory contains both pure type definitions and utility functions (like findBestPr, hasChildPrs). Mixing types and runtime code in the same module creates unnecessary dependencies.

### 9.5 Test Files Inconsistently Located

Some test files are in `__tests__` directories alongside source, while others might be elsewhere. There is no enforced convention.

### 9.6 Index Files Re-Export Everything

Index files in many directories re-export all contents, making it easy to accidentally create circular dependencies. Barrel files also make tree-shaking harder for build tools.

---

## 10. Missing Abstractions

### 10.1 No Operation Result Type

Operations return various types (UiState, void, success objects, etc.). A unified OperationResult type would provide consistent error handling patterns.

### 10.2 No Branch Identity Concept

Branches are identified solely by name. When branches are renamed, all references break. A BranchIdentity abstraction could track branches across renames.

### 10.3 No Commit Identity Across Rewrites

Commits are identified by SHA. During rebase, commits get new SHAs but represent the "same" logical change. There is no CommitIdentity abstraction to track this.

### 10.4 No Request/Operation Queue

Multiple concurrent operations can race. A queue abstraction would serialize operations and prevent conflicts.

### 10.5 No Undo/History System

Git operations are destructive. There is no application-level undo system (beyond git reflog which requires user knowledge).

### 10.6 No User Preference Validation

Settings (like merge strategy) are stored and used without validation. Invalid values could cause runtime errors.

---

## 11. Non-DRY Patterns

### 11.1 Trunk Detection Logic is Duplicated

The logic for identifying trunk branches (checking canonical names, isTrunk flag, etc.) appears in:

- TrunkResolver
- UiStateBuilder
- PrTargetResolver
- RebaseValidator

Each has slightly different rules, creating inconsistency.

### 11.2 Branch Filtering Logic Repeated

The logic for filtering which branches to include in UI displays is repeated in:

- UiStateBuilder.getFilteredBranches
- enrichStackWithForge
- Various validators

### 11.3 Error Message Construction is Scattered

User-facing error messages are constructed in multiple places:

- In error classes (RebaseOperationError)
- In handlers (dialog messages)
- In validators (errorDetail fields)
- In frontend components (toast messages)

### 11.4 Commit Walking Logic Repeated

Walking backwards through commit history is done in:

- CommitOwnership.calculateCommitOwnership
- StackAnalyzer.collectLineage
- SquashValidator.isAncestor
- PrTargetResolver.findBaseBranch

Each has its own implementation with slightly different stopping conditions.

### 11.5 Working Tree Clean Check Repeated

Checking if working tree is clean appears in:

- RebaseValidator
- SquashValidator
- WorktreeOperation.checkoutBranch
- Several handlers

### 11.6 Branch-at-Commit Lookup Repeated

Finding which branches point to a given commit is done ad-hoc in multiple places rather than using a single indexed lookup.

---

## 12. Naming and Clarity Issues

### 12.1 "Spinoff" vs "Child" vs "Dependent" Terminology

The codebase uses multiple terms for the same concept:

- "spinoff" in UiStack context
- "child" in StackNodeState context
- "dependent" in PR context

These all refer to branches that fork from another branch.

### 12.2 "Intent" vs "Plan" vs "Session" Confusion

Rebase terminology is inconsistent:

- RebaseIntent: The user's desired rebase
- RebasePlan: Combines intent with state
- RebaseState: The execution state
- RebaseSession: Part of RebaseState

The distinction between these is not immediately clear.

### 12.3 "Trunk" vs "Main" vs "Target" Naming

- Trunk: The main branch concept
- Main: Sometimes used interchangeably with trunk
- Target: Sometimes means trunk, sometimes means rebase target

### 12.4 "Head" Overloading

"Head" is used to mean:

- Branch tip SHA (headSha on Branch)
- Git HEAD (the currently checked out commit)
- PR head (the branch being merged)

Context is required to determine meaning.

### 12.5 "Working Tree" vs "Worktree" Distinction

- WorkingTree: Changes in the current working directory
- Worktree: Git worktree feature (multiple working directories)

These are related but distinct concepts with confusingly similar names.

### 12.6 Operation vs Action vs Handler Naming

- XxxOperation: Business logic classes
- XxxHandler: IPC handlers (but some are just function names)
- Actions: Sometimes used for frontend callbacks

The naming convention is not consistently applied.

### 12.7 Boolean Field Naming Inconsistency

Some booleans use "is" prefix, others use "has", others use "can":

- isTrunk, isRemote, isCurrent
- hasChildPrs, hasStaleTarget, hasBaseDrift
- canShip, canSquash, canDelete

While mostly appropriate, the inconsistency in similar contexts is confusing.

### 12.8 Async Function Naming

Some async functions have "Async" suffix, others don't. Most don't, but the inconsistency in remaining cases is noticeable.
