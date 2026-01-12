# Resumable Conflict Resolution for Squash Operations

## Executive Summary

This document outlines the architectural and UX design for adding resumable conflict resolution to squash operations. Users should be able to continue, abort, or skip when conflicts occur during descendant branch rebasing, matching the existing rebase experience.

---

## Problem Statement

### Current Behavior

When a squash operation encounters a conflict during descendant rebasing:

1. Operation aborts immediately
2. All branches are rolled back to original positions
3. User must manually resolve and retry the entire operation
4. No way to preserve partial progress

### Desired Behavior

Match the rebase conflict resolution experience:

1. Operation pauses at conflict
2. User sees conflict dialog with affected files
3. User can resolve in editor, then continue
4. Alternative: abort entire operation or skip problematic branch
5. Progress is preserved across app restarts

---

## User Experience Analysis

### Current Rebase Conflict Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     ConflictResolutionDialog                     │
├─────────────────────────────────────────────────────────────────┤
│  Rebasing `feature-branch` has conflicts.                        │
│  Resolve conflicts in your editor and save.                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ⚠ src/components/Button.tsx                              │   │
│  │ ⚠ src/utils/helpers.ts                                   │   │
│  │ ✓ src/types/index.ts (resolved)                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  2 of 3 files with conflicts remaining.                          │
│                                                                  │
│  [Open in Editor]                                               │
│  [Terminal]  [Copy Path]                                        │
│                                                                  │
│  [Abort]                                    [Continue]           │
└─────────────────────────────────────────────────────────────────┘
```

**What works well:**
- Clear indication of which branch is being rebased
- Real-time tracking of resolved/unresolved files
- Quick access to editor/terminal for resolution
- Continue disabled until all conflicts resolved
- Abort available as escape hatch

### Proposed Squash Conflict Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   SquashConflictResolutionDialog                 │
├─────────────────────────────────────────────────────────────────┤
│  Squashing into `parent-branch` - rebasing descendant            │
│  `child-feature` (2 of 4 branches)                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ⚠ src/components/Button.tsx                              │   │
│  │ ✓ src/utils/helpers.ts (resolved)                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  1 of 2 files with conflicts remaining.                          │
│                                                                  │
│  [Open in Editor]                                               │
│  [Terminal]  [Copy Path]                                        │
│                                                                  │
│  [Abort All]    [Skip Branch]              [Continue]            │
└─────────────────────────────────────────────────────────────────┘
```

**Key differences from rebase:**
- Header shows squash context (parent branch, descendant count)
- "Skip Branch" option to skip problematic descendant
- "Abort All" rolls back entire squash operation

### Skip Branch UX Considerations

**When user clicks "Skip Branch":**

1. **Confirmation dialog** (optional, configurable):
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  Skip rebasing `child-feature`?                         │
   │                                                         │
   │  This branch will remain at its original position       │
   │  and may become orphaned from the stack.                │
   │                                                         │
   │  Branches after this will still be rebased.             │
   │                                                         │
   │  [Cancel]                              [Skip Branch]    │
   └─────────────────────────────────────────────────────────┘
   ```

2. **Result in UI**: Skipped branch shown with warning icon in stack view

3. **Stack graph impact**: Skipped branch becomes a "floating" branch, visually distinct

### Abort All UX Considerations

**When user clicks "Abort All":**

1. All branches rolled back to original positions
2. Temp worktree cleaned up
3. User returned to original branch
4. Toast notification: "Squash operation aborted"

**Edge case**: If abort fails (e.g., temp worktree deleted):
- Show error dialog with manual recovery steps
- Log detailed error for debugging

---

## Architectural Analysis

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer                                 │
├─────────────────────────────────────────────────────────────────┤
│ SquashConflictResolutionDialog.tsx                              │
│   - Renders conflict file list                                   │
│   - Continue/Abort/Skip buttons                                  │
│   - Open in Editor/Terminal actions                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ IPC
┌─────────────────────────────────────────────────────────────────┐
│                        API Handlers                              │
├─────────────────────────────────────────────────────────────────┤
│ continueSquash({ repoPath })                                    │
│ abortSquash({ repoPath })                                       │
│ skipSquashBranch({ repoPath })                                  │
│ getSquashStatus({ repoPath })                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SquashOperation                             │
├─────────────────────────────────────────────────────────────────┤
│ continueSquash(repoPath)     → SquashOperationResponse          │
│ abortSquash(repoPath)        → SquashOperationResponse          │
│ skipSquashBranch(repoPath)   → SquashOperationResponse          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SquashExecutor                              │
├─────────────────────────────────────────────────────────────────┤
│ continue(repoPath)           → ExecuteResult                    │
│ abort(repoPath)              → AbortResult                      │
│ skip(repoPath)               → SkipResult                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SquashStateMachine                            │
├─────────────────────────────────────────────────────────────────┤
│ (Pure state transitions - see SQUASH_STATE_MACHINE_DESIGN.md)   │
└─────────────────────────────────────────────────────────────────┘
```

### State Flow for Continue

```
User clicks "Continue"
         ↓
UI: continueSquash() IPC call
         ↓
SquashOperation.continueSquash(repoPath)
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. Get session from SessionService                              │
│ 2. Get execution context (temp worktree path)                   │
│ 3. Verify all conflicts resolved (git status)                   │
│ 4. Call git.rebaseContinue(executionPath)                       │
│ 5. If success:                                                  │
│    - StateMachine.completeDescendantJob()                       │
│    - StateMachine.nextDescendantJob()                           │
│    - Loop until queue empty or new conflict                     │
│ 6. If conflict:                                                 │
│    - StateMachine.recordDescendantConflict()                    │
│    - Return conflict response                                   │
│ 7. If queue empty:                                              │
│    - StateMachine.finalizeSession()                             │
│    - Handle branch cleanup                                      │
│    - Release temp worktree                                      │
└─────────────────────────────────────────────────────────────────┘
         ↓
Return SquashOperationResponse with updated UI state
```

### State Flow for Abort

```
User clicks "Abort All"
         ↓
UI: abortSquash() IPC call
         ↓
SquashOperation.abortSquash(repoPath)
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. Get session from SessionService                              │
│ 2. Get execution context                                        │
│ 3. If git rebasing: git.rebaseAbort(executionPath)              │
│ 4. Rollback branches to original SHAs from session              │
│ 5. Release temp worktree                                        │
│ 6. StateMachine.abortSession()                                  │
│ 7. Clear session from SessionService                            │
│ 8. Restore original branch in main worktree                     │
└─────────────────────────────────────────────────────────────────┘
         ↓
Return SquashOperationResponse with clean UI state
```

### State Flow for Skip

```
User clicks "Skip Branch"
         ↓
UI: skipSquashBranch() IPC call
         ↓
SquashOperation.skipSquashBranch(repoPath)
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. Get session and current job                                  │
│ 2. git.rebaseAbort(executionPath) - stop current rebase         │
│ 3. Reset branch to original SHA                                 │
│ 4. StateMachine.skipDescendantJob()                             │
│ 5. StateMachine.nextDescendantJob()                             │
│ 6. If more jobs: start next descendant rebase                   │
│ 7. If no more jobs: finalize                                    │
└─────────────────────────────────────────────────────────────────┘
         ↓
Return SquashOperationResponse with updated UI state
```

---

## UI Components

### New Components

```typescript
// src/web/components/SquashConflictResolutionDialog.tsx
interface SquashConflictDialogProps {
  parentBranch: string
  conflictingBranch: string
  descendantProgress: { current: number; total: number }
  conflictedFiles: UiWorkingTreeFile[]
  executionPath: string
  onContinue: () => Promise<void>
  onAbort: () => Promise<void>
  onSkip: () => Promise<void>
}
```

### Modified Components

```typescript
// src/web/contexts/UiStateContext.tsx
// Add squash-specific state and actions

interface UiStateContextValue {
  // ... existing ...

  // Squash conflict state
  squashConflictState?: {
    parentBranch: string
    conflictingBranch: string
    descendantProgress: { current: number; total: number }
    conflicts: string[]
  }

  // Squash actions
  continueSquash: () => Promise<void>
  abortSquash: () => Promise<void>
  skipSquashBranch: () => Promise<void>
}
```

### Dialog Rendering Logic

```typescript
// src/web/App.tsx or similar
function AppDialogs() {
  const { uiState, squashConflictState } = useUiStateContext()

  // Priority: Squash conflict > Rebase conflict > other dialogs
  if (squashConflictState) {
    return <SquashConflictResolutionDialog {...squashConflictState} />
  }

  if (uiState?.workingTree.some(f => f.status === 'conflicted')) {
    return <ConflictResolutionDialog />
  }

  // ... other dialogs
}
```

---

## Session Integration

### Squash Session Structure

```typescript
interface SquashStoredSession {
  type: 'squash'

  // Core identifiers
  id: string
  repoPath: string

  // State snapshot (from SquashStateMachine)
  state: SquashState

  // Execution context (temp worktree)
  executionContext?: {
    executionPath: string
    isTemporary: boolean
    createdAt: number
  }

  // Original user state (for restore on abort)
  originalBranch: string | null
  originalHead: string

  // Metadata
  createdAt: number
  updatedAt: number
}
```

### Session Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                   Session Lifecycle                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  execute()                                                   │
│     ↓                                                        │
│  Create session with 'pending' status                        │
│     ↓                                                        │
│  Start execution → update to 'applying-patch'                │
│     ↓                                                        │
│  Patch applied → update to 'rebasing-descendants'            │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Descendant loop:                                        │ │
│  │   - Update session with current job                     │ │
│  │   - On conflict: update to 'awaiting-user' + persist    │ │
│  │   - On continue: resume loop                            │ │
│  │   - On skip: mark job skipped, next job                 │ │
│  │   - On abort: rollback, clear session                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│     ↓                                                        │
│  All jobs done → update to 'completed'                       │
│     ↓                                                        │
│  Handle branches, clear session                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### Error Scenarios

| Scenario | Handling | User Message |
|----------|----------|--------------|
| Continue with unresolved conflicts | Block continue button | "Resolve all conflicts before continuing" |
| Git rebase continue fails | Show error, keep in awaiting-user | "Failed to continue: {git error}" |
| Abort fails (worktree issue) | Show error dialog with recovery steps | "Abort failed. Manual cleanup may be required." |
| Skip fails (branch reset fails) | Attempt rollback, show error | "Could not skip branch: {error}" |
| Session not found on continue | Return to normal state | Toast: "No squash operation in progress" |
| Execution context lost | Attempt recovery or abort | "Execution context lost. Aborting operation." |

### Recovery After Crash

```
App startup
    ↓
Check for squash session in SessionService
    ↓
If session exists:
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 1. Check session status                                     │
│ 2. If 'awaiting-user':                                      │
│    - Verify execution context still exists                  │
│    - Check if git still rebasing                           │
│    - If valid: show conflict dialog                        │
│    - If invalid: attempt recovery or show error            │
│ 3. If 'rebasing-descendants':                              │
│    - Check git state, reconcile                             │
│    - Either resume or prompt user                          │
│ 4. If 'completed':                                         │
│    - Finalize (shouldn't happen, but handle gracefully)    │
└─────────────────────────────────────────────────────────────┘
```

---

## API Design

### IPC Handlers

```typescript
// src/node/handlers/squash.ts (or add to repo.ts)

ipcMain.handle('continueSquash', async (_, { repoPath }) => {
  return SquashOperation.continueSquash(repoPath)
})

ipcMain.handle('abortSquash', async (_, { repoPath }) => {
  return SquashOperation.abortSquash(repoPath)
})

ipcMain.handle('skipSquashBranch', async (_, { repoPath }) => {
  return SquashOperation.skipSquashBranch(repoPath)
})

ipcMain.handle('getSquashStatus', async (_, { repoPath }) => {
  return SquashOperation.getSquashStatus(repoPath)
})
```

### Response Types

```typescript
interface SquashOperationResponse {
  success: boolean
  uiState: UiState | null
  error?: string

  // Conflict info (when success=false and conflicts exist)
  conflicts?: {
    branch: string
    files: string[]
    progress: { current: number; total: number }
  }
}

interface SquashStatusResponse {
  hasSession: boolean
  status?: SquashSessionStatus
  conflictingBranch?: string
  progress?: { current: number; total: number }
  conflicts?: string[]
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('SquashExecutor.continue', () => {
  it('continues rebase when all conflicts resolved')
  it('reports new conflict if rebase continue hits another')
  it('processes remaining jobs after successful continue')
  it('finalizes when last job completes')
  it('returns error when no session exists')
})

describe('SquashExecutor.abort', () => {
  it('aborts git rebase if in progress')
  it('rolls back all branches to original positions')
  it('cleans up temp worktree')
  it('clears session')
  it('restores original branch')
})

describe('SquashExecutor.skip', () => {
  it('aborts current rebase')
  it('resets branch to original position')
  it('marks job as skipped')
  it('starts next job if available')
  it('finalizes if no more jobs')
})
```

### Integration Tests

```typescript
describe('Squash conflict resolution E2E', () => {
  it('shows conflict dialog when descendant rebase conflicts')
  it('continues successfully after user resolves conflicts')
  it('skips branch and continues with remaining descendants')
  it('aborts and restores all branches to original state')
  it('recovers session after simulated app restart')
})
```

### Manual Test Scenarios

1. **Happy path continue:**
   - Start squash with 3 descendants
   - Conflict on 2nd descendant
   - Resolve in editor
   - Click continue
   - Verify remaining descendants rebased

2. **Skip and continue:**
   - Conflict on descendant
   - Click skip
   - Verify skipped branch at original position
   - Verify subsequent branches still rebased

3. **Full abort:**
   - Conflict on descendant
   - Click abort
   - Verify all branches at original positions
   - Verify on original branch

4. **Crash recovery:**
   - Conflict on descendant
   - Force-quit app
   - Relaunch
   - Verify conflict dialog appears
   - Complete operation

---

## Implementation Dependencies

### Prerequisites (from SQUASH_STATE_MACHINE_DESIGN.md)

1. ✅ SquashState types defined
2. ✅ SquashStateMachine with job tracking
3. ✅ Session persistence for squash operations
4. ✅ Execution context storage

### This Feature Adds

1. SquashExecutor.continue/abort/skip methods
2. SquashConflictResolutionDialog component
3. IPC handlers for squash conflict actions
4. UiStateContext integration for squash conflicts
5. Recovery logic in app startup

---

## Migration Path

### Phase 1: Backend Implementation

1. Implement SquashExecutor continue/abort/skip
2. Add session status tracking
3. Add IPC handlers
4. Integration tests

### Phase 2: UI Implementation

1. Create SquashConflictResolutionDialog
2. Add squash conflict state to UiStateContext
3. Wire up dialog to IPC handlers
4. Add dialog rendering logic

### Phase 3: Recovery & Polish

1. Implement crash recovery flow
2. Add confirmation dialogs (skip, abort)
3. Add loading states during operations
4. Manual testing and bug fixes

---

## Open Questions

1. **Should skip require confirmation?**
   - Pro: Prevents accidental skips
   - Con: Extra click for power users
   - Proposal: Configurable, default to yes

2. **What happens to skipped branch's descendants?**
   - Option A: Also skip them (conservative)
   - Option B: Try to rebase them anyway (may fail)
   - Proposal: Option A, with clear messaging

3. **Should we support "skip all remaining"?**
   - Use case: User wants to stop but keep partial progress
   - Complexity: Medium
   - Proposal: V2 feature

4. **How to indicate skipped branches in UI?**
   - Stack view: Warning icon + tooltip
   - Toast: "Branch X was skipped during squash"
   - Proposal: Both

---

## Success Criteria

1. ✅ User can resolve conflicts and continue squash
2. ✅ User can skip problematic descendants
3. ✅ User can abort and return to clean state
4. ✅ Progress survives app restart
5. ✅ UI clearly shows conflict state and progress
6. ✅ Matches quality of rebase conflict resolution UX
