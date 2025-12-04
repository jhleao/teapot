# Rebase Implementation Plan

## Executive Summary

This document outlines a comprehensive plan for implementing the rebase functionality in Teapot, a TypeScript-based Git GUI for stacked diffs. The implementation is divided into **Backend** and **UI** tracks, with testing as a cross-cutting concern.

---

## Critical Design Decisions & Constraints

### Multi-Commit Branch Support (REQUIRED)

The current `StackNodeState` uses `commit.parentSha` as `baseSha`, which is **incorrect** for branches with multiple commits. The app must handle multi-commit branches gracefully.

**Rule**: Treat all parent branchless commits as part of the same rebase unit until we reach a commit with a branch pointer.

**Algorithm to compute `baseSha`**:

```text
1. Start at branch head
2. Walk backwards through parent commits
3. Stop when we find a commit that:
   a. Has a branch pointing to it (other than current branch), OR
   b. Is on trunk
4. That commit is the baseSha (the fork point)
```

**Example**:

```text
trunk: A -- B -- C (main)
                  \
feature:           D -- E -- F (feature-branch)
                              \
child:                         G -- H (child-branch)
```

- `feature-branch`: head=F, baseSha=C (walked F->E->D->C, stopped at C because main points there)
- `child-branch`: head=H, baseSha=F (walked H->G->F, stopped at F because feature-branch points there)

**Rebase command**: `git rebase --onto <newBase> <baseSha>` replays all commits from baseSha (exclusive) to HEAD onto newBase.

**Required change**: Refactor `buildStackNodeState` in [src/node/core/utils/build-rebase-intent.ts](src/node/core/utils/build-rebase-intent.ts) to use this walk-back algorithm instead of just `commit.parentSha`.

### Critical Gap: Intent Not Persisted

The current `submitRebaseIntent` builds an intent and uses it for UI projection, but **does not store it**. When `confirmRebaseIntent` is called, there's no way to retrieve the intent.

**Solution**: `RebaseSessionStore` is **required** (not optional) to bridge this gap.

---

## Current State Analysis

### What Exists

1. **Rebase State Machine** ([src/node/core/rebase.ts](src/node/core/rebase.ts))
   - Complete type definitions: `RebaseSession`, `RebaseJob`, `RebaseIntent`, `RebasePlan`
   - Pure state functions: `createRebasePlan`, `createRebaseSession`, `resumeRebaseSession`, `nextJob`, `completeJob`, `recordConflict`, `enqueueDescendants`
   - Working tree decoration for rebase context

2. **Rebase Intent Builder** ([src/node/core/utils/build-rebase-intent.ts](src/node/core/utils/build-rebase-intent.ts))
   - Builds `RebaseIntent` from head/base SHAs
   - Constructs `StackNodeState` tree with child branches

3. **UI State Projection** ([src/node/core/utils/build-ui-state.ts](src/node/core/utils/build-ui-state.ts))
   - `buildFullUiState` with rebase projection
   - `deriveProjectedStack` for preview visualization
   - Tested: [src/node/core/utils/__tests__/build-ui-state.intent.test.ts](src/node/core/utils/__tests__/build-ui-state.intent.test.ts)

4. **Git Adapter** ([src/node/core/git-adapter/](src/node/core/git-adapter/))
   - Interface supports `rebase?()` as optional method
   - `mergeBase()` implemented in `SimpleGitAdapter`
   - `rebase()` and `cherryPick()` defined but NOT implemented

5. **IPC Handlers** ([src/node/handlers/repo.ts](src/node/handlers/repo.ts))
   - `submitRebaseIntent`: Works (builds intent, returns projected UI state)
   - `confirmRebaseIntent`: **TODO stub** (just refreshes repo)
   - `cancelRebaseIntent`: **TODO stub** (just refreshes repo)

6. **UI Components**
   - `DragContext`: Captures drag-drop, calls `submitRebaseIntent`
   - `StackView`: Shows confirm/cancel buttons when `rebaseStatus === 'prompting'`
   - `RebaseStatusBadge`: Visualizes rebase states

### What's Missing

1. **Backend**
   - No actual Git rebase execution
   - No rebase session persistence across IPC calls
   - No conflict resolution flow
   - No branch pointer updates after rebase
   - No "restack" logic (rebase dependent branches after squash-merge)

2. **UI**
   - No conflict resolution UI
   - No rebase progress indication (which commit is being applied)
   - No "abort rebase" button during active rebase
   - No "continue rebase" after resolving conflicts
   - No visual feedback during rebase execution

---

## Architecture Decisions

### 1. Rebase Execution Strategy

**Decision**: Use `git rebase --onto` via `simple-git` rather than cherry-pick loop.

**Rationale**:
- Native Git rebase handles edge cases (empty commits, merge commits)
- Better conflict detection and `.git/rebase-*` state management
- Familiar mental model for users

**Trade-off**: Less granular control, but simpler implementation.

### 2. Session Persistence (REQUIRED)

**Decision**: Store active `RebaseState` in-memory in the main process, keyed by repo path.

**Rationale**:

- **Critical**: `submitRebaseIntent` builds intent but discards it; `confirmRebaseIntent` needs it
- Rebase sessions are short-lived
- Git's `.git/rebase-merge` provides crash recovery
- Avoids database complexity

**Implementation**: New `RebaseSessionStore` singleton that:

1. Stores intent after `submitRebaseIntent`
2. Retrieves intent in `confirmRebaseIntent`
3. Clears on cancel or completion
4. Recovers from `.git/rebase-*` on app restart

### 3. Conflict Resolution Flow

**Decision**: Detect conflicts via `WorkingTreeStatus.conflicted`, pause session, let user resolve in external editor, then continue via IPC.

**Rationale**:
- Teapot focuses on stack visualization, not full IDE
- Integrating a diff/merge editor is out of scope
- Users can use VSCode, etc.

---

## Backend Implementation

### Phase B1: Git Adapter Rebase Support

**Files to modify:**
- [src/node/core/git-adapter/simple-git-adapter.ts](src/node/core/git-adapter/simple-git-adapter.ts)
- [src/node/core/git-adapter/types.ts](src/node/core/git-adapter/types.ts)

**Tasks:**

1. **Implement `rebase()` method**
   ```typescript
   async rebase(dir: string, options: RebaseOptions): Promise<RebaseResult> {
     const git = this.createGit(dir)
     const args = ['--onto', options.onto]
     if (options.from) args.push(options.from)
     args.push(options.to)

     try {
       await git.rebase(args)
       return { success: true, conflicts: [] }
     } catch (error) {
       const status = await this.getWorkingTreeStatus(dir)
       if (status.isRebasing && status.conflicted.length > 0) {
         return { success: false, conflicts: status.conflicted }
       }
       throw error
     }
   }
   ```

2. **Implement rebase control methods**
   ```typescript
   async rebaseContinue(dir: string): Promise<RebaseResult>
   async rebaseAbort(dir: string): Promise<void>
   async rebaseSkip(dir: string): Promise<RebaseResult>
   ```

3. **Add to interface** ([src/node/core/git-adapter/interface.ts](src/node/core/git-adapter/interface.ts))
   ```typescript
   rebaseContinue?(dir: string): Promise<RebaseResult>
   rebaseAbort?(dir: string): Promise<void>
   rebaseSkip?(dir: string): Promise<RebaseResult>
   ```

**Tests:**
- [src/node/core/git-adapter/__tests__/simple-git-adapter.test.ts](src/node/core/git-adapter/__tests__/simple-git-adapter.test.ts)
- Add `describe('rebase')` block with:
  - Simple rebase onto new base
  - Rebase with conflicts
  - Rebase abort
  - Rebase continue after conflict resolution

---

### Phase B2: Rebase Session Management

**New files:**

- `src/node/core/rebase-session-store.ts` - Abstract interface + in-memory implementation
- Future: Swap to electron-store or SQLite for persistence

**Purpose**: Manage active rebase sessions per repository with abstraction for future persistence.

**Interface** (allows swapping implementations later):

```typescript
// Abstract interface - MVP uses in-memory, later swap to electron-store/SQLite
export interface IRebaseSessionStore {
  getSession(repoPath: string): Promise<RebaseSession | null>
  setSession(repoPath: string, session: RebaseSession): Promise<void>
  clearSession(repoPath: string): Promise<void>
  getAllSessions(): Promise<Map<string, RebaseSession>>
}

export type RebaseSession = {
  intent: RebaseIntent
  state: RebaseState
  createdAtMs: number
  updatedAtMs: number
}
```

**MVP Implementation** (in-memory):

```typescript
class InMemoryRebaseSessionStore implements IRebaseSessionStore {
  private sessions: Map<string, RebaseSession> = new Map()

  async getSession(repoPath: string): Promise<RebaseSession | null> {
    return this.sessions.get(repoPath) ?? null
  }

  async setSession(repoPath: string, session: RebaseSession): Promise<void> {
    this.sessions.set(repoPath, session)
  }

  async clearSession(repoPath: string): Promise<void> {
    this.sessions.delete(repoPath)
  }

  async getAllSessions(): Promise<Map<string, RebaseSession>> {
    return new Map(this.sessions)
  }
}

// Export singleton - can be swapped for persistent implementation later
export const rebaseSessionStore: IRebaseSessionStore = new InMemoryRebaseSessionStore()
```

**Future Persistent Implementation** (electron-store):

```typescript
class PersistentRebaseSessionStore implements IRebaseSessionStore {
  private store: Store<{ rebaseSessions: Record<string, RebaseSession> }>

  constructor() {
    this.store = new Store({
      name: 'rebase-sessions',
      defaults: { rebaseSessions: {} }
    })
  }

  async getSession(repoPath: string): Promise<RebaseSession | null> {
    const sessions = this.store.get('rebaseSessions', {})
    return sessions[repoPath] ?? null
  }

  // ... etc
}
```

**Recovery from Git state**:

When app starts, check for `.git/rebase-merge` or `.git/rebase-apply` directories. If present but no session in store, the app crashed mid-rebase. Create a recovery session from Git state.

```typescript
async function recoverFromGitState(repoPath: string): Promise<RebaseSession | null> {
  const status = await gitAdapter.getWorkingTreeStatus(repoPath)
  if (!status.isRebasing) return null

  // Read .git/rebase-merge/head-name to get branch being rebased
  // Read .git/rebase-merge/onto to get target base
  // Construct a recovery RebaseSession
}
```

**Tests:** `src/node/core/__tests__/rebase-session-store.test.ts`

- get/set/clear operations
- getAllSessions
- Recovery from Git state

---

### Phase B2.5: Fix `buildStackNodeState` for Multi-Commit Branches

**File to modify:** [src/node/core/utils/build-rebase-intent.ts](src/node/core/utils/build-rebase-intent.ts)

**Current problem**: Uses `commit.parentSha` as `baseSha`, which only works for single-commit branches.

**New algorithm**:

```typescript
function findBaseSha(
  headSha: string,
  branchRef: string,
  commitMap: Map<string, Commit>,
  branchHeadIndex: Map<string, string[]>  // sha -> branch names pointing to it
): string {
  let currentSha = headSha
  const visited = new Set<string>()

  while (currentSha && !visited.has(currentSha)) {
    visited.add(currentSha)
    const commit = commitMap.get(currentSha)
    if (!commit) break

    const parentSha = commit.parentSha
    if (!parentSha) {
      // Reached root commit
      return currentSha
    }

    // Check if parent has other branches pointing to it
    const branchesAtParent = branchHeadIndex.get(parentSha) ?? []
    const otherBranches = branchesAtParent.filter(b => b !== branchRef)

    if (otherBranches.length > 0) {
      // Parent is a branch point - that's our base
      return parentSha
    }

    currentSha = parentSha
  }

  return currentSha  // Fallback
}
```

**Build branch head index once**:

```typescript
function buildBranchHeadIndex(branches: Branch[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const branch of branches) {
    const existing = index.get(branch.headSha) ?? []
    existing.push(branch.ref)
    index.set(branch.headSha, existing)
  }
  return index
}
```

**Update `buildStackNodeState`**:

```typescript
function buildStackNodeState(
  repo: Repo,
  commitMap: Map<string, Commit>,
  branchHeadIndex: Map<string, string[]>,
  headSha: string,
  branchRef: string,
  visited: Set<string>
): StackNodeState | null {
  // ... existing logic ...

  const baseSha = findBaseSha(headSha, branchRef, commitMap, branchHeadIndex)

  return {
    branch: branchRef,
    headSha,
    baseSha,  // Now correctly computed!
    children
  }
}
```

**Tests:** Add to `src/node/core/utils/__tests__/build-rebase-intent.test.ts`

- Single-commit branch (baseSha = parentSha)
- Multi-commit branch (baseSha = fork point)
- Branch off another branch (baseSha = parent branch head)
- Deep stack (3+ levels)

---

### Phase B3: Rebase Executor Service

**New file:** `src/node/core/rebase-executor.ts`

**Purpose**: Orchestrate the rebase workflow.

```typescript
export type RebaseExecutorResult =
  | { status: 'completed'; newHeadSha: string }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'error'; message: string }

export async function executeRebasePlan(
  repoPath: string,
  plan: RebasePlan
): Promise<RebaseExecutorResult>

export async function continueRebase(
  repoPath: string
): Promise<RebaseExecutorResult>

export async function abortRebase(
  repoPath: string
): Promise<void>
```

**Algorithm for `executeRebasePlan`:**

```text
1. Save current branch (to restore later)
2. Get first job from queue (nextJob)
3. For each job:
   a. git checkout <job.branch>
   b. git rebase --onto <targetBaseSha> <originalBaseSha>
      (Note: rebase operates on current branch, no need to specify tip)
   c. If success:
      - Branch pointer auto-updated by git
      - Resolve new HEAD sha
      - Record commit rewrites (old->new mapping)
      - Mark job complete
      - Enqueue child branches with new base SHA
   d. If conflict:
      - Record conflict in job
      - Leave user on conflicted branch
      - Return { status: 'conflict' }
4. When all jobs complete:
   a. Checkout original branch (or last rebased branch)
   b. Return { status: 'completed' }
```

**Important**: `git rebase --onto A B` rebases current branch. It replays commits from B (exclusive) to HEAD onto A.

**Tests:** `src/node/core/__tests__/rebase-executor.test.ts`
- Single branch rebase
- Stack rebase (multiple dependent branches)
- Conflict handling
- Abort mid-rebase

---

### Phase B4: IPC Handler Implementation

**File to modify:** [src/node/handlers/repo.ts](src/node/handlers/repo.ts)

**New IPC channels to add:** ([src/shared/types/ipc.ts](src/shared/types/ipc.ts))

```typescript
IPC_CHANNELS = {
  // Existing...
  confirmRebaseIntent: 'confirmRebaseIntent',
  cancelRebaseIntent: 'cancelRebaseIntent',
  // New...
  continueRebase: 'continueRebase',
  abortRebase: 'abortRebase',
  skipRebaseCommit: 'skipRebaseCommit',
}
```

**Handler implementations:**

```typescript
const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = async (_event, { repoPath }) => {
  const session = rebaseSessionStore.getSession(repoPath)
  if (!session) {
    throw new Error('No active rebase intent')
  }

  const result = await executeRebasePlan(repoPath, session.plan)

  if (result.status === 'completed') {
    rebaseSessionStore.clearSession(repoPath)
  } else if (result.status === 'conflict') {
    // Session remains active, UI will show conflict state
  }

  return getRepo({} as IpcMainEvent, { repoPath })
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = async (_event, { repoPath }) => {
  rebaseSessionStore.clearSession(repoPath)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const continueRebase: IpcHandlerOf<'continueRebase'> = async (_event, { repoPath }) => {
  const result = await continueRebase(repoPath)
  if (result.status === 'completed') {
    rebaseSessionStore.clearSession(repoPath)
  }
  return getRepo({} as IpcMainEvent, { repoPath })
}

const abortRebase: IpcHandlerOf<'abortRebase'> = async (_event, { repoPath }) => {
  await abortRebase(repoPath)
  rebaseSessionStore.clearSession(repoPath)
  return getRepo({} as IpcMainEvent, { repoPath })
}
```

---

### Phase B5: Enhanced UI State for Rebase

**File to modify:** [src/shared/types/ui.ts](src/shared/types/ui.ts)

Add rebase execution state to `UiState`:

```typescript
export type UiRebaseState =
  | { status: 'idle' }
  | { status: 'planning'; intent: RebaseIntent }
  | { status: 'executing'; currentBranch: string; progress: { completed: number; total: number } }
  | { status: 'conflict'; branch: string; conflicts: string[] }
  | { status: 'error'; message: string }

export type UiState = {
  stack: UiStack
  workingTree: UiWorkingTreeFile[]
  rebase: UiRebaseState  // NEW
}
```

**File to modify:** [src/node/core/utils/build-ui-state.ts](src/node/core/utils/build-ui-state.ts)

Update `buildFullUiState` to include rebase execution state.

---

### Phase B6: Restack After Squash-Merge (OUT OF MVP SCOPE)

**Status**: Deferred to Phase 2. Core rebase must work first.

**New file:** `src/node/core/restack.ts`

**Purpose**: After a squash-merge lands the bottom of a stack, rebase remaining items onto new trunk.

**Why deferred**:

- Requires detecting that a squash-merge happened (comparing trunk before/after)
- Needs to identify which commits were "absorbed" by the squash
- Complex edge cases: what if squash changed content?
- Core rebase is prerequisite

**Future algorithm sketch:**

```text
1. Detect trunk advanced (old trunk SHA != new trunk SHA)
2. Find branches whose base was on old trunk lineage
3. For each such branch:
   a. Compute new base via merge-base with new trunk
   b. Build RebaseIntent
4. Execute rebase plan
```

---

## UI Implementation

### Phase U1: Rebase Context Provider

**New file:** `src/web/contexts/RebaseContext.tsx`

**Purpose**: Centralize rebase state and actions.

```typescript
type RebaseContextValue = {
  rebaseState: UiRebaseState
  confirmRebase: () => Promise<void>
  cancelRebase: () => Promise<void>
  continueRebase: () => Promise<void>
  abortRebase: () => Promise<void>
  skipCommit: () => Promise<void>
}
```

**Rationale**: Separate from `UiStateContext` to avoid bloating that context.

---

### Phase U2: Rebase Progress UI

**New component:** `src/web/components/RebaseProgress.tsx`

Shows during active rebase:
- Current branch being rebased
- Progress: "Rebasing 2/5 branches"
- "Abort" button

```tsx
function RebaseProgress({ state }: { state: UiRebaseState }) {
  if (state.status !== 'executing') return null

  return (
    <div className="bg-accent/20 p-3 rounded-lg">
      <div className="flex items-center gap-2">
        <Spinner />
        <span>Rebasing {state.currentBranch}</span>
      </div>
      <ProgressBar value={state.progress.completed} max={state.progress.total} />
      <button onClick={abortRebase}>Abort</button>
    </div>
  )
}
```

---

### Phase U3: Conflict Resolution UI

**New component:** `src/web/components/ConflictView.tsx`

Shows when rebase has conflicts:
- List of conflicted files
- Instructions to resolve externally
- "Continue" and "Abort" buttons

```tsx
function ConflictView({ state }: { state: UiRebaseState }) {
  if (state.status !== 'conflict') return null

  return (
    <div className="bg-destructive/20 p-4 rounded-lg">
      <h3>Conflicts in {state.branch}</h3>
      <p>Resolve these files, then click Continue:</p>
      <ul>
        {state.conflicts.map(file => <li key={file}>{file}</li>)}
      </ul>
      <div className="flex gap-2 mt-4">
        <button onClick={continueRebase}>Continue</button>
        <button onClick={abortRebase}>Abort</button>
      </div>
    </div>
  )
}
```

---

### Phase U4: Enhanced StackView for Rebase States

**File to modify:** [src/web/components/StackView.tsx](src/web/components/StackView.tsx)

1. **Show which commit is currently being rebased**
   - Add `isRebasing` prop to `CommitView`
   - Animate the commit dot or show spinner

2. **Disable drag during active rebase**
   - Check `rebaseState.status !== 'idle'` in `DragContext`

3. **Visual distinction for queued/completed jobs**
   - Use `rebaseStatus` on `UiCommit` to show:
     - `scheduled`: Gray, waiting
     - `running`: Purple, pulsing
     - `completed`: Green check
     - `failed`: Red X

---

### Phase U5: Topbar Rebase Controls

**File to modify:** [src/web/components/Topbar.tsx](src/web/components/Topbar.tsx)

Add rebase status indicator and controls:

```tsx
function RebaseControls() {
  const { rebaseState, abortRebase } = useRebaseContext()

  if (rebaseState.status === 'idle') return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">
        {rebaseState.status === 'executing' && 'Rebasing...'}
        {rebaseState.status === 'conflict' && 'Conflicts!'}
      </span>
      <button onClick={abortRebase} className="text-sm text-destructive">
        Abort
      </button>
    </div>
  )
}
```

---

### Phase U6: Disable Destructive Actions During Rebase

**Files to modify:**
- [src/web/components/WorkingTreeView.tsx](src/web/components/WorkingTreeView.tsx)
- [src/web/components/BranchBadge.tsx](src/web/components/BranchBadge.tsx)

When rebase is active:
- Disable commit/amend buttons
- Disable branch delete
- Disable checkout to different branch
- Show tooltip explaining why

---

## Refactoring & Cleanup

### R1: Delete Unused FullUiState Complexity

The `@TODO` comment in `build-ui-state.ts` suggests simplifying `FullUiState`.

**Action**: After rebase works, evaluate if we can:
1. Remove `FullUiState` type
2. Have handlers compose lower-level functions directly
3. Simplify `buildFullUiState` signature

**Defer** until core rebase is stable.

---

### R2: Consolidate Rebase Types

Currently rebase types are split:
- [src/node/core/rebase.ts](src/node/core/rebase.ts) - Core types + state functions
- [src/shared/types/index.ts](src/shared/types/index.ts) - Re-exports

**Action**: Keep as-is. The split makes sense (core logic vs shared types).

---

### R3: Extract Stack Manipulation Utilities

The `build-rebase-intent.ts` and `build-ui-state.ts` have overlapping logic for traversing stacks.

**Action**: Create `src/node/core/utils/stack-traversal.ts`:
```typescript
export function findBranchByHead(branches: Branch[], headSha: string): Branch | null
export function findChildBranches(branches: Branch[], parentHeadSha: string): Branch[]
export function walkStack(root: StackNodeState, visitor: (node: StackNodeState) => void): void
```

---

## Testing Strategy

### Unit Tests

| Component | Test File | Key Scenarios |
|-----------|-----------|---------------|
| Git Adapter Rebase | `git-adapter/__tests__/simple-git-adapter.test.ts` | rebase --onto, conflicts, abort, continue |
| Session Store | `__tests__/rebase-session-store.test.ts` | set/get/clear, recovery from Git state |
| Rebase Executor | `__tests__/rebase-executor.test.ts` | single branch, stack, conflicts, abort |
| UI State Builder | `utils/__tests__/build-ui-state.rebase.test.ts` | executing state, conflict state |

### Integration Tests

**New file:** `src/node/core/__tests__/rebase-integration.test.ts`

End-to-end tests using real Git repos:
1. Create stack of 3 branches
2. Execute rebase to new base
3. Verify all branch pointers updated
4. Verify commit graph is correct

### Manual Test Scenarios

1. **Happy Path**
   - Drag commit to new location
   - Confirm rebase
   - Verify stack reorganized

2. **Conflict Resolution**
   - Create conflicting changes
   - Start rebase
   - Resolve in editor
   - Continue rebase
   - Verify completion

3. **Abort**
   - Start rebase
   - Abort mid-way
   - Verify original state restored

4. **Process Restart**
   - Start rebase
   - Kill app
   - Restart
   - Verify rebase state recovered

---

## Implementation Order

### Sprint 1: Core Backend

1. B2: Session store with abstraction (FIRST - required for confirm to work)
2. B2.5: Fix `buildStackNodeState` for multi-commit branches
3. B1: Git Adapter rebase methods
4. B3: Rebase executor (basic single-job)
5. B4: IPC handlers (confirm/cancel)

### Sprint 2: Multi-Branch & Conflicts

1. B3: Multi-job execution with child enqueueing
2. B3: Conflict detection in executor
3. B4: Continue/abort/skip handlers
4. U3: Conflict UI

### Sprint 3: UI Polish

1. U1: Rebase context
2. U2: Progress UI
3. U4: StackView enhancements
4. U5: Topbar controls
5. U6: Action disabling

### Sprint 4: Hardening

1. Integration tests with real Git repos
2. Edge case handling (empty commits, merge commits)
3. R3: Stack traversal refactor (if needed)

### Future (Post-MVP)

- B6: Restack after squash-merge

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Git rebase edge cases | Use native `git rebase --onto`, extensive tests |
| State corruption on crash | Recover from `.git/rebase-*` on restart |
| UI becomes unresponsive | Run Git operations in worker thread |
| Merge conflicts block user | Clear abort path, external editor workflow |

---

## Files to Create

| Path | Purpose |
|------|---------|
| `src/node/core/rebase-session-store.ts` | Session management |
| `src/node/core/rebase-executor.ts` | Orchestration |
| `src/node/core/restack.ts` | Squash-merge handling |
| `src/node/core/__tests__/rebase-session-store.test.ts` | Tests |
| `src/node/core/__tests__/rebase-executor.test.ts` | Tests |
| `src/node/core/__tests__/rebase-integration.test.ts` | Integration tests |
| `src/web/contexts/RebaseContext.tsx` | UI state |
| `src/web/components/RebaseProgress.tsx` | Progress UI |
| `src/web/components/ConflictView.tsx` | Conflict UI |

## Files to Modify

| Path | Changes |
|------|---------|
| `src/node/core/git-adapter/simple-git-adapter.ts` | Add rebase/continue/abort |
| `src/node/core/git-adapter/interface.ts` | Add method signatures |
| `src/node/handlers/repo.ts` | Implement confirm/cancel/continue/abort |
| `src/shared/types/ipc.ts` | Add new channels |
| `src/shared/types/ui.ts` | Add UiRebaseState |
| `src/node/core/utils/build-ui-state.ts` | Include rebase state |
| `src/web/components/StackView.tsx` | Rebase state visualization |
| `src/web/components/Topbar.tsx` | Rebase controls |
| `src/web/contexts/DragContext.tsx` | Disable during rebase |
| `src/web/contexts/UiStateContext.tsx` | Add new API methods |

## Files to Delete

None identified. The existing code provides a solid foundation.

---

## Success Criteria

1. User can drag-drop to rearrange stack
2. Rebase executes and updates all branch pointers
3. Conflicts are detected and shown to user
4. User can resolve conflicts externally and continue
5. User can abort at any point
6. App recovers from mid-rebase crash
7. All dependent branches are automatically restacked

---

## Critical Review Notes

This section documents issues found during plan review and their resolutions.

### Issue 1: Intent Not Persisted Between IPC Calls

**Problem**: `submitRebaseIntent` builds and projects an intent, then discards it. `confirmRebaseIntent` has no way to retrieve it.

**Resolution**: Session store is REQUIRED, not optional. Changed implementation order to do B2 first.

### Issue 2: `baseSha` Semantics (FIXED)

**Problem**: `StackNodeState.baseSha` is set to `commit.parentSha`, which only works for single-commit branches.

**Resolution**: Added Phase B2.5 to fix `buildStackNodeState`. New algorithm walks back through commits until finding one with another branch pointing to it. This correctly handles:

- Single-commit branches (baseSha = parent, same as before)
- Multi-commit branches (baseSha = fork point where branch diverged)
- Stacked branches (baseSha = parent branch's head)

### Issue 3: Missing Checkout Steps

**Problem**: `git rebase` operates on the current branch. Original plan didn't explicitly include checkout.

**Resolution**: Updated algorithm to include:

- Save current branch before starting
- Checkout each branch before rebasing it
- Restore original branch (or stay on last) after completion

### Issue 4: Restack Complexity

**Problem**: Restack after squash-merge is complex and depends on core rebase.

**Resolution**: Moved to "Future (Post-MVP)" phase.

### Issue 5: UI During Active Rebase

**Problem**: What should `buildUiStack` return when repo is mid-rebase?

**Resolution**: During active rebase, show progress overlay rather than trying to render a potentially inconsistent commit graph. The session store tracks progress.
