# Plan: Improved Branch Checkout UX

## Problem Statement

When a user clicks on `origin/main` in the UI, they currently get a **detached HEAD** state. This is confusing because:

1. 99% of users want to "get to the latest main", not inspect a specific commit
2. Detached HEAD is a confusing state - commits made here can be lost
3. After "Ship It", users see origin/main ahead of local main with no clear path forward

## Solution Overview   

Two improvements:

1. **Click `origin/main`** → fetch + checkout local `main` + fast-forward (all-or-nothing)
2. **After Ship It** → smart navigation based on stack position

---

## Guiding Principles

1. **All-or-nothing**: Operations either succeed completely or fail completely. No partial states.
2. **User stays in control**: No automatic branch switches from external changes.
3. **Match intent**: Click on `origin/main` = "I want to be on latest main"
4. **Respect stacked workflow**: Ship It navigation considers stack structure.
5. **Fail safely**: Errors show clear feedback, user stays where they were.
6. **Prevent bad states**: Never allow PRs to target merged branches. Block rather than fix.
7. **Backend owns business logic**: Frontend is purely presentational - all decisions made in backend.

---

## Part 1: Remote Branch Click Behavior

### Current Flow (Broken)

```
User double-clicks origin/main
  → git checkout origin/main
  → Detached HEAD at origin/main's commit
  → User confused
```

### New Flow (All-or-Nothing)

```
User double-clicks origin/main
  → [Guard] Working tree clean? If not, block
  → [Fetch] git fetch origin
  → [Check] Can local main fast-forward to origin/main?
      → NO: Abort entirely, toast "Cannot sync: main has local changes"
            User stays on current branch (no change)
      → YES: Continue...
  → [Checkout] git checkout main
  → [FF] git merge --ff-only origin/main
  → [Success] Toast "Synced to main"
```

**Key insight**: Check ff-ability BEFORE checkout. Never leave user in partial state.

---

## Part 2: Ship It Behavior

### Stacked PR Mental Model

In Teapot/Superlog, stacked PRs target their parent branch, not main:

```
main
  └── feature-1 (PR #1: feature-1 → main)
        └── feature-2 (PR #2: feature-2 → feature-1)
              └── feature-3 (PR #3: feature-3 → feature-2)
```

When you ship any branch, it merges into its target (parent or main).

### Critical Rule: No PRs Targeting Merged Branches

**Problem**: After shipping a branch, descendant branches may still have PRs targeting it:

```
Before shipping feature-1:
main
  └── feature-1 (PR #1: → main)
        └── feature-2 (PR #2: → feature-1)
              └── feature-3 (no PR yet)

After shipping feature-1:
main (includes feature-1)
  └── feature-1 (MERGED - should not be PR target!)
        └── feature-2 (PR #2: still → feature-1 ← STALE!)
              └── feature-3 (no PR yet)
```

**Solution - Two Rules**:

1. **"Ship It" blocked if PR targets a merged branch**
   - Check `pr.baseRefName` before merging
   - If target is merged → Error: "PR targets merged branch. Retarget on GitHub first."

2. **"Create PR" always targets the nearest unmerged ancestor**
   - Walk up the stack, skip any merged branches
   - Target the first unmerged branch, or main if all ancestors merged

```
Create PR on feature-3 (after feature-1 shipped):
  → Check feature-2: unmerged? YES → target feature-2

Create PR on feature-2 (after feature-1 shipped):
  → Check feature-1: unmerged? NO (merged)
  → Check main: always valid → target main
```

### Ship It Navigation Logic

```
User clicks "Ship It" on branch X
  → [Merge] PR merges into its target branch (via GitHub API)
  → [Fetch] git fetch origin
  → [Navigate] Where should user end up?

Navigation rules:
  1. If user was NOT on the shipped branch → stay where they are
  2. If user WAS on the shipped branch:
     a. If PR targeted main → checkout main + ff
     b. If PR targeted another branch → checkout that parent branch

  → [Inform] If shipped branch had children in stack:
      Toast: "Shipped! Remaining branches need rebasing"
```

### Ship It Flow Diagram

```
Ship branch X (PR targets branch T)

Was user on branch X?
├── NO → Stay on current branch
│        If X had children: toast "Remaining branches need rebasing"
│
└── YES → Need to navigate away from shipped branch
          │
          Was T = main?
          ├── YES → Checkout main + ff
          │         Toast: "Shipped! Switched to main"
          │
          └── NO → T is a parent branch
                   │
                   Does T exist locally?
                   ├── YES → Checkout T
                   │         Toast: "Shipped! Switched to [T]"
                   │
                   └── NO → Fallback: checkout main + ff
                            Toast: "Shipped! Switched to main"
```

---

## Part 3: Why `--ff-only`?

| Approach | Behavior | Risk |
|----------|----------|------|
| `git pull` | Fetch + merge (may create merge commit) | Surprise merge commits |
| `git pull --rebase` | Fetch + rebase local onto remote | Rewrites history unexpectedly |
| `git merge --ff-only` | Only succeeds if can fast-forward | **Safe**: fails predictably |

**`--ff-only` is the safest choice** because:

- No surprise merge commits
- No rewriting history
- Fails clearly when local has unpushed work
- User stays in control of conflict resolution

---

## Complete Edge Case Analysis

### Edge Cases: Remote Branch Click

| Scenario | Behavior | User Feedback |
|----------|----------|---------------|
| Local `main` is behind remote | Fetch → check → checkout → ff | Toast: "Synced to main" |
| Local `main` is up-to-date | Fetch → check (ok) → checkout → ff (no-op) | Toast: "Synced to main" |
| Local `main` has unpushed commits | Fetch → check fails → abort | Toast: "Cannot sync: main has unpushed commits" |
| Local `main` has diverged | Fetch → check fails → abort | Toast: "Cannot sync: main has diverged" |
| Local `main` doesn't exist | Fetch → checkout (git auto-creates) → ff (no-op) | Toast: "Synced to main" |
| Working tree dirty | Blocked before any action | (existing behavior) |
| Network offline | Fetch fails | Toast: "Failed to fetch" |
| Click local `main` | Regular checkout (no fetch, no ff) | (unchanged behavior) |
| Click `origin/feature/foo` | Parse correctly, same logic | Works correctly |

### Edge Cases: Ship It Navigation

| Scenario | User On | PR Target | Behavior |
|----------|---------|-----------|----------|
| Single branch, no stack | shipped branch | main | → checkout main + ff |
| Bottom of stack | shipped branch | main | → checkout main + ff |
| Bottom of stack | child branch | main | → stay on child, toast "needs rebase" |
| Middle of stack | shipped branch | parent | → checkout parent |
| Middle of stack | other branch | parent | → stay, toast "needs rebase" |
| Top of stack | shipped branch | parent | → checkout parent |
| Top of stack | other branch | parent | → stay on current |

### Edge Cases: Ship It Error Handling

| Scenario | Behavior |
|----------|----------|
| PR merge fails | Error dialog, no navigation |
| Fetch fails after merge | Merge succeeded, skip navigation, toast warning |
| Parent branch deleted | Fallback to main |
| Parent branch not local | Fallback to main |
| Checkout fails | Stay where you are, toast error |
| FF fails after checkout | Should not happen (we pre-check), but log warning |
| User in detached HEAD | Stay in detached HEAD after ship |
| PR already merged (race condition) | Treat as success, continue with navigation |
| Working tree dirty | Skip navigation, toast "Shipped! Switch branches when ready" |

### Edge Cases: Fast-Forward Check

| Local State | Remote State | Can FF? | Handling |
|-------------|--------------|---------|----------|
| A | A | Yes (no-op) | Proceed |
| A | A→B→C | Yes | Proceed, ff to C |
| A→B | A | No | Abort: "has unpushed commits" |
| A→B | A→C | No | Abort: "has diverged" |
| (empty) | A→B→C | Yes | Proceed, creates branch at C |

### Edge Cases: Determining "Has Children"

Children are branches whose PR targets the shipped branch. We get this from:

- Forge state: `pr.baseRefName === shippedBranch`
- Or: UI stack model (descendants in the tree)

### Edge Cases: PR Target Validation

| Scenario | Action | Behavior |
|----------|--------|----------|
| Ship It: PR targets main | Ship It | Allow |
| Ship It: PR targets unmerged branch | Ship It | Allow |
| Ship It: PR targets merged branch | Ship It | **Block** with error |
| Create PR: parent is unmerged | Create PR | Target parent |
| Create PR: parent is merged, grandparent unmerged | Create PR | Target grandparent |
| Create PR: all ancestors merged | Create PR | Target main |
| Create PR: no ancestors (direct child of main) | Create PR | Target main |

### Edge Cases: Finding Valid PR Target

| Stack State | Create PR On | Target |
|-------------|--------------|--------|
| main → A (unmerged) → B | B | A |
| main → A (merged) → B | B | main |
| main → A (merged) → B (unmerged) → C | C | B |
| main → A (merged) → B (merged) → C | C | main |
| main → A (unmerged) → B (unmerged) → C | C | B |

### Edge Cases: Circular PR Target References

| Scenario | Behavior |
|----------|----------|
| A targets B, B targets A (corruption) | Detect cycle, fallback to main |
| Self-referential PR target | Detect, fallback to main |

---

## Implementation Plan

### Step 0: Add Shared Constants and Types

**File:** `src/shared/types/repo.ts` (UPDATE - add to existing file)

Add trunk branch constants and helper:

```typescript
/**
 * Common trunk branch names recognized by the application.
 */
export const TRUNK_BRANCHES = ['main', 'master'] as const

/**
 * Type representing a trunk branch name.
 */
export type TrunkBranchName = (typeof TRUNK_BRANCHES)[number]

/**
 * Checks if a branch name is a trunk branch (main or master).
 */
export function isTrunk(branchName: string): branchName is TrunkBranchName {
  return TRUNK_BRANCHES.includes(branchName as TrunkBranchName)
}
```

---

### Step 1: Add Shared Result Types

**File:** `src/shared/types/repo.ts` (UPDATE - add to existing file)

Add git operation result types:

```typescript
/**
 * Result of a merge operation.
 */
export type MergeResult = {
  /** Whether the merge succeeded */
  success: boolean
  /** True if merge was a fast-forward */
  fastForward: boolean
  /** Error message if failed */
  error?: string
  /** True if already up to date (no changes needed) */
  alreadyUpToDate?: boolean
}

/**
 * Options for merge operations.
 */
export type MergeOptions = {
  /** Only allow fast-forward merges. Use this to safely sync without surprise merge commits. */
  ffOnly?: boolean
}

/**
 * Result of attempting to checkout a branch.
 *
 * @example
 * // Successful checkout
 * { success: true }
 *
 * @example
 * // Failed due to divergence
 * { success: false, error: 'Cannot sync: main has local changes or has diverged' }
 */
export type CheckoutResult = {
  /** Whether the checkout succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Result of a remote branch checkout with fetch and fast-forward.
 */
export type RemoteBranchCheckoutResult = CheckoutResult & {
  /** The local branch that was checked out */
  localBranch?: string
}

/**
 * Parsed representation of a remote branch reference.
 */
export type RemoteBranchRef = {
  /** The remote name (e.g., 'origin') */
  remote: string
  /** The local branch name (e.g., 'main' or 'feature/foo') */
  localBranch: string
}
```

**File:** `src/shared/types/ui.ts` (UPDATE - add to existing file)

Add Ship It navigation types:

```typescript
/**
 * Result of Ship It navigation after merging a PR.
 */
export type ShipItNavigationResult = {
  /** What action was taken */
  action: 'stayed' | 'switched-to-main' | 'switched-to-parent'
  /** Branch user is now on (if switched) */
  targetBranch?: string
  /** Info message to show user */
  message: string
  /** Whether remaining branches need rebasing */
  needsRebase: boolean
}

/**
 * Context needed to determine Ship It navigation.
 */
export type ShipItNavigationContext = {
  /** Repository path for git operations */
  repoPath: string
  /** The branch that was shipped */
  shippedBranch: string
  /** The branch the PR targeted (parent or main) */
  prTargetBranch: string
  /** The branch user was on before shipping */
  userCurrentBranch: string | null
  /** Whether user was in detached HEAD */
  wasDetached: boolean
  /** Whether shipped branch has children in the stack */
  hasChildren: boolean
  /** Whether working tree is clean */
  isWorkingTreeClean: boolean
}
```

---

### Step 2: Add `merge` to GitAdapter interface

**File:** `src/node/core/git-adapter/interface.ts`

Add to the interface (in Advanced Operations section):

```typescript
/**
 * Merge a branch into the current branch.
 *
 * @param dir - Repository directory path
 * @param branch - Branch to merge into current HEAD
 * @param options - Merge options (ffOnly, etc.)
 * @returns Result of the merge operation
 */
merge?(dir: string, branch: string, options?: MergeOptions): Promise<MergeResult>
```

Add type guard:

```typescript
/**
 * Type guard to check if an adapter supports merge
 */
export function supportsMerge(adapter: GitAdapter): adapter is GitAdapter & {
  merge: (dir: string, branch: string, options?: MergeOptions) => Promise<MergeResult>
} {
  return typeof adapter.merge === 'function'
}
```

---

### Step 3: Implement `merge` in SimpleGitAdapter

**File:** `src/node/core/git-adapter/simple-git-adapter.ts`

```typescript
async merge(dir: string, branch: string, options?: MergeOptions): Promise<MergeResult> {
  try {
    const git = this.createGit(dir)
    const args = ['merge']

    if (options?.ffOnly) {
      args.push('--ff-only')
    }

    args.push(branch)

    const result = await git.raw(args)

    return {
      success: true,
      fastForward: result.includes('Fast-forward'),
      alreadyUpToDate: result.includes('Already up to date')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      fastForward: false,
      error: errorMessage.includes('Not possible to fast-forward')
        ? 'Cannot fast-forward: local branch has diverged or has unpushed commits'
        : errorMessage
    }
  }
}
```

---

### Step 4: Add `isRemote` and `hasStaleTarget` to UiBranch type

**File:** `src/shared/types/ui.ts`

```typescript
export type UiBranch = {
  name: string
  isCurrent: boolean
  /** True if this is a remote-tracking branch (e.g., origin/main) */
  isRemote: boolean  // NEW
  pullRequest?: UiPullRequest
  isMerged?: boolean
  /**
   * True if this branch has a PR that targets a merged branch.
   * Ship It should be disabled when true.
   */
  hasStaleTarget?: boolean  // NEW
}
```

---

### Step 5: Populate `isRemote` and `hasStaleTarget` during branch annotation

**File:** `src/node/core/utils/build-ui-state.ts`

In `annotateBranchHeads`, after determining `pullRequest` and `isMerged`:

```typescript
// Check if PR targets a merged branch (stale target)
const hasStaleTarget = pullRequest && pr?.baseRefName
  ? mergedBranchNames.has(pr.baseRefName)
  : false

commitNode.branches.push({
  name: branch.ref,
  isCurrent: branch.ref === state.currentBranch,
  isRemote: branch.isRemote,  // NEW - pass through from branch model
  pullRequest,
  isMerged,
  hasStaleTarget  // NEW
})
```

---

### Step 6: Create shared branch utilities

**File:** `src/node/core/utils/branch-utils.ts` (NEW)

Shared utilities to avoid duplication:

```typescript
import { getGitAdapter } from '../git-adapter'
import type { RemoteBranchRef } from '@shared/types'

/**
 * Checks if a branch exists in the repository.
 *
 * @param repoPath - Repository directory path
 * @param branchName - Branch name to check
 * @returns True if the branch exists
 */
export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  const git = getGitAdapter()
  try {
    await git.resolveRef(repoPath, branchName)
    return true
  } catch {
    return false
  }
}

/**
 * Checks if localBranch can fast-forward to remoteBranch.
 * Returns true if localBranch is an ancestor of remoteBranch.
 *
 * @param repoPath - Repository directory path
 * @param localBranch - The local branch to check
 * @param remoteBranch - The remote branch to check against
 * @returns True if fast-forward is possible
 */
export async function canFastForward(
  repoPath: string,
  localBranch: string,
  remoteBranch: string
): Promise<boolean> {
  const git = getGitAdapter()

  try {
    // Local is ancestor of remote = can fast-forward
    return await git.isAncestor(repoPath, localBranch, remoteBranch)
  } catch {
    // If check fails (e.g., branch doesn't exist), assume can't ff
    return false
  }
}

/**
 * Parses a remote branch ref into remote name and local branch name.
 * Handles both 'origin/main' and 'refs/remotes/origin/main' formats,
 * as well as branches with slashes like 'origin/feature/foo/bar'.
 *
 * @param ref - The remote branch reference (e.g., 'origin/main', 'origin/feature/foo')
 * @returns Parsed remote and local branch, or null if invalid format
 */
export function parseRemoteBranch(ref: string): RemoteBranchRef | null {
  // Handle 'refs/remotes/origin/main' format
  const normalized = ref.replace(/^refs\/remotes\//, '')

  // Match remote/branch where remote is the first segment and branch is everything after
  const match = normalized.match(/^([^/]+)\/(.+)$/)
  if (!match) return null

  return {
    remote: match[1],
    localBranch: match[2]
  }
}

/**
 * Finds the local trunk branch name (main or master).
 *
 * @param repoPath - Repository directory path
 * @returns The trunk branch name, or null if neither exists
 */
export async function findLocalTrunk(repoPath: string): Promise<string | null> {
  const { TRUNK_BRANCHES } = await import('@shared/types/repo')

  for (const name of TRUNK_BRANCHES) {
    if (await branchExists(repoPath, name)) {
      return name
    }
  }

  return null
}
```

---

### Step 7: Create Smart Checkout Function

**File:** `src/node/core/utils/smart-checkout.ts` (NEW)

Simple function-based approach (follows existing codebase patterns):

```typescript
import type { CheckoutResult, RemoteBranchCheckoutResult } from '@shared/types'
import { log } from '@shared/logger'
import { getGitAdapter, supportsMerge } from '../git-adapter'
import { branchExists, canFastForward, parseRemoteBranch } from './branch-utils'

/**
 * Smart checkout that handles both local and remote branches.
 * For remote branches (e.g., origin/main), performs fetch + fast-forward.
 * Implements all-or-nothing: checks ff-ability before checkout.
 *
 * @param repoPath - Repository directory path
 * @param ref - Branch name or remote ref to checkout
 * @returns Result of the checkout operation
 */
export async function smartCheckout(
  repoPath: string,
  ref: string
): Promise<RemoteBranchCheckoutResult> {
  const parsed = parseRemoteBranch(ref)

  if (!parsed) {
    // Local branch - simple checkout
    return executeLocalCheckout(repoPath, ref)
  }

  // Remote branch - fetch + ff flow
  return executeRemoteCheckout(repoPath, ref, parsed.remote, parsed.localBranch)
}

/**
 * Execute a simple local branch checkout.
 */
async function executeLocalCheckout(
  repoPath: string,
  ref: string
): Promise<CheckoutResult> {
  const gitAdapter = getGitAdapter()

  try {
    await gitAdapter.checkout(repoPath, ref)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: `Failed to checkout ${ref}: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Execute remote branch checkout with fetch + fast-forward.
 * Implements all-or-nothing with rollback on failure.
 */
async function executeRemoteCheckout(
  repoPath: string,
  remoteRef: string,
  remote: string,
  localBranch: string
): Promise<RemoteBranchCheckoutResult> {
  const gitAdapter = getGitAdapter()

  // 1. Fetch from remote
  try {
    await gitAdapter.fetch(repoPath, remote)
  } catch (error) {
    return {
      success: false,
      error: `Failed to fetch from ${remote}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // 2. Check if ff is possible BEFORE checkout (all-or-nothing)
  const localBranchExistsFlag = await branchExists(repoPath, localBranch)

  if (localBranchExistsFlag) {
    const canFF = await canFastForward(repoPath, localBranch, remoteRef)
    if (!canFF) {
      return {
        success: false,
        error: `Cannot sync: ${localBranch} has local changes or has diverged from ${remoteRef}`
      }
    }
  }

  // 3. Save state for rollback
  const originalBranch = await gitAdapter.currentBranch(repoPath)
  const originalHead = await gitAdapter.resolveRef(repoPath, 'HEAD')

  // 4. Now safe to checkout
  try {
    await gitAdapter.checkout(repoPath, localBranch)
  } catch (error) {
    return {
      success: false,
      error: `Failed to checkout ${localBranch}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // 5. Fast-forward (should always succeed given our pre-check)
  if (localBranchExistsFlag && supportsMerge(gitAdapter)) {
    const mergeResult = await gitAdapter.merge(repoPath, remoteRef, { ffOnly: true })
    if (!mergeResult.success) {
      // This shouldn't happen given our pre-check, but rollback
      log.warn('FF failed despite pre-check:', mergeResult.error)
      await rollbackCheckout(repoPath, originalBranch, originalHead)
      return {
        success: false,
        error: `Fast-forward failed unexpectedly: ${mergeResult.error}`
      }
    }
  }

  return { success: true, localBranch }
}

/**
 * Rollback to original state on failure.
 */
async function rollbackCheckout(
  repoPath: string,
  originalBranch: string | null,
  originalHead: string
): Promise<void> {
  const gitAdapter = getGitAdapter()

  try {
    if (originalBranch) {
      await gitAdapter.checkout(repoPath, originalBranch)
    } else {
      // Was in detached HEAD, restore to original commit
      await gitAdapter.checkout(repoPath, originalHead)
    }
  } catch (rollbackError) {
    log.error('Rollback failed:', rollbackError)
  }
}
```

---

### Step 8: Create Ship It Navigation Logic

**File:** `src/node/core/utils/ship-it-navigator.ts` (NEW)

Pure domain logic - determines WHAT to do, doesn't do git operations:

```typescript
import { isTrunk } from '@shared/types/repo'
import type { ShipItNavigationContext, ShipItNavigationResult } from '@shared/types'

/**
 * Navigation decision from the domain logic.
 * This is a pure function output - no side effects.
 */
export type NavigationDecision = {
  action: 'stay' | 'switch-to-main' | 'switch-to-parent'
  targetBranch?: string
  reason: 'detached-head' | 'dirty-worktree' | 'not-on-shipped' | 'shipped-to-main' | 'shipped-to-parent'
}

/**
 * Pure function that determines where the user should navigate after Ship It.
 * No git operations - just business logic.
 *
 * @param context - Current state before navigation decision
 * @returns Decision about what action to take
 */
export function determineNavigationDecision(context: ShipItNavigationContext): NavigationDecision {
  const {
    shippedBranch,
    prTargetBranch,
    userCurrentBranch,
    wasDetached,
    isWorkingTreeClean
  } = context

  // If user was in detached HEAD, stay there
  if (wasDetached) {
    return { action: 'stay', reason: 'detached-head' }
  }

  // If working tree is dirty, can't switch
  if (!isWorkingTreeClean) {
    return { action: 'stay', reason: 'dirty-worktree' }
  }

  // If user was NOT on the shipped branch, stay where they are
  if (userCurrentBranch !== shippedBranch) {
    return { action: 'stay', reason: 'not-on-shipped' }
  }

  // User WAS on the shipped branch - need to navigate away
  // Determine target: main or parent branch
  if (isTrunk(prTargetBranch)) {
    return {
      action: 'switch-to-main',
      targetBranch: prTargetBranch,
      reason: 'shipped-to-main'
    }
  }

  return {
    action: 'switch-to-parent',
    targetBranch: prTargetBranch,
    reason: 'shipped-to-parent'
  }
}

/**
 * Generates the user-facing message based on navigation result.
 *
 * @param result - The navigation result
 * @returns Human-readable message for toast
 */
export function generateNavigationMessage(result: ShipItNavigationResult): string {
  const { action, targetBranch, needsRebase } = result

  const rebaseNotice = needsRebase ? ' Remaining branches need rebasing.' : ''

  switch (action) {
    case 'switched-to-main':
    case 'switched-to-parent':
      return `Shipped! Switched to ${targetBranch}.${rebaseNotice}`
    case 'stayed':
      if (needsRebase) {
        return `Shipped!${rebaseNotice}`
      }
      return 'Shipped!'
  }
}
```

**File:** `src/node/core/ship-it-service.ts` (NEW)

Orchestration layer - does the actual git operations (same level as rebase-executor.ts):

```typescript
import type { ShipItNavigationContext, ShipItNavigationResult } from '@shared/types'
import { getGitAdapter, supportsMerge } from './git-adapter'
import { branchExists, canFastForward, findLocalTrunk } from './utils/branch-utils'
import { determineNavigationDecision, generateNavigationMessage, type NavigationDecision } from './utils/ship-it-navigator'

/**
 * Executes Ship It navigation based on domain decisions.
 * Separates decision logic from execution.
 *
 * @param context - Current state context (includes repoPath)
 * @returns Navigation result with action taken and message
 */
export async function executeShipItNavigation(
  context: ShipItNavigationContext
): Promise<ShipItNavigationResult> {
  // 1. Get the decision from domain logic (pure)
  const decision = determineNavigationDecision(context)

  // 2. Execute the decision (side effects)
  return executeDecision(decision, context)
}

async function executeDecision(
  decision: NavigationDecision,
  context: ShipItNavigationContext
): Promise<ShipItNavigationResult> {
  const { repoPath, hasChildren } = context
  const needsRebase = hasChildren

  switch (decision.action) {
    case 'stay':
      return {
        action: 'stayed',
        needsRebase,
        message: generateNavigationMessage({ action: 'stayed', needsRebase, message: '' })
      }

    case 'switch-to-main':
      return navigateToMain(repoPath, needsRebase)

    case 'switch-to-parent':
      return navigateToParent(repoPath, decision.targetBranch!, needsRebase)
  }
}

async function navigateToMain(
  repoPath: string,
  needsRebase: boolean
): Promise<ShipItNavigationResult> {
  const git = getGitAdapter()

  const trunkName = await findLocalTrunk(repoPath)
  if (!trunkName) {
    return {
      action: 'stayed',
      needsRebase,
      message: 'Shipped! Could not find main branch.'
    }
  }

  const remoteTrunk = `origin/${trunkName}`

  // Check if we can ff
  const canFF = await canFastForward(repoPath, trunkName, remoteTrunk)
  if (!canFF) {
    return {
      action: 'stayed',
      needsRebase,
      message: `Shipped! Cannot switch to ${trunkName}: has local changes.`
    }
  }

  // Perform checkout + ff
  try {
    await git.checkout(repoPath, trunkName)

    if (supportsMerge(git)) {
      await git.merge(repoPath, remoteTrunk, { ffOnly: true })
    }

    const result: ShipItNavigationResult = {
      action: 'switched-to-main',
      targetBranch: trunkName,
      needsRebase,
      message: ''
    }
    result.message = generateNavigationMessage(result)
    return result
  } catch {
    return {
      action: 'stayed',
      needsRebase,
      message: `Shipped! Could not switch to ${trunkName}.`
    }
  }
}

async function navigateToParent(
  repoPath: string,
  parentBranch: string,
  needsRebase: boolean
): Promise<ShipItNavigationResult> {
  const git = getGitAdapter()

  // Check if parent branch exists locally
  const parentExists = await branchExists(repoPath, parentBranch)

  if (!parentExists) {
    // Fallback to main
    return navigateToMain(repoPath, needsRebase)
  }

  // Checkout parent branch
  try {
    await git.checkout(repoPath, parentBranch)

    const result: ShipItNavigationResult = {
      action: 'switched-to-parent',
      targetBranch: parentBranch,
      needsRebase,
      message: ''
    }
    result.message = generateNavigationMessage(result)
    return result
  } catch {
    return {
      action: 'stayed',
      needsRebase,
      message: `Shipped! Could not switch to ${parentBranch}.`
    }
  }
}
```

---

### Step 9: Create utility for finding valid PR target

**File:** `src/node/core/utils/find-pr-target.ts` (NEW)

This utility is used by "Create PR" to automatically target the correct branch (skipping merged ancestors):

```typescript
import { isTrunk } from '@shared/types/repo'
import type { GitForgeState } from '@shared/types/git-forge'

/**
 * Finds the correct PR target for a branch by walking up the stack
 * and returning the first unmerged ancestor, or main/master.
 *
 * Used when creating a new PR to ensure it doesn't target a merged branch.
 * Includes cycle detection to handle corrupted PR target graphs.
 *
 * @param branchName - The branch we want to create a PR for
 * @param parentBranch - The immediate parent branch in the stack
 * @param forgeState - Current forge state with PR info
 * @param mergedBranchNames - Set of branches that have been merged
 * @returns The branch name to target for the PR
 */
export function findValidPrTarget(
  branchName: string,
  parentBranch: string | null,
  forgeState: GitForgeState,
  mergedBranchNames: Set<string>
): string {
  // If no parent or parent is trunk, target trunk
  if (!parentBranch || isTrunk(parentBranch)) {
    return parentBranch || 'main'
  }

  // Track visited branches for cycle detection
  const visited = new Set<string>()

  // Walk up the stack to find first unmerged ancestor
  let currentTarget = parentBranch

  while (currentTarget && !isTrunk(currentTarget)) {
    // Cycle detection
    if (visited.has(currentTarget)) {
      console.warn(`Cycle detected in PR targets at branch: ${currentTarget}`)
      return 'main'
    }
    visited.add(currentTarget)

    // Check if this branch is merged
    const isMerged = mergedBranchNames.has(currentTarget)

    if (!isMerged) {
      // Found an unmerged ancestor - this is our target
      return currentTarget
    }

    // This ancestor is merged, find its parent
    const parentPr = forgeState.pullRequests.find((p) => p.headRefName === currentTarget)

    if (!parentPr) {
      // No PR found for this branch, can't walk further - target main
      break
    }

    currentTarget = parentPr.baseRefName
  }

  // All ancestors are merged (or we hit main), target main
  return 'main'
}
```

---

### Step 10: Update IPC Contract

**File:** `src/shared/types/ipc.ts`

Add new channel and update shipIt response:

```typescript
export const IPC_CHANNELS = {
  // ... existing channels
  checkout: 'checkout',  // Now handles both local and remote
  // ... rest unchanged
  shipIt: 'shipIt'
} as const

// Update shipIt response type
export interface IpcContract {
  // ... existing contracts

  [IPC_CHANNELS.checkout]: {
    request: { repoPath: string; ref: string }
    response: {
      uiState: UiState | null
      /** Message to display to user (for remote checkouts) */
      message?: string
    }
  }

  [IPC_CHANNELS.shipIt]: {
    request: {
      repoPath: string
      branchName: string
    }
    response: {
      uiState: UiState | null
      /** Message to display to user */
      message?: string
      /** Whether remaining branches need rebasing */
      needsRebase?: boolean
    }
  }
}
```

**File:** `src/shared/types/ipc.ts` (also add new response types at top)

```typescript
/**
 * Response type for checkout operations
 */
export type CheckoutResponse = {
  uiState: UiState | null
  /** Message to display to user (for remote checkouts) */
  message?: string
}

/**
 * Response type for Ship It operations
 */
export type ShipItResponse = {
  uiState: UiState | null
  /** Message to display to user */
  message?: string
  /** Whether remaining branches need rebasing */
  needsRebase?: boolean
}
```

---

### Step 11: Update Checkout Handler

**File:** `src/node/handlers/repo.ts`

Update the checkout handler to use smartCheckout:

```typescript
import { smartCheckout } from '../core/utils/smart-checkout'
import { parseRemoteBranch } from '../core/utils/branch-utils'

const checkoutHandler: IpcHandlerOf<'checkout'> = async (_event, { repoPath, ref }) => {
  const result = await smartCheckout(repoPath, ref)

  if (!result.success) {
    throw new Error(result.error)
  }

  const uiState = await getUiState(repoPath)

  // Generate message for remote checkouts
  let message: string | undefined
  const parsed = parseRemoteBranch(ref)
  if (parsed) {
    message = `Synced to ${parsed.localBranch}`
  }

  return { uiState, message }
}
```

---

### Step 12: Update Ship It Handler with Navigation Logic

**File:** `src/node/handlers/repo.ts`

```typescript
import { executeShipItNavigation } from '../core/ship-it-service'
import type { ShipItNavigationContext } from '@shared/types'

const shipIt: IpcHandlerOf<'shipIt'> = async (_event, { repoPath, branchName }) => {
  // Note: hasStaleTarget validation happens at UI level (button disabled)
  // This handler assumes the PR target is valid

  const gitAdapter = getGitAdapter()

  // Capture state BEFORE shipping
  const workingTreeStatus = await gitAdapter.getWorkingTreeStatus(repoPath)
  const userCurrentBranch = workingTreeStatus.currentBranch
  const wasDetached = workingTreeStatus.detached
  const isWorkingTreeClean = workingTreeStatus.allChangedFiles.length === 0

  // 1. Get PR info
  const forgeState = await gitForgeService.getState(repoPath)
  const pr = forgeState.pullRequests.find(
    (p) => p.headRefName === branchName && p.state === 'open'
  )

  if (!pr) {
    throw new Error(`No open PR found for branch "${branchName}"`)
  }

  const prTargetBranch = pr.baseRefName  // e.g., 'main' or 'feature-1'

  // 2. Check if shipped branch has children
  const hasChildren = forgeState.pullRequests.some(
    (p) => p.baseRefName === branchName && p.state === 'open'
  )

  // 3. Merge via GitHub API (squash merge)
  await gitForgeService.mergePullRequest(repoPath, pr.number)

  // 4. Fetch to update remote refs
  await gitAdapter.fetch(repoPath)

  // 5. Determine and execute navigation
  const navContext: ShipItNavigationContext = {
    repoPath,  // Pass repoPath through context
    shippedBranch: branchName,
    prTargetBranch,
    userCurrentBranch,
    wasDetached,
    hasChildren,
    isWorkingTreeClean
  }

  const navResult = await executeShipItNavigation(navContext)

  // 6. Return updated UI state with navigation result
  const uiState = await getUiState(repoPath)
  return {
    uiState,
    message: navResult.message,
    needsRebase: navResult.needsRebase
  }
}
```

---

### Step 13: Update Preload

**File:** `src/web-preload/index.ts`

The checkout API signature remains the same, but update types if needed:

```typescript
// No changes needed - checkout already exists
// The response type change is handled by TypeScript through IpcContract
```

---

### Step 14: Update UiStateContext

**File:** `src/web/contexts/UiStateContext.tsx`

Update the context to handle new response types:

```typescript
// Update checkout to handle message
const checkout = useCallback(
  async (params: { ref: string }) => {
    if (!repoPath) return
    try {
      const result = await window.api.checkout({ repoPath, ...params })
      if (result.uiState) setUiState(result.uiState)
      if (result.message) {
        toast.success(result.message)
      }
    } catch (error) {
      log.error('Checkout failed:', error)
      toast.error('Checkout failed', {
        description: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },
  [repoPath]
)

// Update shipIt to handle new response
const shipIt = useCallback(
  async (params: { branchName: string }) => {
    if (!repoPath) return
    try {
      const result = await window.api.shipIt({ repoPath, ...params })
      if (result.uiState) setUiState(result.uiState)
      if (result.message) {
        // Use info toast if needs rebase, success otherwise
        if (result.needsRebase) {
          toast.info(result.message)
        } else {
          toast.success(result.message)
        }
      }
    } catch (error) {
      log.error('Ship It failed:', error)
      toast.error('Ship It failed', {
        description: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },
  [repoPath]
)
```

---

### Step 15: Update BranchBadge (Presentation Only)

**File:** `src/web/components/BranchBadge.tsx`

The component no longer needs to know about local vs remote - it just calls checkout:

```typescript
export function BranchBadge({ data }: { data: UiBranch }): React.JSX.Element {
  const { checkout, deleteBranch, isWorkingTreeDirty } = useUiStateContext()

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isWorkingTreeDirty) return
    e.stopPropagation()
    // Backend handles both local and remote refs
    checkout({ ref: data.name })
  }

  // ... rest unchanged
}
```

---

### Step 16: Update ShipItButton (Disable for Stale Target)

**File:** `src/web/components/GitForgeSection.tsx` (or wherever Ship It button is)

```typescript
// In the component that renders Ship It button:

const isStaleTarget = branch.hasStaleTarget === true

<Button
  onClick={() => shipIt({ branchName: branch.name })}
  disabled={isStaleTarget || !pr.isMergeable}
  title={isStaleTarget ? 'PR targets merged branch - retarget on GitHub first' : undefined}
>
  Ship it!
</Button>
```

---

### Step 17: Update Create PR to Use Valid Target

**File:** `src/node/handlers/repo.ts`

Update the `createPullRequest` handler to find the correct target:

```typescript
import { findValidPrTarget } from '../core/utils/find-pr-target'

const createPullRequest: IpcHandlerOf<'createPullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  try {
    // Get current state
    const forgeState = await gitForgeService.getState(repoPath)
    const config: Configuration = { repoPath }
    const repo = await buildRepoModel(config)

    // Get merged branch names for target validation
    const trunkBranch = repo.branches.find((b) => b.isTrunk && !b.isRemote)
    const trunkRef = trunkBranch?.ref ?? 'main'
    const gitAdapter = getGitAdapter()
    const mergedBranchNames = await detectMergedBranches(repoPath, repo.branches, trunkRef, gitAdapter)

    // Find the parent branch from the stack structure
    const parentBranch = findParentBranchInStack(headBranch, repo)

    // Find valid target (skips merged ancestors)
    const targetBranch = findValidPrTarget(
      headBranch,
      parentBranch,
      forgeState,
      new Set(mergedBranchNames)
    )

    // Create PR with correct target
    await createPullRequestCore(repoPath, headBranch, targetBranch)
    return getUiState(repoPath)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await dialog.showMessageBox({
      type: 'error',
      title: 'Failed to Create Pull Request',
      message: 'Unable to create pull request',
      detail: errorMessage,
      buttons: ['OK']
    })

    throw error
  }
}
```

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/shared/types/repo.ts` | Modify | Add trunk constants, `isTrunk`, and git operation result types |
| `src/shared/types/ui.ts` | Modify | Add `isRemote`, `hasStaleTarget` to `UiBranch`, add ShipIt navigation types |
| `src/shared/types/ipc.ts` | Modify | Update `checkout` and `shipIt` response types |
| `src/node/core/git-adapter/interface.ts` | Modify | Add `merge` method + type guard |
| `src/node/core/git-adapter/simple-git-adapter.ts` | Modify | Implement `merge` method |
| `src/node/core/utils/build-ui-state.ts` | Modify | Pass `isRemote`, `hasStaleTarget` to UiBranch |
| `src/node/core/utils/branch-utils.ts` | Create | Shared branch utilities (branchExists, canFF, parseRemote, findLocalTrunk) |
| `src/node/core/utils/smart-checkout.ts` | Create | Smart checkout function with fetch+ff+rollback |
| `src/node/core/utils/ship-it-navigator.ts` | Create | Pure Ship It navigation decision logic |
| `src/node/core/utils/find-pr-target.ts` | Create | PR target validation with cycle detection |
| `src/node/core/ship-it-service.ts` | Create | Ship It navigation execution |
| `src/node/handlers/repo.ts` | Modify | Update checkout, shipIt, createPullRequest handlers |
| `src/web/contexts/UiStateContext.tsx` | Modify | Update checkout and shipIt to handle new responses |
| `src/web/components/BranchBadge.tsx` | Modify | Simplified - just calls checkout |
| `src/web/components/GitForgeSection.tsx` | Modify | Disable Ship It when `hasStaleTarget` |

---

## User Feedback Messages

**Note:** All feedback uses toast notifications. No modal dialogs for this feature.

| Scenario | Toast Type | Message |
|----------|------------|---------|
| Remote checkout success | Success | "Synced to main" |
| Remote checkout blocked (diverged) | Error | "Cannot sync: main has local changes or has diverged" |
| Remote checkout blocked (network) | Error | "Failed to fetch from origin" |
| Ship It success, switched to main | Success | "Shipped! Switched to main." |
| Ship It success, switched to parent | Success | "Shipped! Switched to feature-1." |
| Ship It success, stayed (has children) | Info | "Shipped! Remaining branches need rebasing." |
| Ship It success, stayed (dirty) | Info | "Shipped! Switch branches when ready." |
| Ship It success, stayed (on other branch) | Success | "Shipped!" |

**Note:** Ship It button is **disabled** (not clickable) when PR targets merged branch. Tooltip: "PR targets merged branch - retarget on GitHub first"

---

## Testing Matrix

### Remote Branch Click Tests

**Category: Happy Path**
- [ ] Click `origin/main` when local is behind → succeeds, toast "Synced to main"
- [ ] Click `origin/main` when local is up-to-date → succeeds, toast "Synced to main"
- [ ] Click `origin/main` when local doesn't exist → creates and checks out
- [ ] Click `origin/feature/foo` (slash in name) → works correctly

**Category: Blocked Scenarios**
- [ ] Click `origin/main` when local has unpushed commits → blocked, toast error
- [ ] Click `origin/main` when local has diverged → blocked, toast error
- [ ] Click `origin/main` with dirty working tree → blocked (existing behavior)
- [ ] Click `origin/main` with network offline → toast "Failed to fetch"

**Category: Rollback**
- [ ] Checkout succeeds but ff fails → rollback to original branch

**Category: Unchanged Behavior**
- [ ] Click local `main` → regular checkout (no fetch, no ff)

**Category: Edge Cases**
- [ ] Click `refs/remotes/origin/main` (full ref format) → parsed correctly
- [ ] Click `origin/feature/deeply/nested/branch` → parsed correctly

### Ship It Navigation Tests

**Category: User on Shipped Branch**
- [ ] Ship only branch, user on it → switch to main
- [ ] Ship bottom of stack, user on it → switch to main, toast "needs rebase"
- [ ] Ship middle of stack, user on it → switch to parent
- [ ] Ship top of stack, user on it → switch to parent

**Category: User on Different Branch**
- [ ] Ship bottom of stack, user on child → stay on child, toast "needs rebase"
- [ ] Ship middle of stack, user on other → stay, toast "needs rebase"
- [ ] Ship top of stack, user on other → stay on current

**Category: Special States**
- [ ] Ship with dirty working tree → stay, toast "switch when ready"
- [ ] Ship with user in detached HEAD → stay in detached HEAD

**Category: Fallback Scenarios**
- [ ] Ship when parent branch deleted → fallback to main
- [ ] Ship when parent branch not local → fallback to main

### PR Target Validation Tests

**Category: Create PR Target Selection**
- [ ] Create PR when parent is unmerged → targets parent
- [ ] Create PR when parent is merged → targets main (skips parent)
- [ ] Create PR when parent merged, grandparent unmerged → targets grandparent
- [ ] Create PR when all ancestors merged → targets main
- [ ] Create PR on branch directly off main → targets main

**Category: Ship It Button State**
- [ ] Ship It button enabled when PR targets main
- [ ] Ship It button enabled when PR targets unmerged branch
- [ ] Ship It button **disabled** when PR targets merged branch (tooltip shown)

**Category: Cycle Detection**
- [ ] PR target graph has cycle → detects and falls back to main

### Integration Tests

- [ ] Full stacked flow: ship bottom → user lands on main → rebase children
- [ ] External merge on GitHub → click origin/main → synced to latest
- [ ] Local commits on main → click origin/main → blocked with clear error
- [ ] Ship bottom, then Create PR on child → PR targets main (not shipped branch)
- [ ] Ship bottom, child PR still targets shipped → Ship It blocked on child

### Unit Tests for Domain Logic

**File:** `src/node/core/utils/__tests__/ship-it-navigator.test.ts`

**Category: determineNavigationDecision (pure function)**
- [ ] Returns 'stay' when wasDetached is true
- [ ] Returns 'stay' when isWorkingTreeClean is false
- [ ] Returns 'stay' when userCurrentBranch !== shippedBranch
- [ ] Returns 'switch-to-main' when prTargetBranch is 'main'
- [ ] Returns 'switch-to-main' when prTargetBranch is 'master'
- [ ] Returns 'switch-to-parent' when prTargetBranch is non-trunk

```typescript
describe('determineNavigationDecision', () => {
  const baseContext: ShipItNavigationContext = {
    repoPath: '/test',
    shippedBranch: 'feature-1',
    prTargetBranch: 'main',
    userCurrentBranch: 'feature-1',
    wasDetached: false,
    hasChildren: false,
    isWorkingTreeClean: true
  }

  it('returns stay when wasDetached is true', () => {
    const result = determineNavigationDecision({ ...baseContext, wasDetached: true })
    expect(result).toEqual({ action: 'stay', reason: 'detached-head' })
  })

  it('returns stay when working tree is dirty', () => {
    const result = determineNavigationDecision({ ...baseContext, isWorkingTreeClean: false })
    expect(result).toEqual({ action: 'stay', reason: 'dirty-worktree' })
  })

  it('returns stay when user not on shipped branch', () => {
    const result = determineNavigationDecision({ ...baseContext, userCurrentBranch: 'other' })
    expect(result).toEqual({ action: 'stay', reason: 'not-on-shipped' })
  })

  it('returns switch-to-main when pr targets main', () => {
    const result = determineNavigationDecision(baseContext)
    expect(result).toEqual({ action: 'switch-to-main', targetBranch: 'main', reason: 'shipped-to-main' })
  })

  it('returns switch-to-main when pr targets master', () => {
    const result = determineNavigationDecision({ ...baseContext, prTargetBranch: 'master' })
    expect(result).toEqual({ action: 'switch-to-main', targetBranch: 'master', reason: 'shipped-to-main' })
  })

  it('returns switch-to-parent when pr targets non-trunk branch', () => {
    const result = determineNavigationDecision({ ...baseContext, prTargetBranch: 'feature-0' })
    expect(result).toEqual({ action: 'switch-to-parent', targetBranch: 'feature-0', reason: 'shipped-to-parent' })
  })
})
```

**File:** `src/node/core/utils/__tests__/branch-utils.test.ts`

**Category: parseRemoteBranch**
- [ ] Parses 'origin/main' correctly
- [ ] Parses 'origin/feature/foo' correctly (nested slashes)
- [ ] Parses 'refs/remotes/origin/main' correctly
- [ ] Returns null for invalid format (no slash)
- [ ] Returns null for empty string

```typescript
describe('parseRemoteBranch', () => {
  it('parses origin/main correctly', () => {
    expect(parseRemoteBranch('origin/main')).toEqual({ remote: 'origin', localBranch: 'main' })
  })

  it('parses origin/feature/foo correctly (nested slashes)', () => {
    expect(parseRemoteBranch('origin/feature/foo')).toEqual({ remote: 'origin', localBranch: 'feature/foo' })
  })

  it('parses refs/remotes/origin/main correctly', () => {
    expect(parseRemoteBranch('refs/remotes/origin/main')).toEqual({ remote: 'origin', localBranch: 'main' })
  })

  it('returns null for invalid format (no slash)', () => {
    expect(parseRemoteBranch('main')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseRemoteBranch('')).toBeNull()
  })
})
```

**File:** `src/node/core/utils/__tests__/find-pr-target.test.ts`

**Category: findValidPrTarget**
- [ ] Returns parent when parent is unmerged
- [ ] Returns main when parent is merged
- [ ] Walks up stack correctly through multiple merged branches
- [ ] Detects cycles and returns main
- [ ] Returns main when no PR found for ancestor

```typescript
describe('findValidPrTarget', () => {
  const createForgeState = (prs: Array<{ head: string; base: string }>): GitForgeState => ({
    pullRequests: prs.map((pr, i) => ({
      id: `${i}`,
      number: i + 1,
      headRefName: pr.head,
      baseRefName: pr.base,
      state: 'open' as const,
      title: '',
      url: '',
      isDraft: false,
      isMergeable: true,
      checks: []
    })),
    checks: []
  })

  it('returns parent when parent is unmerged', () => {
    const result = findValidPrTarget('feature-2', 'feature-1', createForgeState([]), new Set())
    expect(result).toBe('feature-1')
  })

  it('returns main when parent is merged', () => {
    const result = findValidPrTarget(
      'feature-2',
      'feature-1',
      createForgeState([{ head: 'feature-1', base: 'main' }]),
      new Set(['feature-1'])
    )
    expect(result).toBe('main')
  })

  it('walks up stack through multiple merged branches to main', () => {
    const result = findValidPrTarget(
      'feature-3',
      'feature-2',
      createForgeState([
        { head: 'feature-2', base: 'feature-1' },
        { head: 'feature-1', base: 'main' }
      ]),
      new Set(['feature-1', 'feature-2'])
    )
    expect(result).toBe('main')
  })

  it('stops at first unmerged ancestor', () => {
    const result = findValidPrTarget(
      'feature-3',
      'feature-2',
      createForgeState([
        { head: 'feature-2', base: 'feature-1' },
        { head: 'feature-1', base: 'main' }
      ]),
      new Set(['feature-2']) // Only feature-2 merged
    )
    expect(result).toBe('feature-1')
  })

  it('detects cycles and returns main', () => {
    const result = findValidPrTarget(
      'feature-2',
      'feature-1',
      createForgeState([
        { head: 'feature-1', base: 'feature-2' }, // Cycle
        { head: 'feature-2', base: 'feature-1' }
      ]),
      new Set(['feature-1', 'feature-2'])
    )
    expect(result).toBe('main')
  })

  it('returns main when no PR found for ancestor', () => {
    const result = findValidPrTarget(
      'feature-2',
      'feature-1',
      createForgeState([]), // No PRs
      new Set(['feature-1'])
    )
    expect(result).toBe('main')
  })
})
```

**File:** `src/shared/types/__tests__/repo.test.ts`

**Category: isTrunk**
- [ ] Returns true for 'main'
- [ ] Returns true for 'master'
- [ ] Returns false for other branch names

```typescript
describe('isTrunk', () => {
  it('returns true for main', () => {
    expect(isTrunk('main')).toBe(true)
  })

  it('returns true for master', () => {
    expect(isTrunk('master')).toBe(true)
  })

  it('returns false for feature branches', () => {
    expect(isTrunk('feature-1')).toBe(false)
    expect(isTrunk('develop')).toBe(false)
    expect(isTrunk('origin/main')).toBe(false)
  })
})
```

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  - BranchBadge: calls checkout({ ref })                        │
│  - GitForgeSection: disables Ship It when hasStaleTarget       │
│  - UiStateContext: displays toast messages from responses      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ IPC
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Node/Electron)                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Handlers (repo.ts)                   │   │
│  │  - checkout: uses smartCheckout()                        │   │
│  │  - shipIt: uses executeShipItNavigation()               │   │
│  │  - createPR: uses findValidPrTarget()                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┼───────────────┐                 │
│              ▼               ▼               ▼                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐      │
│  │ smartCheckout │  │ ship-it-svc   │  │ Pure Utils    │      │
│  │  (function)   │  │  (function)   │  │               │      │
│  │               │  │               │  │               │      │
│  │ - Local path  │  │ - Execute nav │  │ - Navigation  │      │
│  │ - Remote path │  │ - Call domain │  │   decision    │      │
│  │   (fetch+ff)  │  │               │  │ - PR target   │      │
│  └───────────────┘  └───────────────┘  └───────────────┘      │
│              │               │               │                 │
│              └───────────────┼───────────────┘                 │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Shared Utilities                        │   │
│  │  - branch-utils.ts (branchExists, canFF, parseRemote)   │   │
│  │  - repo.ts (TRUNK_BRANCHES, isTrunk)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    GitAdapter                            │   │
│  │  - checkout, merge, fetch, isAncestor, etc.             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

1. **Simple Functions over Classes**: Uses plain functions (smartCheckout, executeShipItNavigation) following existing codebase patterns
2. **Domain/Service Separation**: Pure navigation logic (determineNavigationDecision) is easily testable without git mocks
3. **Backend Owns Business Logic**: Frontend just calls `checkout({ ref })` - doesn't know local vs remote
4. **All-or-Nothing with Rollback**: Remote checkout saves state and rolls back on failure
5. **Types in Existing Files**: Result types added to existing `repo.ts` and `ui.ts` for consistency
6. **Cycle Detection**: PR target walking protects against corrupted data
