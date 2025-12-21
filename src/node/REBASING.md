# Rebasing Architecture

## Key Abstractions

| Abstraction     | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `RebaseIntent`  | Declarative rebase plan (what branches, where) |
| `RebaseSession` | Lifecycle tracker for a rebase operation       |
| `RebaseJob`     | Single branch rebase unit                      |
| `RebaseQueue`   | Manages job execution order                    |
| `RebaseState`   | Complete snapshot: session + jobs + queue      |

## Layers

```
domain/RebaseStateMachine   → Pure state transitions, no I/O
domain/RebaseIntentBuilder  → Builds intent from user action
core/rebase-executor        → Orchestrates Git operations
services/SessionService     → Persists sessions across restarts
```

## Data Flow

```
User drag/drop
    ↓
RebaseIntentBuilder.build() → RebaseIntent
    ↓
RebaseStateMachine.createRebasePlan() → RebasePlan
    ↓
SessionService.createSession()
    ↓
┌─────────────────────────────────────────────┐
│ Executor loop:                              │
│   nextJob() → executeJob() → completeJob()  │
│         ↓ conflict?                         │
│   recordConflict() → pause                  │
│         ↓ resolved?                         │
│   continueRebase() → resume loop            │
│         ↓ children?                         │
│   enqueueDescendants() → add to queue       │
└─────────────────────────────────────────────┘
    ↓
finalizeRebase() → clear session
```

## Job Lifecycle

```
queued → applying → completed
              ↓
        awaiting-user (conflict)
              ↓
        continue/skip/abort
```

## Session Status

```
pending → running → completed
             ↓
       awaiting-user → running (after resolve)
             ↓
          aborted
```
