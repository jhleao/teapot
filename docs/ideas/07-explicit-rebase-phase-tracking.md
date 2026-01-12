# Idea: Explicit Phase Tracking for Rebase State Machine

**Source:** `docs/post-mortems/2025-01-resume-rebase-queue-dialog.md`
**Status:** Proposed (from post-mortem lessons)
**Priority:** High

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
  | 'planning'    // Preview shown, awaiting confirmation
  | 'executing'   // Jobs running
  | 'paused'      // Conflict or error, awaiting user
  | 'completed'   // All done

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
  | 'planning'    // Preview shown, awaiting confirmation
  | 'executing'   // Jobs running
  | 'paused'      // Conflict or user action required
  | 'completed'   // All done, session can be cleared

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
  planning: ['executing', 'completed'],  // confirm or cancel
  executing: ['paused', 'completed'],    // conflict or done
  paused: ['executing', 'completed'],    // continue or abort
  completed: ['planning'],               // start new session
}

function validateTransition(from: RebasePhase, to: RebasePhase): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid phase transition: ${from} -> ${to}`)
  }
}

export function setSessionPhase(
  repoPath: string,
  newPhase: RebasePhase
): void {
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
    phase: 'planning',  // Always start in planning
    queue,
    intent,
    startedAt: Date.now(),
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

| Risk | Mitigation |
|------|------------|
| Migration of existing sessions | Default to 'executing' for sessions without phase |
| Missed transition call | Audit all rebase-related code paths |
| Phase/actual state mismatch | Integration tests verify phase matches git state |
