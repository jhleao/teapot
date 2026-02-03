# Idea: Branch Ownership Tracking for Worktrees

**Source:** `architecture-issues-rebase-worktree-lifecycle.md` (Issues 5 & 6: Implicit Worktree Relationships, Temp Worktree as Branch Container)
**Status:** Proposed
**Priority:** Medium (architecture, debuggability)
**Effort:** High (2-3 weeks)

## Problem

### Issue 1: Implicit Worktree Relationships

The system tracks worktrees through `autoDetachedWorktrees`, a flat list of `{worktreePath, branch}` tuples. This representation loses context:

- Why was this worktree detached?
- What was the original commit before detaching?
- What is the relationship between this worktree and the rebase operation?

When re-checkout fails, the user doesn't understand:

- What state their worktree is now in
- Whether they need to take action
- How to recover

### Issue 2: Temp Worktree Holds Branch Reference

During rebase, the temp worktree checks out branches:

1. Temp worktree is created (detached HEAD at main)
2. Branch X is checked out in temp worktree
3. Rebase operations run
4. Branch X now points to new commits
5. **Temp worktree still "holds" branch X**

At step 5, any other worktree attempting to checkout branch X fails with Git's "branch is already used by worktree" error.

This holding pattern is invisible. The `ExecutionContext` doesn't expose which branch is currently checked out. The release logic doesn't handle branch handoff.

### Root Cause

The system needs to explicitly manage which worktree "owns" a branch reference at any given time, rather than having this be an implicit side effect of checkout operations.

## Proposed Solution

Create a `BranchOwnership` abstraction that tracks which worktree owns each branch reference, and manages handoff between worktrees.

### BranchOwnership Model

```typescript
interface BranchOwner {
  worktreePath: string
  isTemporary: boolean
  acquiredAt: number
  previousOwner?: {
    worktreePath: string
    detachedAt: string // Commit SHA where it was detached
  }
}

interface BranchOwnershipState {
  owners: Map<string, BranchOwner> // branch -> owner
}

class BranchOwnershipTracker {
  private state: BranchOwnershipState

  /**
   * Acquire ownership of a branch for a worktree.
   * If another worktree owns it, that worktree is detached first.
   */
  async acquireOwnership(
    branch: string,
    worktreePath: string,
    options: { isTemporary: boolean }
  ): Promise<BranchOwner>

  /**
   * Release ownership of a branch.
   * If there was a previous owner, restore their checkout.
   */
  async releaseOwnership(branch: string, worktreePath: string): Promise<void>

  /**
   * Get the current owner of a branch.
   */
  getOwner(branch: string): BranchOwner | undefined

  /**
   * List all branches owned by a worktree.
   */
  getBranchesOwnedBy(worktreePath: string): string[]
}
```

### Ownership Flow During Rebase

```
Initial State:
  feature-a → /Users/me/project (user worktree)
  feature-b → /Users/me/project/.worktrees/feature-b

Rebase Starts:
  1. Temp worktree acquires 'feature-a'
     - /Users/me/project is detached
     - Tracker records previous owner

  2. Temp worktree acquires 'feature-b'
     - /.worktrees/feature-b is detached
     - Tracker records previous owner

Rebase Completes:
  3. Temp worktree releases 'feature-a'
     - Previous owner (/Users/me/project) restored
     - feature-a checked out (now rebased)

  4. Temp worktree releases 'feature-b'
     - Previous owner restored
     - feature-b checked out (now rebased)

Final State:
  feature-a → /Users/me/project (restored, updated)
  feature-b → /Users/me/project/.worktrees/feature-b (restored, updated)
```

### Benefits

1. **Explicit ownership**: Always know which worktree owns a branch
2. **Automatic restoration**: Previous owners can be restored on release
3. **Debuggable**: Can inspect ownership state at any time
4. **Safe cleanup**: Release logic knows exactly what to do
5. **Prevents conflicts**: Can check ownership before operations

---

## Architecture Design Decision

### ADR-001: Centralized Ownership Tracking

**Decision:** Create `BranchOwnershipTracker` as a centralized service that tracks all branch-worktree associations.

**Rationale:**

- Single source of truth for ownership
- Prevents race conditions (one place to check/modify)
- Enables cross-operation coordination
- Simplifies cleanup logic

**Alternatives Considered:**

1. **Query git each time**: Rejected - doesn't track history or intent
2. **Per-worktree tracking**: Rejected - can't coordinate across worktrees
3. **Store in session only**: Rejected - loses context on crash/restart

### ADR-002: Ownership Includes History

**Decision:** `BranchOwner` includes `previousOwner` information.

**Rationale:**

- Enables automatic restoration on release
- User knows where their branch was before
- Supports recovery scenarios
- Debugging shows ownership history

### ADR-003: Temporary vs Permanent Owners

**Decision:** Distinguish between temporary (e.g., temp worktrees) and permanent (user worktrees) owners.

**Rationale:**

- Temporary owners should release on operation complete
- Permanent owners persist across operations
- Different cleanup logic for each
- Clear expectations for each type

### ADR-004: Persistence for Recovery

**Decision:** Persist ownership state to `.git/teapot-branch-ownership.json`.

**Rationale:**

- Survive app restart
- Enable recovery from crashes
- Show state in diagnostics
- Support multi-window scenarios

---

## First Implementation Steps

### Step 1: Define Ownership Types (30 min)

```typescript
// src/node/domain/BranchOwnership.ts

export interface PreviousOwner {
  worktreePath: string
  detachedAtCommit: string
  detachedAt: number // timestamp
}

export interface BranchOwner {
  branch: string
  worktreePath: string
  isTemporary: boolean
  acquiredAt: number
  previousOwner?: PreviousOwner
}

export interface BranchOwnershipState {
  version: 1
  owners: Record<string, BranchOwner> // branch -> owner
  updatedAt: number
}
```

### Step 2: Implement Ownership Tracker (2 hours)

```typescript
// src/node/services/BranchOwnershipTracker.ts

export class BranchOwnershipTracker {
  private state: BranchOwnershipState
  private persistPath: string

  constructor(repoPath: string) {
    this.persistPath = path.join(repoPath, '.git', 'teapot-branch-ownership.json')
    this.state = this.loadOrCreate()
  }

  async acquireOwnership(
    branch: string,
    worktreePath: string,
    options: { isTemporary: boolean }
  ): Promise<BranchOwner> {
    const existingOwner = this.state.owners[branch]

    // If someone else owns it, we need to detach them first
    if (existingOwner && existingOwner.worktreePath !== worktreePath) {
      // Get current commit before detaching
      const currentCommit = await git.revParse(existingOwner.worktreePath, 'HEAD')

      // Detach the current owner
      await git.checkout(existingOwner.worktreePath, ['--detach'])

      log.info('[BranchOwnership] Detached previous owner', {
        branch,
        previousOwner: existingOwner.worktreePath,
        commit: currentCommit
      })
    }

    const owner: BranchOwner = {
      branch,
      worktreePath,
      isTemporary: options.isTemporary,
      acquiredAt: Date.now(),
      previousOwner: existingOwner
        ? {
            worktreePath: existingOwner.worktreePath,
            detachedAtCommit: await git.revParse(existingOwner.worktreePath, 'HEAD'),
            detachedAt: Date.now()
          }
        : undefined
    }

    // Checkout branch in new owner
    await git.checkout(worktreePath, branch)

    // Record ownership
    this.state.owners[branch] = owner
    await this.persist()

    log.info('[BranchOwnership] Acquired', {
      branch,
      worktreePath,
      isTemporary: options.isTemporary,
      hadPreviousOwner: !!existingOwner
    })

    return owner
  }

  async releaseOwnership(branch: string, worktreePath: string): Promise<void> {
    const owner = this.state.owners[branch]

    if (!owner || owner.worktreePath !== worktreePath) {
      log.warn('[BranchOwnership] Cannot release - not owner', {
        branch,
        worktreePath,
        actualOwner: owner?.worktreePath
      })
      return
    }

    // Detach current worktree to free branch
    await git.checkout(worktreePath, ['--detach'])

    // Restore previous owner if any
    if (owner.previousOwner) {
      try {
        await git.checkout(owner.previousOwner.worktreePath, branch)

        log.info('[BranchOwnership] Restored previous owner', {
          branch,
          restoredTo: owner.previousOwner.worktreePath
        })

        // Update ownership to previous owner
        this.state.owners[branch] = {
          branch,
          worktreePath: owner.previousOwner.worktreePath,
          isTemporary: false, // Restored owner is permanent
          acquiredAt: Date.now()
        }
      } catch (error) {
        log.warn('[BranchOwnership] Could not restore previous owner', {
          branch,
          previousOwner: owner.previousOwner.worktreePath,
          error
        })
        // Remove from tracking - branch is now unowned
        delete this.state.owners[branch]
      }
    } else {
      // No previous owner - just remove from tracking
      delete this.state.owners[branch]
    }

    await this.persist()

    log.info('[BranchOwnership] Released', {
      branch,
      worktreePath,
      restoredPreviousOwner: !!owner.previousOwner
    })
  }

  getOwner(branch: string): BranchOwner | undefined {
    return this.state.owners[branch]
  }

  getBranchesOwnedBy(worktreePath: string): string[] {
    return Object.values(this.state.owners)
      .filter((o) => o.worktreePath === worktreePath)
      .map((o) => o.branch)
  }

  /**
   * Release all branches owned by a worktree.
   * Used when cleaning up temp worktrees.
   */
  async releaseAll(worktreePath: string): Promise<void> {
    const branches = this.getBranchesOwnedBy(worktreePath)

    for (const branch of branches) {
      await this.releaseOwnership(branch, worktreePath)
    }
  }

  private loadOrCreate(): BranchOwnershipState {
    try {
      const content = fs.readFileSync(this.persistPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {
        version: 1,
        owners: {},
        updatedAt: Date.now()
      }
    }
  }

  private async persist(): Promise<void> {
    this.state.updatedAt = Date.now()
    await fs.promises.writeFile(this.persistPath, JSON.stringify(this.state, null, 2))
  }
}
```

### Step 3: Integrate with ExecutionContext (1 hour)

```typescript
// src/node/services/ExecutionContextService.ts

export class ExecutionContext {
  private ownershipTracker: BranchOwnershipTracker
  private ownedBranches: string[] = []

  async checkoutBranch(branch: string): Promise<void> {
    // Acquire ownership (detaches previous owner if needed)
    await this.ownershipTracker.acquireOwnership(branch, this.executionPath, { isTemporary: true })

    this.ownedBranches.push(branch)
  }

  async prepareForRelease(): Promise<void> {
    // Release all branches we own
    for (const branch of this.ownedBranches) {
      await this.ownershipTracker.releaseOwnership(branch, this.executionPath)
    }
    this.ownedBranches = []

    this._phase = 'preparing_release'
  }
}
```

### Step 4: Update RebaseExecutor (1 hour)

```typescript
// src/node/rebase/RebaseExecutor.ts

async function runRebaseJob(context: ExecutionContext, job: RebaseJob): Promise<void> {
  // Checkout branch with ownership tracking
  await context.checkoutBranch(job.branch)

  // Run rebase
  await git.rebase(context.executionPath, job.onto)

  // Branch is still owned by context until prepareForRelease
}
```

### Step 5: Add Diagnostics (30 min)

```typescript
// src/node/handlers/diagnosticsHandlers.ts

export function getBranchOwnershipState(repoPath: string): BranchOwnershipState {
  const tracker = new BranchOwnershipTracker(repoPath)
  return tracker.getState()
}

// Exposed via IPC for dev tools
// Shows which branches are owned by which worktrees
```

### Step 6: Add Tests (2 hours)

```typescript
describe('BranchOwnershipTracker', () => {
  it('tracks ownership when branch is checked out', async () => {
    await tracker.acquireOwnership('feature', worktreePath, { isTemporary: false })

    const owner = tracker.getOwner('feature')
    expect(owner?.worktreePath).toBe(worktreePath)
  })

  it('detaches previous owner when acquiring', async () => {
    await tracker.acquireOwnership('feature', worktreeA, { isTemporary: false })
    await tracker.acquireOwnership('feature', worktreeB, { isTemporary: true })

    // worktreeA should be detached
    expect(await isDetached(worktreeA)).toBe(true)

    // worktreeB is now owner
    const owner = tracker.getOwner('feature')
    expect(owner?.worktreePath).toBe(worktreeB)
    expect(owner?.previousOwner?.worktreePath).toBe(worktreeA)
  })

  it('restores previous owner on release', async () => {
    // Initial owner
    await tracker.acquireOwnership('feature', worktreeA, { isTemporary: false })

    // Temp owner takes over
    await tracker.acquireOwnership('feature', worktreeB, { isTemporary: true })

    // Temp owner releases
    await tracker.releaseOwnership('feature', worktreeB)

    // worktreeA should have branch back
    const owner = tracker.getOwner('feature')
    expect(owner?.worktreePath).toBe(worktreeA)
    expect(await getCurrentBranch(worktreeA)).toBe('feature')
  })

  it('persists state across instances', async () => {
    await tracker.acquireOwnership('feature', worktreePath, { isTemporary: false })

    // Create new tracker instance
    const tracker2 = new BranchOwnershipTracker(repoPath)

    const owner = tracker2.getOwner('feature')
    expect(owner?.worktreePath).toBe(worktreePath)
  })
})
```

---

## State Diagram

```
Branch 'feature' Ownership Flow
================================

Initial:
  ┌────────────────┐
  │  User Worktree │ ──owns── feature
  │  /Users/me/    │
  └────────────────┘

Rebase Starts (temp acquires):
  ┌────────────────┐              ┌────────────────┐
  │  User Worktree │ ─detached─   │  Temp Worktree │ ──owns── feature
  │  /Users/me/    │              │  /tmp/teapot-  │
  └────────────────┘              └────────────────┘
          │                               │
          └──── previousOwner ────────────┘

Rebase Completes (temp releases):
  ┌────────────────┐              ┌────────────────┐
  │  User Worktree │ ──owns── feature (rebased)
  │  /Users/me/    │              │  Temp Worktree │ ─removed─
  └────────────────┘              └────────────────┘
```

---

## Risks and Mitigations

| Risk                       | Mitigation                                               |
| -------------------------- | -------------------------------------------------------- |
| State file corruption      | Validate on load, recreate if invalid                    |
| Race between windows       | File locking or single-writer pattern                    |
| Orphaned ownership records | Cleanup stale entries on startup                         |
| Performance overhead       | Cache tracker instances per repo                         |
| Restore failure            | Log and remove from tracking; user can manually checkout |
