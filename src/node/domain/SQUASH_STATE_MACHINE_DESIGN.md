# SquashStateMachine Design Document

## Executive Summary

This document outlines the architectural approach for extracting a pure `SquashStateMachine` from the current `SquashOperation` implementation. The goal is to achieve the same separation of concerns that exists in the rebase subsystem: pure state transitions (domain) separated from I/O and orchestration (services/operations).

---

## Problem Statement

### Current Architecture Issues

| Aspect           | Current State                                 | Target State                          |
| ---------------- | --------------------------------------------- | ------------------------------------- |
| State Management | Embedded in `SquashOperation.execute()`       | Pure `SquashStateMachine` class       |
| Persistence      | Manual SHA tracking via `Map<string, string>` | Formal session with disk persistence  |
| Recovery         | None (crash loses all progress)               | Resume from persisted state           |
| Testability      | Requires full mocking of git operations       | Pure functions testable in isolation  |
| Job Tracking     | Inline loop over descendants                  | Formal job queue with status tracking |

### What We're Solving

1. **No crash recovery**: If the app crashes during descendant rebasing, there's no way to resume
2. **Tight coupling**: State transitions mixed with git operations
3. **Limited visibility**: No formal job status for UI progress tracking
4. **Testing complexity**: Must mock git adapter for any state transition test

---

## Reference Architecture: RebaseStateMachine

The existing `RebaseStateMachine` provides the template:

```
┌─────────────────────────────────────────────────────────────────┐
│                    RebaseStateMachine                            │
│                    (Pure Functions)                              │
├─────────────────────────────────────────────────────────────────┤
│ createRebasePlan(repo, intent)      → RebasePlan                │
│ createRebaseSession(params)          → RebaseState              │
│ nextJob(state, timestamp)            → NextJobResult            │
│ completeJob(job, sha, timestamp)     → CompleteJobResult        │
│ recordConflict(job, workingTree)     → RebaseJob                │
│ enqueueDescendants(state, parent)    → RebaseState              │
│ resumeRebaseSession(state, tree)     → RebaseState              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     RebaseExecutor                               │
│                  (I/O Orchestration)                             │
├─────────────────────────────────────────────────────────────────┤
│ execute(repoPath, plan, git)         → ExecuteResult            │
│ continue(repoPath)                   → ContinueResult           │
│ abort(repoPath)                      → AbortResult              │
│ skip(repoPath)                       → SkipResult               │
└─────────────────────────────────────────────────────────────────┘
```

**Key Patterns:**

- State machine has NO dependencies on git, file system, or services
- All methods take current state and return new state (immutable)
- Executor owns all I/O and calls state machine for transitions
- Session persistence handled by separate `SessionService`

---

## Proposed Architecture

### Layer Separation

```
┌─────────────────────────────────────────────────────────────────┐
│                   SquashStateMachine                             │
│                   (src/node/domain)                              │
├─────────────────────────────────────────────────────────────────┤
│ Pure state transitions, zero I/O                                 │
│ - createSquashPlan()                                            │
│ - createSquashSession()                                          │
│ - nextDescendantJob()                                            │
│ - completeDescendantJob()                                        │
│ - recordDescendantConflict()                                     │
│ - resumeSquashSession()                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SquashExecutor                                │
│                (src/node/operations)                             │
├─────────────────────────────────────────────────────────────────┤
│ I/O orchestration, git operations                                │
│ - execute() - main squash flow                                   │
│ - continue() - resume after conflict                             │
│ - abort() - rollback and cleanup                                 │
│ - skip() - skip conflicting descendant                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   SquashOperation                                │
│                (src/node/operations)                             │
├─────────────────────────────────────────────────────────────────┤
│ User-facing facade (thin wrapper)                                │
│ - preview()                                                      │
│ - execute()                                                      │
│ - continueSquash()                                               │
│ - abortSquash()                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### State Types

```typescript
// Squash session - tracks overall operation
interface SquashSession {
  id: string
  startedAtMs: number
  status:
    | 'pending'
    | 'applying-patch'
    | 'rebasing-descendants'
    | 'awaiting-user'
    | 'completed'
    | 'aborted'

  // Squash targets
  targetBranch: string // Branch being squashed
  parentBranch: string // Branch receiving changes

  // Original positions for rollback
  originalParentSha: string
  originalTargetSha: string
  originalBranchShas: Map<string, string>

  // Result tracking
  resultCommitSha?: string
  completedAtMs?: number
}

// Descendant rebase job - one per descendant branch
interface SquashJob {
  id: string
  branch: string
  status: 'queued' | 'applying' | 'awaiting-user' | 'completed' | 'skipped'

  originalBaseSha: string
  originalHeadSha: string
  targetBaseSha: string // Where to rebase onto

  rebasedHeadSha?: string // Result after successful rebase
  conflicts?: ConflictFile[]

  createdAtMs: number
  updatedAtMs?: number
}

// Queue state - tracks job execution order
interface SquashQueueState {
  activeJobId?: string
  pendingJobIds: string[]
}

// Complete state snapshot - persisted to disk
interface SquashState {
  session: SquashSession
  jobsById: Record<string, SquashJob>
  queue: SquashQueueState
}
```

### State Machine Methods

```typescript
class SquashStateMachine {
  private constructor() {} // Static-only

  /**
   * Create initial squash plan from validation result.
   * Does NOT start execution - just initializes state.
   */
  static createSquashPlan(params: {
    sessionId: string
    targetBranch: string
    parentBranch: string
    descendantBranches: string[]
    originalShas: Map<string, string>
    timestampMs: number
    generateJobId: () => string
  }): SquashState

  /**
   * Transition to patch application phase.
   * Called after acquiring execution context.
   */
  static beginPatchApplication(state: SquashState, timestampMs: number): SquashState

  /**
   * Record successful patch application.
   * Stores result commit SHA and transitions to descendant rebasing.
   */
  static completePatchApplication(
    state: SquashState,
    resultCommitSha: string,
    timestampMs: number
  ): SquashState

  /**
   * Get next descendant job from queue.
   * Returns null if queue is empty or job is active.
   */
  static nextDescendantJob(
    state: SquashState,
    timestampMs: number
  ): { job: SquashJob; state: SquashState } | null

  /**
   * Mark descendant job as completed with rebased SHA.
   */
  static completeDescendantJob(
    state: SquashState,
    jobId: string,
    rebasedHeadSha: string,
    timestampMs: number
  ): SquashState

  /**
   * Record conflict on active descendant job.
   * Transitions session to awaiting-user.
   */
  static recordDescendantConflict(
    state: SquashState,
    jobId: string,
    conflicts: ConflictFile[],
    timestampMs: number
  ): SquashState

  /**
   * Skip the current conflicting job.
   * Moves to next job or completes if none remain.
   */
  static skipDescendantJob(state: SquashState, jobId: string, timestampMs: number): SquashState

  /**
   * Resume session from persisted state + current git status.
   * Reconciles state if git operations completed externally.
   */
  static resumeSquashSession(params: {
    state: SquashState
    workingTree: WorkingTreeStatus
    timestampMs: number
  }): SquashState

  /**
   * Mark session as aborted.
   */
  static abortSession(state: SquashState, timestampMs: number): SquashState

  /**
   * Finalize session after all jobs complete.
   */
  static finalizeSession(state: SquashState, timestampMs: number): SquashState
}
```

---

## State Transition Diagram

```
                    ┌─────────────┐
                    │   pending   │
                    └─────┬───────┘
                          │ beginPatchApplication()
                          ▼
                 ┌────────────────────┐
                 │  applying-patch    │
                 └────────┬───────────┘
                          │ completePatchApplication()
                          ▼
              ┌───────────────────────────┐
              │  rebasing-descendants     │◄──────────────┐
              └───────────┬───────────────┘               │
                          │ recordDescendantConflict()    │
                          ▼                               │
              ┌───────────────────────────┐               │
              │    awaiting-user          │───────────────┤
              └───────────┬───────────────┘  continue()   │
                          │                               │
                          │ abort()                       │
                          ▼                               │
              ┌───────────────────────────┐               │
              │       aborted             │               │
              └───────────────────────────┘               │
                                                          │
              ┌───────────────────────────┐               │
              │      completed            │◄──────────────┘
              └───────────────────────────┘  finalizeSession()
                                             (when queue empty)
```

---

## Session Persistence

### Storage Strategy

Extend `SessionService` to handle squash sessions:

```typescript
// Option A: Separate store
interface SquashSessionStore {
  getSession(repoPath: string): SquashStoredSession | null
  createSession(repoPath: string, session: SquashStoredSession): void
  updateState(repoPath: string, state: SquashState): void
  clearSession(repoPath: string): void
}

// Option B: Unified session store with discriminant
type StoredSession =
  | { type: 'rebase'; ...RebaseStoredSession }
  | { type: 'squash'; ...SquashStoredSession }
```

**Recommendation:** Option B (unified store) for consistency and simpler conflict detection between operations.

### Recovery Flow

```
App startup / getSession()
         ↓
┌─────────────────────────────────────┐
│ Load from disk                      │
│ - Check for squash session          │
│ - Load state snapshot               │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│ Reconcile with git state            │
│ - Check if git is rebasing          │
│ - Check working tree conflicts      │
│ - Update session status             │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│ Resume or cleanup                   │
│ - If awaiting-user: show dialog     │
│ - If completed: finalize            │
│ - If orphaned: prompt user          │
└─────────────────────────────────────┘
```

---

## Migration Strategy

### Phase 1: Extract Types (Low Risk)

1. Create `src/shared/types/squash-session.ts` with new types
2. Add type exports to `src/shared/types/index.ts`
3. No behavior changes

### Phase 2: Extract State Machine (Medium Risk)

1. Create `src/node/domain/SquashStateMachine.ts`
2. Implement pure state transition methods
3. Add comprehensive unit tests
4. Existing `SquashOperation` unchanged

### Phase 3: Create Executor (Medium Risk)

1. Create `src/node/operations/SquashExecutor.ts`
2. Extract I/O logic from `SquashOperation.execute()`
3. Wire up state machine calls
4. Run integration tests

### Phase 4: Migrate SquashOperation (Higher Risk)

1. Replace inline state management with state machine
2. Add session persistence
3. Implement recovery flow
4. Update all tests

### Phase 5: Add Resumable Operations (Separate Design Doc)

1. Implement `continueSquash()`, `abortSquash()`, `skipSquash()`
2. Add UI integration
3. See: RESUMABLE_CONFLICT_DESIGN.md

---

## Testing Strategy

### Unit Tests (SquashStateMachine.test.ts)

Test each state transition in isolation:

```typescript
describe('SquashStateMachine', () => {
  describe('createSquashPlan', () => {
    it('creates initial state with all descendants as queued jobs')
    it('throws if no parent branch provided')
    it('handles empty descendant list')
  })

  describe('nextDescendantJob', () => {
    it('returns null when active job exists')
    it('returns first pending job and updates queue')
    it('returns null when queue is empty')
  })

  describe('recordDescendantConflict', () => {
    it('marks job as awaiting-user')
    it('stores conflict files on job')
    it('transitions session to awaiting-user')
  })

  describe('resumeSquashSession', () => {
    it('reconciles with completed git rebase')
    it('detects new conflicts from working tree')
    it('handles externally aborted rebase')
  })
})
```

### Integration Tests

Keep existing `SquashOperation.test.ts` tests, add:

```typescript
describe('SquashOperation with state machine', () => {
  it('persists session before starting descendant rebase')
  it('recovers session after simulated crash')
  it('resumes from awaiting-user state')
  it('handles abort during descendant rebasing')
})
```

---

## Files to Create/Modify

| File                                         | Action | Description                |
| -------------------------------------------- | ------ | -------------------------- |
| `src/shared/types/squash-session.ts`         | Create | Session and job types      |
| `src/node/domain/SquashStateMachine.ts`      | Create | Pure state machine         |
| `src/node/domain/SquashStateMachine.test.ts` | Create | Unit tests                 |
| `src/node/operations/SquashExecutor.ts`      | Create | I/O orchestration          |
| `src/node/operations/SquashOperation.ts`     | Modify | Thin facade                |
| `src/node/services/SessionService.ts`        | Modify | Add squash session support |

---

## Open Questions

1. **Unified vs. separate session stores?**
   - Unified is simpler but requires type discrimination
   - Separate allows independent evolution

2. **Should squash sessions block rebase sessions?**
   - Currently: implicit (dirty tree check)
   - Proposed: explicit session conflict detection

3. **How to handle fast-path (empty branch, no descendants)?**
   - Option A: No session needed (current behavior)
   - Option B: Create minimal session for consistency

4. **TransactionService integration?**
   - Current: WAL per-descendant rebase
   - Proposed: Session-level persistence may replace WAL

---

## Success Criteria

1. ✅ All existing squash tests pass
2. ✅ State machine has 100% unit test coverage
3. ✅ Crash during descendant rebase is recoverable
4. ✅ UI can display job progress (X of Y descendants)
5. ✅ No regression in squash operation performance

---

## Appendix: RebaseStateMachine Reference

The following patterns from `RebaseStateMachine` should be replicated:

```typescript
// Pattern 1: Immutable state updates
static nextJob(state: RebaseState, timestampMs: number): NextJobResult {
  // Create new objects, never mutate
  const queue: RebaseQueueState = {
    activeJobId: ensuredJobId,
    pendingJobIds: rest  // New array
  }
  // ...
}

// Pattern 2: Discriminated return types
type NextJobResult =
  | { job: RebaseJob; state: RebaseState }
  | null

// Pattern 3: Timestamp injection (testability)
static recordConflict({
  job,
  workingTree,
  timestampMs,  // Injected, not Date.now()
  stageInfo = {}
}: RecordConflictParams): RebaseJob

// Pattern 4: ID generation injection
static createRebaseSession({
  generateJobId  // Injected, allows deterministic tests
}: StartRebaseSessionParams): RebaseState
```
