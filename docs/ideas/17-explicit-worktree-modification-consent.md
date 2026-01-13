# Idea: Explicit User Consent for Worktree Modifications

**Source:** `architecture-issues-rebase-worktree-lifecycle.md` (Issue 1: Implicit Assumptions About User Intent)
**Status:** Proposed
**Priority:** High (UX, trust)
**Effort:** Medium (1 week)

## Problem

The system makes assumptions about user intent when modifying worktrees that the user isn't actively working in:

1. **Auto-detach during rebase**: Assumes user wants their worktree switched to detached HEAD
2. **Auto re-checkout after rebase**: Assumes user wants their worktree updated to the rebased branch
3. **No opt-out mechanism**: These behaviors happen automatically without user consent
4. **Cross-window modifications**: User in one window may be unaware of changes triggered from another

### Impact on User Experience

When the system modifies worktrees without consent:

- **Review disruption**: User may be reviewing specific commits; rebase changes the commit tree
- **Editor state disconnect**: Open files, cursor positions, undo history may reference changed commits
- **Confusion**: User discovers unexpected detached HEAD state later
- **Lost context**: User may not know *why* their worktree is in an unexpected state
- **Trust erosion**: Users become wary of using Teapot for rebases

### Root Cause

The system prioritizes "reducing friction" over "user awareness and control." The `autoDetachedWorktrees` mechanism and automatic re-checkout were designed to make rebases seamless, but they hide important information from the user.

## Proposed Solution

**Principle: Never modify a worktree the user isn't actively working in without explicit consent.**

### Option 1: Block and Inform (Recommended)

If a rebase would affect worktrees the user isn't in, block and show exactly what would happen:

```
This rebase would affect other worktrees:

  /Users/me/project (has 'feature-a' checked out)
  /Users/me/project/.worktrees/feature-b (has 'feature-b' checked out)

Please switch these worktrees to a different branch before proceeding.
```

This is the simplest approach and aligns with idea #16 (Block All Worktree Conflicts).

### Option 2: Explicit Consent Modal

If we want to allow cross-worktree modifications, require explicit consent:

```typescript
interface WorktreeModificationConsent {
  worktreePath: string
  currentBranch: string
  action: 'detach' | 'update'
  userConsented: boolean
}

async function requestWorktreeModificationConsent(
  modifications: WorktreeModificationConsent[]
): Promise<boolean> {
  // Show modal with clear explanation
  // "The following worktrees will be temporarily switched to detached HEAD..."
  // Require explicit "I understand, proceed" button
  return await showConsentModal(modifications)
}
```

### Option 3: Opt-In Setting

Make cross-worktree modifications opt-in via settings:

```typescript
interface RebaseSettings {
  // Default: false (safe default)
  allowAutoDetachOtherWorktrees: boolean

  // If true, show notification after modification
  notifyOnWorktreeModification: boolean
}
```

## Recommendation

**Option 1 (Block and Inform)** is recommended because:

1. Simplest implementation
2. No UI for consent flows needed
3. Aligns with "Block All Worktree Conflicts" (#16)
4. User action (switching branches) makes the change explicit
5. No need to track modified worktrees for cleanup

---

## Architecture Design Decision

### ADR-001: Never Auto-Modify Other Worktrees

**Decision:** Operations should never modify worktrees the user isn't actively working in without explicit prior consent.

**Rationale:**
- Principle of least surprise
- Users trust that their work environment remains stable
- Cross-window/cross-worktree modifications are unexpected
- Explicit user action (switching branches) is clearer than automation

**Alternatives Considered:**
1. **Auto-modify with notification**: Rejected - notification may be missed, damage already done
2. **Consent modal**: Rejected - interrupts flow, complex UI
3. **Opt-in setting**: Rejected - hidden setting, most users won't find it

### ADR-002: Clear Blocking Messages

**Decision:** When blocking an operation due to worktree conflicts, provide:
1. List of affected worktrees
2. Current branch in each
3. Clear action the user should take

**Rationale:**
- User can fix all issues at once
- No guessing about what to do
- Builds trust: system explains what it needs

### ADR-003: Active Worktree Exemption

**Decision:** The worktree the user is actively working in (where they initiated the operation) can be modified without extra consent.

**Rationale:**
- User initiated the operation from this location
- Implicit consent via action
- Standard git behavior (rebasing current branch modifies current worktree)

---

## First Implementation Steps

### Step 1: Define "Active Worktree" (30 min)

```typescript
// src/node/context/ActiveWorktree.ts

/**
 * Returns the worktree path where the user initiated the current operation.
 * This is determined by the window/context that made the IPC call.
 */
export function getActiveWorktreePath(context: OperationContext): string {
  // The path associated with the current window/session
  return context.worktreePath
}

/**
 * Checks if a worktree is the active one (user-initiated context).
 */
export function isActiveWorktree(
  worktreePath: string,
  context: OperationContext
): boolean {
  return path.normalize(worktreePath) === path.normalize(context.worktreePath)
}
```

### Step 2: Update Conflict Detection (1 hour)

```typescript
// src/node/rebase/RebaseValidator.ts

interface WorktreeConflict {
  worktreePath: string
  branch: string
  isActive: boolean
}

export async function detectWorktreeConflicts(
  repoPath: string,
  branches: string[],
  activeWorktreePath: string
): Promise<WorktreeConflict[]> {
  const worktrees = await git.listWorktrees(repoPath)
  const conflicts: WorktreeConflict[] = []

  for (const branch of branches) {
    const worktree = worktrees.find(wt => wt.branch === branch)
    if (worktree) {
      conflicts.push({
        worktreePath: worktree.path,
        branch,
        isActive: isActiveWorktree(worktree.path, activeWorktreePath)
      })
    }
  }

  return conflicts
}

export function hasNonActiveConflicts(conflicts: WorktreeConflict[]): boolean {
  return conflicts.some(c => !c.isActive)
}
```

### Step 3: Block Non-Active Worktree Modifications (1 hour)

```typescript
// src/node/rebase/RebaseOperation.ts

async function validateRebasePreConditions(
  repoPath: string,
  branches: string[],
  context: OperationContext
): Promise<void> {
  const conflicts = await detectWorktreeConflicts(
    repoPath,
    branches,
    context.worktreePath
  )

  const nonActiveConflicts = conflicts.filter(c => !c.isActive)

  if (nonActiveConflicts.length > 0) {
    throw new RebaseBlockedError(
      formatNonActiveWorktreeError(nonActiveConflicts)
    )
  }

  // Active worktree conflicts are OK - user is working there
}

function formatNonActiveWorktreeError(
  conflicts: WorktreeConflict[]
): string {
  const lines = [
    'Cannot rebase: Some branches are checked out in other worktrees:',
    ''
  ]

  for (const { branch, worktreePath } of conflicts) {
    lines.push(`  • ${branch} → ${worktreePath}`)
  }

  lines.push('')
  lines.push(
    'Please switch these worktrees to a different branch, or run the rebase from one of those worktrees.'
  )

  return lines.join('\n')
}
```

### Step 4: Add Context to IPC Calls (1 hour)

```typescript
// src/node/handlers/rebaseHandlers.ts

interface RebaseRequest {
  repoPath: string
  queue: RebaseQueue
  // Add active worktree context
  activeWorktreePath: string
}

export async function handleStartRebase(
  request: RebaseRequest
): Promise<RebaseResult> {
  const context: OperationContext = {
    worktreePath: request.activeWorktreePath
  }

  await validateRebasePreConditions(
    request.repoPath,
    extractBranches(request.queue),
    context
  )

  // Proceed with rebase...
}
```

### Step 5: Update UI to Pass Context (30 min)

```typescript
// src/web/hooks/useRebase.ts

async function startRebase(queue: RebaseQueue): Promise<void> {
  const activeWorktreePath = useActiveWorktreePath()

  await ipc.invoke('rebase:start', {
    repoPath,
    queue,
    activeWorktreePath  // Include in request
  })
}
```

### Step 6: Add Tests (1 hour)

```typescript
describe('Worktree Modification Consent', () => {
  it('allows rebase when branch is in active worktree', async () => {
    const activeWorktree = '/repo/worktrees/feature'
    // Branch 'feature' is checked out in active worktree

    await expect(
      validateRebasePreConditions(
        repoPath,
        ['feature'],
        { worktreePath: activeWorktree }
      )
    ).resolves.not.toThrow()
  })

  it('blocks rebase when branch is in non-active worktree', async () => {
    const activeWorktree = '/repo/worktrees/main'
    // Branch 'feature' is checked out in /repo/worktrees/feature

    await expect(
      validateRebasePreConditions(
        repoPath,
        ['feature'],
        { worktreePath: activeWorktree }
      )
    ).rejects.toThrow(/checked out in other worktrees/)
  })
})
```

---

## Future Considerations

### Notification System

If Option 2 or 3 is later desired, we'd need:

```typescript
interface WorktreeModificationNotification {
  type: 'worktree_modified'
  worktreePath: string
  previousBranch: string
  currentState: 'detached' | { branch: string }
  reason: string  // "Rebase of feature-stack from /other/worktree"
  timestamp: number
}

// Show notification in relevant windows
function notifyWorktreeModified(notification: WorktreeModificationNotification): void {
  // Find windows associated with this worktree
  // Show toast/notification
}
```

### Recovery Assistance

If users do end up with unexpected states, provide help:

```typescript
// "Your worktree appears to be in an unexpected state"
// "Would you like to checkout 'feature' again?"
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| More friction for power users | Clear error messages with actionable steps |
| Multi-worktree stacks harder to rebase | Document workflow: rebase from one worktree at a time |
| Users confused about "active worktree" | Error message explains the concept implicitly |
| IPC context missing | Validate context exists, fall back to blocking all conflicts |
