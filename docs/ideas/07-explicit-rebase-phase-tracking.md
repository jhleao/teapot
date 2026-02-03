# Idea: Explicit Phase Tracking for Rebase State Machine

**Source:** `docs/post-mortems/2025-01-resume-rebase-queue-dialog.md`
**Status:** Partially Implemented - Infrastructure exists but not integrated
**Priority:** Medium (reduced from High - foundation work complete)

---

## Implementation Status (Reviewed 2025-01)

### What Was Built ✅

A sophisticated state machine infrastructure exists in `src/node/domain/RebasePhase.ts`:

**Phase Types** - More comprehensive than originally proposed (8 phases vs 4):

- `idle` - No rebase in progress
- `planning` - User previewing/configuring rebase intent
- `queued` - Intent confirmed, waiting to start execution
- `executing` - Git rebase in progress
- `conflicted` - Rebase paused due to conflict
- `finalizing` - All jobs done, cleaning up
- `completed` - Rebase finished successfully
- `error` - Rebase failed with error

**Rich Phase Interfaces** - Each phase carries typed contextual data:

```typescript
interface ExecutingPhase extends PhaseBase {
  kind: 'executing'
  intent: RebaseIntent
  state: RebaseState
  executionPath: string
  isTemporaryWorktree: boolean
  activeJob: RebaseJob // Currently executing job
}
```

**Transition Validation** - Pure `transition()` function with `InvalidTransitionError`:

```typescript
export function transition(phase: RebasePhase, event: RebaseEvent): RebasePhase
export function canTransition(phase: RebasePhase, eventType: RebaseEvent['type']): boolean
export class InvalidTransitionError extends Error { ... }
```

**Typed Events** - 12 distinct event types for state transitions.

### What's NOT Integrated ❌

1. **`RebaseSession` still uses legacy status** (`src/shared/types/rebase.ts:24-36`):

   ```typescript
   export type RebaseSession = {
     status: RebaseSessionStatus // 'pending' | 'running' | 'awaiting-user' | 'aborted' | 'completed'
     // NO phase field!
   }
   ```

2. **`deriveRebaseProjection` still infers state** (`src/node/domain/UiStateBuilder.ts:747-795`):

   ```typescript
   // The exact fragile pattern this idea warned against:
   const isStillPlanning =
     !session.queue.activeJobId && // Signal 1
     !repo.workingTreeStatus.isRebasing && // Signal 2
     options.rebaseIntent // Signal 3
   ```

3. **No phase persistence** - `StoredRebaseSession` in `src/node/store.ts` doesn't store phase.

4. **No transition logging** - Phase changes aren't tracked for debugging.

5. **Services not updated** - `SessionService`, `RebaseExecutor` don't use `RebasePhase`.

### Remaining Work

1. Add `phase: RebasePhase` to `RebaseSession` type
2. Update `StoredRebaseSession` to persist phases
3. Replace signal inference in `deriveRebaseProjection` with phase-based switch
4. Integrate transition calls in `SessionService` and `RebaseExecutor`
5. Add phase transition logging

---

## Problem Context

A bug caused the "Resume Rebase Queue?" dialog to appear instead of the Confirm/Cancel rebase preview. Root cause was that `deriveRebaseProjection()` inferred state from session existence rather than tracking phase explicitly.

The rebase flow has distinct phases:

- **Planning**: User sees preview, can confirm or cancel
- **Executing**: Rebase is running
- **Awaiting User**: Conflict occurred, waiting for resolution
- **Completed**: All jobs done

But the code inferred phase from multiple signals:

- Session existence
- `activeJobId` presence
- `isRebasing` git state
- Intent presence

This inference was fragile and caused state confusion.

## Proposed Solution

Add explicit `phase` field to session state:

```typescript
type RebasePhase =
  | 'planning' // Preview shown, awaiting confirmation
  | 'executing' // Jobs running
  | 'paused' // Conflict or error, awaiting user
  | 'completed' // All done

interface RebaseSession {
  phase: RebasePhase
  queue: RebaseQueue
  intent?: RebaseIntent
  // ...
}
```

### Benefits

1. **Clear state transitions**: No inference needed
2. **Explicit guards**: Validate phase before operations
3. **Debuggability**: Log phase transitions
4. **UI simplicity**: Map phase directly to UI state

### Transition Rules

```
            ┌──────────┐
            │ planning │
            └────┬─────┘
                 │ confirm
                 ▼
            ┌──────────┐
       ┌────│ executing │◄────┐
       │    └────┬─────┘     │
       │         │ conflict  │ continue
       │         ▼           │
       │    ┌──────────┐     │
       │    │  paused  │─────┘
       │    └────┬─────┘
       │         │ abort
       │         ▼
       │    ┌──────────┐
       └───►│ completed │
            └──────────┘
```

## Implementation

1. Add `phase` field to `RebaseSession` type
2. Update `SessionService` to set phase on transitions
3. Update `deriveRebaseProjection` to use `session.phase` directly
4. Add phase transition logging for debugging
5. Add guards to prevent invalid transitions

## Related Improvements

From same post-mortem:

- State Immutability During Operations (see idea 08)
- Integration tests for full rebase workflow

---

## Architecture Design Decision

### ADR-001: Explicit Phase Field in Session

**Decision:** Add `phase: RebasePhase` as a required field in `RebaseSession`, not derived from other fields.

**Rationale:**

- Eliminates inference bugs (the root cause of the post-mortem issue)
- Phase is the single source of truth for UI rendering
- State machine transitions are explicit and auditable
- Simplifies `deriveRebaseProjection` to a simple switch on `phase`

**Alternatives Considered:**

1. **Keep inference with better logic**: Rejected - inference is inherently fragile
2. **Separate state machine service**: Rejected - over-engineering for simple transitions
3. **Event sourcing**: Rejected - adds complexity, overkill for this use case

### ADR-002: Transition Validation

**Decision:** Validate phase transitions and throw if invalid.

**Rationale:**

- Catches bugs early (invalid transition = programming error)
- Documents valid transitions in code
- Prevents silent corruption of session state

### ADR-003: Phase Transition Logging

**Decision:** Log every phase transition with previous and new phase.

**Rationale:**

- Essential for debugging state issues
- Creates audit trail for support tickets
- Low overhead (one log per transition)

---

## First Implementation Steps

### Step 1: Define Phase Type (30 min)

```typescript
// src/shared/types/rebase.ts
export type RebasePhase =
  | 'planning' // Preview shown, awaiting confirmation
  | 'executing' // Jobs running
  | 'paused' // Conflict or user action required
  | 'completed' // All done, session can be cleared

export interface RebaseSession {
  phase: RebasePhase
  queue: RebaseQueue
  activeJobId?: string
  intent?: RebaseIntent
  startedAt: number
  // ...existing fields
}
```

### Step 2: Add Transition Validation (1 hour)

```typescript
// src/node/services/SessionService.ts
const VALID_TRANSITIONS: Record<RebasePhase, RebasePhase[]> = {
  planning: ['executing', 'completed'], // confirm or cancel
  executing: ['paused', 'completed'], // conflict or done
  paused: ['executing', 'completed'], // continue or abort
  completed: ['planning'] // start new session
}

function validateTransition(from: RebasePhase, to: RebasePhase): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid phase transition: ${from} -> ${to}`)
  }
}

export function setSessionPhase(repoPath: string, newPhase: RebasePhase): void {
  const session = getSession(repoPath)
  if (!session) throw new Error('No active session')

  validateTransition(session.phase, newPhase)

  log.info('[Session] Phase transition', {
    from: session.phase,
    to: newPhase,
    repoPath
  })

  session.phase = newPhase
  persistSession(repoPath, session)
}
```

### Step 3: Update Session Creation (30 min)

```typescript
// src/node/services/SessionService.ts
export function createSession(
  repoPath: string,
  queue: RebaseQueue,
  intent?: RebaseIntent
): RebaseSession {
  const session: RebaseSession = {
    phase: 'planning', // Always start in planning
    queue,
    intent,
    startedAt: Date.now()
  }

  persistSession(repoPath, session)
  return session
}
```

### Step 4: Simplify deriveRebaseProjection (1 hour)

```typescript
// src/node/domain/deriveRebaseProjection.ts
export function deriveRebaseProjection(session: RebaseSession | null): RebaseProjection {
  if (!session) {
    return { status: 'idle' }
  }

  // Direct mapping from phase - no inference!
  switch (session.phase) {
    case 'planning':
      return { status: 'prompting', queue: session.queue }
    case 'executing':
      return { status: 'executing', activeJobId: session.activeJobId! }
    case 'paused':
      return { status: 'awaiting-user', queue: session.queue }
    case 'completed':
      return { status: 'completed' }
  }
}
```

### Step 5: Update Operation Handlers (1 hour)

```typescript
// src/node/handlers/rebaseHandlers.ts
async function handleConfirmRebase(repoPath: string): Promise<void> {
  setSessionPhase(repoPath, 'executing')
  await startRebaseExecution(repoPath)
}

async function handleRebaseConflict(repoPath: string): Promise<void> {
  setSessionPhase(repoPath, 'paused')
}

async function handleRebaseComplete(repoPath: string): Promise<void> {
  setSessionPhase(repoPath, 'completed')
  clearSession(repoPath)
}
```

---

## Risks and Mitigations

| Risk                           | Mitigation                                        |
| ------------------------------ | ------------------------------------------------- |
| Migration of existing sessions | Default to 'executing' for sessions without phase |
| Missed transition call         | Audit all rebase-related code paths               |
| Phase/actual state mismatch    | Integration tests verify phase matches git state  |

---

## Senior Architect Review (2025-01)

### Executive Summary

**Verdict: INCOMPLETE IMPLEMENTATION - Technical debt accumulating**

This idea addresses a real architectural problem (state inference bugs) with a sound solution (explicit phase tracking). However, the implementation is stuck in a problematic intermediate state: sophisticated infrastructure exists but remains disconnected from production code paths. The codebase now carries **two parallel state systems** creating confusion, maintenance burden, and leaving the original bug class unfixed.

**Recommendation:** Either complete the integration or remove `RebasePhase.ts`. The current state is the worst of both worlds.

---

### 1. Problem Validation

**Is the original problem real?** Yes.

The post-mortem describes `deriveRebaseProjection()` inferring state from multiple signals:

```typescript
const isStillPlanning =
  !session.queue.activeJobId && // Signal 1
  !repo.workingTreeStatus.isRebasing && // Signal 2
  options.rebaseIntent // Signal 3
```

This pattern is **still present** in `UiStateBuilder.ts:754-755`. The bug class that motivated this idea remains exploitable.

**Why is signal inference problematic?**

1. **Combinatorial explosion** - With 3 signals, there are 8 possible states to reason about. As signals grow, complexity grows exponentially.
2. **Temporal coupling** - Signals may update at different times, creating invalid intermediate states.
3. **Hidden assumptions** - The inference logic embeds implicit assumptions about what combinations are "legal" without documenting or enforcing them.
4. **Debugging difficulty** - When the wrong UI appears, you must mentally replay signal states rather than reading a single phase value.

---

### 2. Solution Design Assessment

**Is the proposed solution sound?** Yes, with caveats.

#### Strengths of `RebasePhase.ts`

| Aspect                    | Assessment                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Type safety**           | Excellent. Discriminated unions enable exhaustive matching; compiler catches missing cases.                 |
| **Purity**                | Excellent. `transition()` is a pure function - easy to test, reason about, and compose.                     |
| **Rich context**          | Good. Each phase carries relevant data (e.g., `ExecutingPhase.activeJob`, `ConflictedPhase.conflictFiles`). |
| **Transition validation** | Good. Invalid transitions throw `InvalidTransitionError` with diagnostic info.                              |
| **Traceability**          | Good. `correlationId` and `enteredAtMs` support debugging and telemetry.                                    |

#### Design Concerns

**1. Over-engineering risk**

The implemented 8-phase model is more complex than the original 4-phase proposal:

- Original: `planning → executing → paused → completed`
- Implemented: `idle → planning → queued → executing → conflicted → finalizing → completed → error`

This added complexity may be justified (e.g., `queued` separates confirmation from execution, `error` enables structured recovery), but it also increases the integration burden. The question is: **does the codebase actually need these distinctions?**

Examining `RebaseExecutor.ts` and `SessionService.ts`, the current code uses:

- `RebaseSessionStatus`: `'pending' | 'running' | 'awaiting-user' | 'aborted' | 'completed'`

The 5-value enum maps reasonably to the 8-phase model, but the mapping isn't 1:1. `queued` vs `pending`, `conflicted` vs `awaiting-user`, and `finalizing` are new distinctions that would require changes to existing logic.

**2. Parallel state systems (critical issue)**

The codebase now has:

| System                | Location                                | Used in production?         |
| --------------------- | --------------------------------------- | --------------------------- |
| `RebaseSessionStatus` | `shared/types/rebase.ts`                | ✅ Yes - everywhere         |
| `RebasePhase`         | `node/domain/RebasePhase.ts`            | ❌ No - exported but unused |
| Signal inference      | `UiStateBuilder.deriveRebaseProjection` | ✅ Yes - drives UI          |

This is the **worst possible state**: infrastructure cost without benefit, plus developer confusion about which system to use.

**3. Missing integration layer**

The `RebasePhase.ts` module is a **library** - it defines types and pure functions. But there's no **service** that:

- Maintains current phase as authoritative state
- Dispatches events to trigger transitions
- Persists phase to `StoredRebaseSession`
- Logs phase transitions for debugging

Without this integration layer, the library is dead code.

---

### 3. Gap Analysis: What's Missing

| Component                               | Current State                     | Required for Integration                |
| --------------------------------------- | --------------------------------- | --------------------------------------- |
| `RebaseSession` type                    | Has `status: RebaseSessionStatus` | Need `phase: RebasePhase`               |
| `StoredRebaseSession`                   | No phase field                    | Need `phase` persisted to disk          |
| `SessionService`                        | CRUD for sessions                 | Need `transitionPhase(event)` method    |
| `RebaseExecutor`                        | Uses `session.status` checks      | Need `session.phase.kind` checks        |
| `UiStateBuilder.deriveRebaseProjection` | Infers from signals               | Should switch on `session.phase.kind`   |
| Phase logging                           | None                              | Need telemetry on every transition      |
| Migration                               | N/A                               | Need to handle sessions without `phase` |

---

### 4. Risk Analysis

**If we complete integration:**

| Risk                                  | Severity | Likelihood | Mitigation                                             |
| ------------------------------------- | -------- | ---------- | ------------------------------------------------------ |
| **Breaking persisted sessions**       | High     | Medium     | Add schema version; migrate `status` → `phase` on load |
| **Transition missed in code path**    | Medium   | High       | Add invariant: assert `phase.kind` before operations   |
| **Phase desync after crash**          | Medium   | Low        | Recovery: derive phase from git state as fallback      |
| **Regression in UI state derivation** | High     | Medium     | Comprehensive tests before removing signal inference   |
| **Extended development time**         | Medium   | Medium     | Integration touches 5+ files across layers             |

**If we remove `RebasePhase.ts`:**

| Risk                              | Severity | Likelihood | Mitigation                                                |
| --------------------------------- | -------- | ---------- | --------------------------------------------------------- |
| **Wasted prior work**             | Low      | Certain    | Accept sunk cost; clear codebase is more valuable         |
| **Original bug class persists**   | Medium   | Certain    | Improve signal inference logic; add more defensive checks |
| **Lose architectural foundation** | Medium   | Certain    | Document decision; can rebuild if needed later            |

**If we do nothing (status quo):**

| Risk                            | Severity | Likelihood | Mitigation                                     |
| ------------------------------- | -------- | ---------- | ---------------------------------------------- |
| **Developer confusion**         | Medium   | High       | Document which system is authoritative         |
| **Maintenance burden**          | Medium   | Certain    | Two systems to understand and maintain         |
| **Original bug class persists** | Medium   | Certain    | None - this is the stated problem              |
| **Technical debt compounds**    | High     | High       | Harder to change later as more code is written |

---

### 5. Alternative Approaches

Before committing to full integration, consider lighter alternatives:

**Alternative A: Minimal Phase Field**

Add a simple `phase: 'planning' | 'executing' | 'paused' | 'completed'` to `RebaseSession` without the rich context data. Use it as single source of truth for `deriveRebaseProjection()`. Keep `RebasePhase.ts` as reference material or delete it.

- **Pros:** Solves the inference problem with minimal change; easier migration
- **Cons:** Loses the rich type-safe event system; may need to add complexity later

**Alternative B: Fix Signal Inference**

Instead of explicit phases, improve the inference logic:

- Document all valid signal combinations
- Add assertions for invalid combinations
- Add logging when state is derived

- **Pros:** No schema change; no migration
- **Cons:** Doesn't address fundamental fragility; adds defensive code instead of removing the problem

**Alternative C: Full Integration (Current Proposal)**

Integrate `RebasePhase.ts` as designed.

- **Pros:** Type-safe, auditable, future-proof
- **Cons:** Largest change; highest risk; requires careful migration

---

### 6. Recommendation

**Recommended path: Alternative A (Minimal Phase Field)**

The full `RebasePhase.ts` implementation is elegant but may be over-engineered for current needs. A simpler approach:

1. Add `phase: 'planning' | 'executing' | 'conflicted' | 'completed'` to `RebaseSession`
2. Set phase explicitly in `SessionService` methods
3. Update `deriveRebaseProjection()` to switch on `session.phase`
4. Add phase transition logging
5. Deprecate signal inference path
6. **Either** adapt `RebasePhase.ts` to match this simpler model, **or** delete it

This achieves the core goal (eliminate inference bugs) with less integration risk.

**If full integration is preferred:**

1. Treat it as a multi-sprint project
2. Add feature flag to toggle between old/new systems
3. Migrate incrementally with parallel validation
4. Have comprehensive test coverage before removing old code

---

### 7. Decision Required

The team must decide:

| Option                         | Effort   | Risk        | Outcome                                      |
| ------------------------------ | -------- | ----------- | -------------------------------------------- |
| **A. Minimal phase field**     | 1-2 days | Low         | Solves inference problem pragmatically       |
| **B. Full integration**        | 3-5 days | Medium      | Realizes full vision with type-safe events   |
| **C. Remove `RebasePhase.ts`** | 1 hour   | None        | Cleans up dead code; leaves problem unsolved |
| **D. Do nothing**              | 0        | High (debt) | Technical debt continues to accumulate       |

**My recommendation: Option A**, with Option C as fallback if A proves harder than expected.

---

### 8. Prior Analysis Superseded

This review supersedes the previous "Senior Architect Analysis" section which focused primarily on the dual-state anti-pattern. That concern remains valid but this review provides a more complete assessment including alternative approaches and concrete decision options.

---

## Implementation Specifications

This section provides detailed implementation plans for each option to support tech lead decision-making.

---

### Option A: Minimal Phase Field

**Goal:** Add a simple phase field to eliminate signal inference without the full `RebasePhase.ts` complexity.

#### A.1 Type Changes

**File: `src/shared/types/rebase.ts`**

```typescript
// NEW: Simple phase type
export type RebaseSessionPhase =
  | 'planning' // User previewing, can confirm/cancel
  | 'executing' // Jobs actively running
  | 'conflicted' // Paused on conflict, awaiting user
  | 'completed' // All done

// UPDATED: Add phase to RebaseSession
export type RebaseSession = {
  id: string
  startedAtMs: number
  completedAtMs?: number
  status: RebaseSessionStatus // Keep temporarily for backwards compat
  phase: RebaseSessionPhase // NEW - single source of truth
  initialTrunkSha: string
  finalTrunkSha?: string
  jobs: RebaseJobId[]
  commitMap: CommitRewrite[]
}
```

**File: `src/node/store.ts`**

```typescript
export type StoredRebaseSession = {
  intent: RebaseIntent
  state: RebaseState
  phase: RebaseSessionPhase // NEW
  version: number
  createdAtMs: number
  updatedAtMs: number
  originalBranch: string
  autoDetachedWorktrees?: DetachedWorktree[]
}
```

#### A.2 SessionService Changes

**File: `src/node/services/SessionService.ts`**

```typescript
// Update createSession to set initial phase
export function createSession(
  repoPath: string,
  plan: RebasePlan,
  originalBranch: string,
  autoDetachedWorktrees?: DetachedWorktree[]
): void {
  const key = normalizePath(repoPath)
  if (sessionStore.has(key)) {
    throw new Error('Session already exists')
  }

  const now = Date.now()
  sessionStore.set(key, {
    intent: plan.intent,
    state: plan.state,
    phase: 'planning', // NEW - always start in planning
    originalBranch,
    autoDetachedWorktrees,
    version: 1,
    createdAtMs: now,
    updatedAtMs: now
  })
}

// NEW function for phase transitions
export function setPhase(repoPath: string, phase: RebaseSessionPhase): void {
  const key = normalizePath(repoPath)
  const existing = sessionStore.get(key)
  if (!existing) {
    throw new Error(`Session not found: ${repoPath}`)
  }

  log.info('[SessionService] Phase transition', {
    repoPath,
    from: existing.phase,
    to: phase
  })

  sessionStore.set(key, {
    ...existing,
    phase,
    version: existing.version + 1,
    updatedAtMs: Date.now()
  })
}
```

#### A.3 UiStateBuilder Changes

**File: `src/node/domain/UiStateBuilder.ts`**

Replace signal inference with phase-based switch:

```typescript
private static deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
  // No session = check for intent-only preview
  if (!options.rebaseSession) {
    const intent = options.rebaseIntent
    if (!intent || intent.targets.length === 0) {
      return { kind: 'idle' }
    }
    const generateJobId = options.generateJobId ?? this.createDefaultPreviewJobIdGenerator()
    const plan = RebaseStateMachine.createRebasePlan({ repo, intent, generateJobId })
    return { kind: 'planning', plan }
  }

  // Session exists - use phase directly (NO INFERENCE!)
  const session = options.rebaseSession
  switch (session.phase) {
    case 'planning': {
      const generateJobId = options.generateJobId ?? this.createDefaultPreviewJobIdGenerator()
      const plan = RebaseStateMachine.createRebasePlan({
        repo,
        intent: session.intent,
        generateJobId
      })
      return { kind: 'planning', plan }
    }
    case 'executing':
    case 'conflicted':
      return { kind: 'rebasing', session: session.state }
    case 'completed':
      return { kind: 'idle' }
  }
}
```

#### A.4 RebaseExecutor Integration

**File: `src/node/operations/RebaseExecutor.ts`**

Add phase transitions at key points:

```typescript
// After session creation, before execution starts
SessionService.setPhase(repoPath, 'executing')

// In handleConflict()
SessionService.setPhase(repoPath, 'conflicted')

// In continue() after conflict resolved
SessionService.setPhase(repoPath, 'executing')

// In finalizeRebase()
SessionService.setPhase(repoPath, 'completed')
```

#### A.5 Migration Logic

**File: `src/node/services/SessionService.ts`**

```typescript
// In SessionStore.get()
get(key: string): StoredRebaseSession | null {
  if (!this.memory.has(key)) {
    const persisted = this.disk.getRebaseSession(key)
    if (persisted) {
      // Migration: derive phase from old status if missing
      if (!persisted.phase) {
        persisted.phase = this.migrateStatusToPhase(persisted.state.session.status)
        // Re-persist with phase
        this.disk.setRebaseSession(key, persisted)
      }
      this.memory.set(key, persisted)
    }
  }
  return this.memory.get(key) ?? null
}

private migrateStatusToPhase(status: RebaseSessionStatus): RebaseSessionPhase {
  switch (status) {
    case 'pending': return 'planning'
    case 'running': return 'executing'
    case 'awaiting-user': return 'conflicted'
    case 'completed': return 'completed'
    case 'aborted': return 'completed'
  }
}
```

#### A.6 Files Changed Summary

| File                                    | Change Type | Description                                               |
| --------------------------------------- | ----------- | --------------------------------------------------------- |
| `src/shared/types/rebase.ts`            | Modify      | Add `RebaseSessionPhase`, add `phase` to `RebaseSession`  |
| `src/node/store.ts`                     | Modify      | Add `phase` to `StoredRebaseSession`                      |
| `src/node/services/SessionService.ts`   | Modify      | Add `setPhase()`, update `createSession()`, add migration |
| `src/node/domain/UiStateBuilder.ts`     | Modify      | Replace inference with switch on `phase`                  |
| `src/node/operations/RebaseExecutor.ts` | Modify      | Add `setPhase()` calls at transitions                     |
| `src/node/domain/RebaseStateMachine.ts` | Modify      | Set initial phase in `createRebaseSession`                |

#### A.7 What Happens to RebasePhase.ts?

Two sub-options:

- **A.keep**: Leave `RebasePhase.ts` as reference/documentation
- **A.delete**: Remove `RebasePhase.ts` and exports from `domain/index.ts`

Recommend **A.delete** to eliminate confusion about which system to use.

#### A.8 Effort Breakdown

| Task                       | Estimate     |
| -------------------------- | ------------ |
| Type changes               | 30 min       |
| SessionService changes     | 1 hour       |
| UiStateBuilder refactor    | 1-2 hours    |
| RebaseExecutor integration | 1 hour       |
| Migration logic            | 30 min       |
| Testing                    | 2-3 hours    |
| **Total**                  | **1-2 days** |

---

### Option B: Full Integration of RebasePhase.ts

**Goal:** Integrate the existing `RebasePhase.ts` state machine as the authoritative source, with typed events and transition validation.

#### B.1 Type Changes

**File: `src/shared/types/rebase.ts`**

```typescript
import type { RebasePhase } from '@node/domain/RebasePhase'

export type RebaseSession = {
  id: string
  startedAtMs: number
  completedAtMs?: number
  status: RebaseSessionStatus // DEPRECATED - keep for migration
  phase: RebasePhase // NEW - authoritative state
  initialTrunkSha: string
  finalTrunkSha?: string
  jobs: RebaseJobId[]
  commitMap: CommitRewrite[]
}
```

**File: `src/node/store.ts`**

```typescript
// Serializable version of RebasePhase for persistence
export type StoredPhase = {
  kind: RebasePhase['kind']
  enteredAtMs: number
  correlationId: string
  data?: {
    intentId?: string
    activeJobId?: string
    conflictFiles?: string[]
    executionPath?: string
    isTemporaryWorktree?: boolean
    errorCode?: string
    errorMessage?: string
  }
}

export type StoredRebaseSession = {
  intent: RebaseIntent
  state: RebaseState
  phase: StoredPhase // NEW
  version: number
  createdAtMs: number
  updatedAtMs: number
  originalBranch: string
  autoDetachedWorktrees?: DetachedWorktree[]
}
```

#### B.2 New PhaseService

**File: `src/node/services/PhaseService.ts`** (NEW)

```typescript
import { log } from '@shared/logger'
import type { RebasePhase, RebaseEvent } from '../domain/RebasePhase'
import { transition, canTransition, InvalidTransitionError, createIdlePhase } from '../domain'
import type { StoredPhase, StoredRebaseSession } from '../store'
import * as SessionService from './SessionService'

/**
 * Hydrate stored phase back to full RebasePhase object.
 * Reconstructs rich objects from stored IDs.
 */
export function hydratePhase(stored: StoredPhase, session: StoredRebaseSession): RebasePhase {
  const base = {
    enteredAtMs: stored.enteredAtMs,
    correlationId: stored.correlationId
  }

  switch (stored.kind) {
    case 'idle':
      return { ...base, kind: 'idle' }

    case 'planning':
      return {
        ...base,
        kind: 'planning',
        intent: session.intent,
        projectedState: session.state
      }

    case 'queued':
      return {
        ...base,
        kind: 'queued',
        intent: session.intent,
        state: session.state,
        executionPath: stored.data?.executionPath ?? '',
        isTemporaryWorktree: stored.data?.isTemporaryWorktree ?? false
      }

    case 'executing': {
      const activeJob = stored.data?.activeJobId
        ? session.state.jobsById[stored.data.activeJobId]
        : null
      if (!activeJob) throw new Error('Cannot hydrate executing phase without activeJob')
      return {
        ...base,
        kind: 'executing',
        intent: session.intent,
        state: session.state,
        executionPath: stored.data?.executionPath ?? '',
        isTemporaryWorktree: stored.data?.isTemporaryWorktree ?? false,
        activeJob
      }
    }

    case 'conflicted': {
      const conflictedJob = stored.data?.activeJobId
        ? session.state.jobsById[stored.data.activeJobId]
        : null
      if (!conflictedJob) throw new Error('Cannot hydrate conflicted phase without job')
      return {
        ...base,
        kind: 'conflicted',
        intent: session.intent,
        state: session.state,
        executionPath: stored.data?.executionPath ?? '',
        isTemporaryWorktree: stored.data?.isTemporaryWorktree ?? false,
        conflictedJob,
        conflictFiles: stored.data?.conflictFiles ?? []
      }
    }

    case 'finalizing':
      return {
        ...base,
        kind: 'finalizing',
        intent: session.intent,
        state: session.state,
        executionPath: stored.data?.executionPath ?? '',
        isTemporaryWorktree: stored.data?.isTemporaryWorktree ?? false
      }

    case 'completed':
      return {
        ...base,
        kind: 'completed',
        finalState: session.state,
        durationMs: Date.now() - session.createdAtMs
      }

    case 'error':
      return {
        ...base,
        kind: 'error',
        error: {
          code: stored.data?.errorCode ?? 'UNKNOWN',
          message: stored.data?.errorMessage ?? 'Unknown error',
          recoverable: false
        },
        state: session.state,
        actions: ['abort', 'cleanup']
      }
  }
}

/**
 * Dehydrate RebasePhase to storable format.
 * Extracts only IDs and primitive data.
 */
export function dehydratePhase(phase: RebasePhase): StoredPhase {
  const base: StoredPhase = {
    kind: phase.kind,
    enteredAtMs: phase.enteredAtMs,
    correlationId: phase.correlationId
  }

  switch (phase.kind) {
    case 'queued':
    case 'finalizing':
      return {
        ...base,
        data: {
          executionPath: phase.executionPath,
          isTemporaryWorktree: phase.isTemporaryWorktree
        }
      }
    case 'executing':
      return {
        ...base,
        data: {
          activeJobId: phase.activeJob.id,
          executionPath: phase.executionPath,
          isTemporaryWorktree: phase.isTemporaryWorktree
        }
      }
    case 'conflicted':
      return {
        ...base,
        data: {
          activeJobId: phase.conflictedJob.id,
          conflictFiles: phase.conflictFiles,
          executionPath: phase.executionPath,
          isTemporaryWorktree: phase.isTemporaryWorktree
        }
      }
    case 'error':
      return {
        ...base,
        data: {
          errorCode: phase.error.code,
          errorMessage: phase.error.message
        }
      }
    default:
      return base
  }
}

/**
 * Dispatch an event to transition phase.
 * Validates the transition, logs it, and persists the new phase.
 */
export function dispatch(repoPath: string, event: RebaseEvent): RebasePhase {
  const session = SessionService.getSession(repoPath)
  if (!session) {
    throw new Error(`No session for ${repoPath}`)
  }

  const currentPhase = hydratePhase(session.phase, session)

  // Validate transition is allowed
  if (!canTransition(currentPhase, event.type)) {
    log.error('[PhaseService] Invalid transition attempted', {
      repoPath,
      currentPhase: currentPhase.kind,
      eventType: event.type
    })
    throw new InvalidTransitionError(
      currentPhase.kind,
      event.type,
      `Cannot ${event.type} from ${currentPhase.kind}`
    )
  }

  // Perform transition
  const newPhase = transition(currentPhase, event)

  // Log transition
  log.info('[PhaseService] Phase transition', {
    repoPath,
    correlationId: newPhase.correlationId,
    from: currentPhase.kind,
    to: newPhase.kind,
    event: event.type
  })

  // Persist
  const storedPhase = dehydratePhase(newPhase)
  SessionService.updatePhase(repoPath, storedPhase)

  return newPhase
}

/**
 * Get current phase for a repo.
 */
export function getPhase(repoPath: string): RebasePhase | null {
  const session = SessionService.getSession(repoPath)
  if (!session) return null
  return hydratePhase(session.phase, session)
}

/**
 * Check if a transition is valid without performing it.
 */
export function canDispatch(repoPath: string, eventType: RebaseEvent['type']): boolean {
  const phase = getPhase(repoPath)
  if (!phase) return eventType === 'SUBMIT_INTENT'
  return canTransition(phase, eventType)
}
```

#### B.3 SessionService Updates

**File: `src/node/services/SessionService.ts`**

```typescript
import type { StoredPhase } from '../store'
import { createIdlePhase } from '../domain'

export function createSession(
  repoPath: string,
  plan: RebasePlan,
  originalBranch: string,
  autoDetachedWorktrees?: DetachedWorktree[]
): void {
  const key = normalizePath(repoPath)
  if (sessionStore.has(key)) {
    throw new Error('Session already exists')
  }

  const now = Date.now()
  const idlePhase = createIdlePhase()

  sessionStore.set(key, {
    intent: plan.intent,
    state: plan.state,
    phase: {
      kind: 'planning',
      enteredAtMs: now,
      correlationId: idlePhase.correlationId
    },
    originalBranch,
    autoDetachedWorktrees,
    version: 1,
    createdAtMs: now,
    updatedAtMs: now
  })
}

// NEW: Update phase without full session update
export function updatePhase(repoPath: string, phase: StoredPhase): void {
  const key = normalizePath(repoPath)
  const existing = sessionStore.get(key)
  if (!existing) {
    throw new Error(`Session not found: ${repoPath}`)
  }

  sessionStore.set(key, {
    ...existing,
    phase,
    version: existing.version + 1,
    updatedAtMs: Date.now()
  })
}
```

#### B.4 RebaseExecutor Integration

**File: `src/node/operations/RebaseExecutor.ts`**

Replace status checks with phase dispatches:

```typescript
import * as PhaseService from '../services/PhaseService'

// After creating session, when user confirms
PhaseService.dispatch(repoPath, {
  type: 'CONFIRM_INTENT',
  executionPath: context.executionPath,
  isTemporaryWorktree: context.isTemporary
})

// When starting a job
PhaseService.dispatch(repoPath, {
  type: 'JOB_STARTED',
  job: nextJob
})

// When job completes
PhaseService.dispatch(repoPath, {
  type: 'JOB_COMPLETED',
  job: completedJob,
  newHeadSha: newHeadSha
})

// When conflict detected
PhaseService.dispatch(repoPath, {
  type: 'CONFLICT_DETECTED',
  job: conflictedJob,
  conflicts: conflictFiles
})

// When user continues after resolving
PhaseService.dispatch(repoPath, { type: 'CONTINUE_AFTER_RESOLVE' })

// When all jobs complete
PhaseService.dispatch(repoPath, { type: 'ALL_JOBS_COMPLETE' })

// When finalization done
PhaseService.dispatch(repoPath, {
  type: 'FINALIZE_COMPLETE',
  finalState: finalState
})

// On error
PhaseService.dispatch(repoPath, {
  type: 'ERROR',
  code: 'REBASE_FAILED',
  message: error.message,
  recoverable: false
})

// On abort
PhaseService.dispatch(repoPath, { type: 'ABORT' })
```

#### B.5 UiStateBuilder Changes

**File: `src/node/domain/UiStateBuilder.ts`**

```typescript
import * as PhaseService from '../services/PhaseService'

private static deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
  const phase = options.rebaseSession
    ? PhaseService.hydratePhase(options.rebaseSession.phase, options.rebaseSession)
    : null

  // No phase = check for intent preview
  if (!phase || phase.kind === 'idle') {
    const intent = options.rebaseIntent
    if (!intent || intent.targets.length === 0) {
      return { kind: 'idle' }
    }
    const generateJobId = options.generateJobId ?? this.createDefaultPreviewJobIdGenerator()
    const plan = RebaseStateMachine.createRebasePlan({ repo, intent, generateJobId })
    return { kind: 'planning', plan }
  }

  // Exhaustive switch on phase kind
  switch (phase.kind) {
    case 'planning':
      return {
        kind: 'planning',
        plan: { intent: phase.intent, state: phase.projectedState }
      }

    case 'queued':
    case 'executing':
    case 'conflicted':
    case 'finalizing':
      return { kind: 'rebasing', session: phase.state }

    case 'completed':
      return { kind: 'idle' }

    case 'error':
      return { kind: 'idle' }  // Or add error projection if needed

    default:
      const _exhaustive: never = phase
      return { kind: 'idle' }
  }
}
```

#### B.6 Migration Logic

**File: `src/node/services/SessionService.ts`**

```typescript
// In SessionStore.get()
get(key: string): StoredRebaseSession | null {
  if (!this.memory.has(key)) {
    const persisted = this.disk.getRebaseSession(key)
    if (persisted) {
      // Migration: create phase from old status if missing
      if (!persisted.phase) {
        persisted.phase = this.migrateToStoredPhase(persisted)
        this.disk.setRebaseSession(key, persisted)
      }
      this.memory.set(key, persisted)
    }
  }
  return this.memory.get(key) ?? null
}

private migrateToStoredPhase(session: StoredRebaseSession): StoredPhase {
  const now = Date.now()
  const correlationId = `migrated-${session.state.session.id}`

  switch (session.state.session.status) {
    case 'pending':
      return { kind: 'planning', enteredAtMs: now, correlationId }
    case 'running':
      return {
        kind: 'executing',
        enteredAtMs: now,
        correlationId,
        data: { activeJobId: session.state.queue.activeJobId }
      }
    case 'awaiting-user':
      return {
        kind: 'conflicted',
        enteredAtMs: now,
        correlationId,
        data: { activeJobId: session.state.queue.activeJobId }
      }
    case 'completed':
      return { kind: 'completed', enteredAtMs: now, correlationId }
    case 'aborted':
      return { kind: 'idle', enteredAtMs: now, correlationId }
  }
}
```

#### B.7 Files Changed Summary

| File                                    | Change Type | Description                                                  |
| --------------------------------------- | ----------- | ------------------------------------------------------------ |
| `src/shared/types/rebase.ts`            | Modify      | Add `phase: RebasePhase`, deprecate `status`                 |
| `src/node/store.ts`                     | Modify      | Add `StoredPhase` type, add `phase` to `StoredRebaseSession` |
| `src/node/services/PhaseService.ts`     | **NEW**     | Phase dispatch, hydration/dehydration                        |
| `src/node/services/SessionService.ts`   | Modify      | Add `updatePhase()`, migration logic                         |
| `src/node/services/index.ts`            | Modify      | Export `PhaseService`                                        |
| `src/node/operations/RebaseExecutor.ts` | Modify      | Replace status with `PhaseService.dispatch()`                |
| `src/node/domain/UiStateBuilder.ts`     | Modify      | Replace inference with phase switch                          |

#### B.8 Additional Complexity

**Hydration/Dehydration:** Rich phase types contain object references. Must:

- Dehydrate: Store only IDs and primitives
- Hydrate: Reconstruct full objects from session state

**Event Dispatching:** 12 event types must be dispatched at correct points:

- `SUBMIT_INTENT`, `CANCEL_INTENT`, `CONFIRM_INTENT`
- `JOB_STARTED`, `JOB_COMPLETED`, `CONFLICT_DETECTED`
- `CONTINUE_AFTER_RESOLVE`, `ABORT`, `ALL_JOBS_COMPLETE`
- `FINALIZE_COMPLETE`, `ERROR`, `ACKNOWLEDGE_ERROR`, `CLEAR_COMPLETED`

#### B.9 Effort Breakdown

| Task                             | Estimate     |
| -------------------------------- | ------------ |
| StoredPhase type + serialization | 2 hours      |
| PhaseService implementation      | 3-4 hours    |
| SessionService updates           | 1 hour       |
| RebaseExecutor integration       | 3-4 hours    |
| UiStateBuilder refactor          | 2 hours      |
| Migration logic                  | 1-2 hours    |
| Testing                          | 4-6 hours    |
| Code review / iteration          | 2-3 hours    |
| **Total**                        | **3-5 days** |

#### B.10 Option B Specific Risks

| Risk                                               | Severity | Mitigation                                    |
| -------------------------------------------------- | -------- | --------------------------------------------- |
| Hydration bugs (objects reconstructed incorrectly) | High     | Comprehensive round-trip tests                |
| Missed dispatch sites                              | High     | Audit all `session.status` usages; lint rule  |
| 12 event types to dispatch correctly               | Medium   | Documentation; type system catches mismatches |
| Over-engineering for current needs                 | Medium   | Consider Option A first                       |

---

### Option C: Remove RebasePhase.ts

**Goal:** Clean up dead code to reduce confusion, accepting that the inference problem remains unsolved.

#### C.1 Delete File

```bash
rm src/node/domain/RebasePhase.ts
```

#### C.2 Update Exports

**File: `src/node/domain/index.ts`**

Remove all RebasePhase exports:

```typescript
// DELETE these lines (approximately lines 14-31):
export {
  InvalidTransitionError,
  canTransition,
  createIdlePhase,
  getPhaseDescription,
  transition
} from './RebasePhase'
export type {
  CompletedPhase,
  ConflictedPhase,
  ErrorPhase,
  ExecutingPhase,
  FinalizingPhase,
  IdlePhase,
  PlanningPhase,
  QueuedPhase,
  RebaseEvent,
  RebasePhase
} from './RebasePhase'
```

#### C.3 Verification

```bash
# Verify no imports break
npx tsc --noEmit

# Run tests
npm test
```

Based on codebase analysis, nothing imports `RebasePhase` except `domain/index.ts`, so this should be clean.

#### C.4 Files Changed Summary

| File                             | Change Type | Description                |
| -------------------------------- | ----------- | -------------------------- |
| `src/node/domain/RebasePhase.ts` | **DELETE**  | Remove entire file         |
| `src/node/domain/index.ts`       | Modify      | Remove RebasePhase exports |

#### C.5 What Remains Unchanged

- `RebaseSessionStatus` continues as status tracking
- Signal inference in `deriveRebaseProjection` unchanged
- Original bug class (post-mortem issue) remains possible
- No schema changes, no migration needed

#### C.6 Effort Breakdown

| Task                 | Estimate        |
| -------------------- | --------------- |
| Delete file          | 1 min           |
| Update index.ts      | 5 min           |
| Verify build         | 10 min          |
| Update documentation | 15 min          |
| **Total**            | **~30 minutes** |

---

## Decision Matrix

| Criteria                      | Option A (Minimal) | Option B (Full)     | Option C (Remove) |
| ----------------------------- | ------------------ | ------------------- | ----------------- |
| **Solves inference bug**      | ✅ Yes             | ✅ Yes              | ❌ No             |
| **Type-safe events**          | ❌ No              | ✅ Yes              | ❌ No             |
| **Transition validation**     | ❌ Simple          | ✅ Full             | ❌ No             |
| **Correlation IDs / tracing** | ❌ No              | ✅ Yes              | ❌ No             |
| **Schema migration**          | Simple             | Complex             | None              |
| **New files required**        | 0                  | 1 (PhaseService)    | 0                 |
| **Files modified**            | 6                  | 7                   | 2                 |
| **Effort**                    | 1-2 days           | 3-5 days            | 30 min            |
| **Risk**                      | Low                | Medium              | None              |
| **Removes dead code**         | Optional           | Yes (integrates it) | Yes               |
| **Future extensibility**      | Moderate           | High                | Low               |

---

## Recommendation for Tech Lead

**Primary recommendation: Option A (Minimal Phase Field)**

Rationale:

1. Solves the core problem (inference bugs) with minimal risk
2. Pragmatic balance of effort vs. value
3. Can always upgrade to Option B later if needed
4. Simpler migration path

**Secondary recommendation: Option C (Remove) as fallback**

If Option A proves more complex than expected during implementation, fall back to Option C to at least clean up the dead code and eliminate developer confusion.

**When to choose Option B instead:**

- Multiple state-related bugs have occurred
- Rebase feature will grow significantly in complexity
- Team wants auditable state transitions for support/debugging
- Time is available for proper implementation

**Not recommended: Do nothing (Option D)**

The current state with parallel unused infrastructure is actively harmful - it creates confusion and the original bug class persists.
