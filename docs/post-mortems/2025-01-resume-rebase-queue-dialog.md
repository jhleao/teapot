# Post-Mortem: "Resume Rebase Queue?" Dialog Appearing Instead of Confirm/Cancel

**Date:** January 2025
**Severity:** High (blocked normal rebase workflow)
**Time to diagnose:** ~4 hours of debugging sessions

## Summary

When users drag-dropped branches to rebase them, the "Resume Rebase Queue?" dialog appeared instead of the expected Confirm/Cancel rebase preview. Clicking "Continue" would auto-execute the rebase without user confirmation. Clicking "Dismiss" would close the dialog but it would reappear on the next rebase attempt.

## Root Cause

The bug was in `UiStateBuilder.deriveRebaseProjection()` which determines whether to show the planning UI (Confirm/Cancel) or the rebasing UI (Resume Queue dialog).

The function returned `kind: 'rebasing'` whenever a session existed, without checking if the session was still in the planning phase:

```typescript
// BUGGY CODE
private static deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
  if (options.rebaseSession) {
    // Always returned 'rebasing' when session existed - WRONG!
    return {
      kind: 'rebasing',
      session: options.rebaseSession
    }
  }
  // ...
}
```

This caused a cascade failure:
1. `deriveRebaseProjection` returned `kind: 'rebasing'` during planning phase
2. `deriveProjectedStack()` only returns a stack when `kind === 'planning'`
3. Without `projectedStack`, `getUiState()` fell back to marking pending jobs as `queued`
4. The frontend saw `queued` status and showed the "Resume Rebase Queue?" dialog

## Why It Was Hard to Diagnose

### 1. State Race Condition
The `submitRebaseIntent` handler correctly returned `prompting` status, but the git watcher immediately triggered `getUiState()` which overwrote the state with `queued` status. The correct state existed briefly but was replaced.

### 2. Indirection Through Multiple Layers
The bug path crossed 5+ files:
- Frontend: `UiStateContext.tsx` → `submitRebaseIntent()`
- IPC: `handlers/repo.ts` → `submitRebaseIntent`
- Operations: `RebaseOperation.ts` → `submitRebaseIntent()`
- Domain: `UiStateBuilder.ts` → `deriveRebaseProjection()`
- State: `SessionService.ts` → session persistence

### 3. Similar Symptoms, Different Causes
Initial symptoms (lock errors, session persistence issues) were red herrings that led to investigating wrong paths first.

### 4. Correct Initial State
The backend returned correct data initially. The bug only manifested after the git watcher refresh, making it seem like the backend was correct.

## The Fix

Modified `deriveRebaseProjection` to check if we're still in the planning phase before returning `rebasing`:

```typescript
// FIXED CODE
private static deriveRebaseProjection(repo: Repo, options: FullUiStateOptions): RebaseProjection {
  if (options.rebaseSession) {
    // Check if we're still in the planning phase:
    // - No active job (nothing has started executing yet)
    // - Git is not currently rebasing
    // - Intent exists (we have a plan to show)
    const session = options.rebaseSession
    const isStillPlanning =
      !session.queue.activeJobId && !repo.workingTreeStatus.isRebasing && options.rebaseIntent

    if (isStillPlanning && options.rebaseIntent) {
      // Treat as planning phase - show prompting UI
      const generateJobId =
        options.generateJobId ?? UiStateBuilder.createDefaultPreviewJobIdGenerator()
      const plan = RebaseStateMachine.createRebasePlan({
        repo,
        intent: options.rebaseIntent,
        generateJobId
      })
      return {
        kind: 'planning',
        plan
      }
    }

    return {
      kind: 'rebasing',
      session: options.rebaseSession
    }
  }
  // ... rest unchanged
}
```

## Lessons Learned

### 1. State Machine Clarity
The rebase flow has distinct phases (planning → executing → completed). The state machine should explicitly track which phase we're in rather than inferring it from session existence.

### 2. Watcher Interference
Git file watchers can trigger state refreshes at any time. Operations that set UI state need to either:
- Disable watchers during the operation
- Ensure the refresh logic respects the current operation's state

### 3. End-to-End Logging
When debugging state issues, log at every layer boundary to trace the exact point where state diverges from expectations.

### 4. Test the Full Flow
Unit tests passed because they tested components in isolation. Integration tests that simulate the full drag-drop → confirm flow would have caught this.

## Prevention

1. **Explicit Phase Tracking**: Consider adding an explicit `phase` field to the session state (`planning` | `executing` | `completed`)

2. **State Immutability During Operations**: Implement a mechanism to prevent watcher-triggered refreshes from overwriting operation-initiated state changes

3. **Integration Tests**: Add tests that simulate the full rebase workflow including git watcher triggers

4. **State Transition Logging**: Add debug-level logging for all state transitions in the rebase flow to make future debugging easier
