# Plan: Global Worktree Selector

## Problem Statement

Currently, worktrees in Teapot are treated as throwaway artifacts attached to branches. They're created in temp directories (`/tmp/teapot/worktrees/`), and the UI surfaces them as small badges on branches rather than as first-class navigation targets. This model breaks down for large, complex repos where worktree setup is expensive (build caches, IDE indexes, node_modules, virtualenvs, etc.). Users in these environments want a small set of **persistent worktrees** they switch between regularly — checking out different branches on each one as work moves forward.

### Current Pain Points

1. **Worktrees are ephemeral** — Created in `/tmp`, deleted easily. No concept of "my worktrees."
2. **No quick-switch UX** — Switching worktrees requires finding the right branch badge, right-clicking, navigating a context menu. There's no global affordance.
3. **Branch-centric model** — The mental model is "branch → worktree" when it should also support "worktree → branch." A persistent worktree outlives any single branch.
4. **Active worktree is barely visible** — The current `WorktreeBadge` in the topbar is compact and informational only; it doesn't invite interaction.

### Target Workflow

1. User has 2–4 persistent worktrees (e.g., `~/dev/myrepo`, `~/dev/myrepo-review`, `~/dev/myrepo-experiment`)
2. They work in one worktree on `feature-A`
3. When done, they either:
   - **Switch worktree** (click the selector → pick a different worktree to view/manage)
   - **Checkout a new branch** on the current worktree (the worktree persists, the branch changes)
4. The app's entire view (stack, working tree, commit graph) updates to reflect the selected worktree

---

## UX Design

### Option A: Topbar Breadcrumb Pattern (Recommended)

Extend the existing topbar to a two-level breadcrumb: **Repo > Worktree**

```
┌─────────────────────────────────────────────────────────┐
│  myrepo  ▾  /  ~/dev/myrepo-review  ▾    ● GitHub     │
│  [repo]       [worktree selector]        [forge]       │
└─────────────────────────────────────────────────────────┘
```

**Why this works:**
- Natural extension of the existing repo selector pattern
- Reads left-to-right: which repo → which worktree within that repo
- Doesn't consume additional vertical space
- The `/` separator creates a visual hierarchy without cluttering
- Worktree selector only appears when >1 worktree exists (progressive disclosure)

**Worktree Selector Dropdown:**

```
┌──────────────────────────────────────┐
│  ● ~/dev/myrepo          (main)   ✓ │  ← main worktree, active
│    main · clean                      │
│──────────────────────────────────────│
│  ○ ~/dev/myrepo-review             │  ← secondary worktree
│    feature-auth · 2 changes          │
│──────────────────────────────────────│
│  ○ ~/dev/myrepo-experiment          │  ← secondary worktree
│    fix-perf · clean                  │
│──────────────────────────────────────│
│  + Add Existing Worktree...          │  ← browse to existing dir
│  + Create New Worktree...            │  ← creates from branch
│──────────────────────────────────────│
│  ⚙ Manage Worktrees                 │  ← opens management view
└──────────────────────────────────────┘
```

Each worktree item shows:
- **Directory name** (abbreviated path, full path on hover tooltip)
- **Current branch** checked out in that worktree
- **Status indicator** — clean (green dot), dirty (yellow dot with change count), stale (red)
- **Active marker** — checkmark on the currently viewed worktree
- **Quick actions** on hover/right-click: Open in Editor, Open in Terminal, Copy Path

**Trigger label** (what's shown in the topbar button):
- Just the folder name of the active worktree: `myrepo-review ▾`
- If it's the main worktree, show the repo name (same as today, no visual change for single-worktree repos)

### Option B: Side Panel Tabs (Alternative)

Worktrees as persistent tabs at the top of the main content area, similar to browser tabs or IDE editor tabs.

```
┌───────────────┬──────────────────┬────────────────┬─────┐
│ myrepo (main) │ myrepo-review    │ myrepo-exp     │  +  │
├───────────────┴──────────────────┴────────────────┴─────┤
│                                                         │
│  [Stack view for selected worktree]                     │
│                                                         │
```

**Pros:** Very visible, fast 1-click switching, shows all worktrees at a glance
**Cons:** Consumes vertical space, doesn't scale beyond ~4 worktrees without overflow, different pattern from the existing repo selector

### Recommendation

**Option A (breadcrumb)** is recommended because:
- It's consistent with the existing repo-selector UX pattern
- Zero additional vertical space
- Progressive disclosure — invisible for single-worktree repos
- Dropdown gives room for rich metadata per worktree
- Familiar pattern (VS Code's breadcrumbs, terminal multiplexer panes)

---

## Checkout Branch on Worktree

When a user wants to switch the branch that a worktree is pointing to, they need a clear flow. Two entry points:

### Entry Point 1: From the Worktree Selector Dropdown

Each worktree item in the dropdown gets a **"Checkout Branch..."** action (via right-click context menu or a small button). This opens a branch picker scoped to branches not already checked out in another worktree.

```
┌────────────────────────────────────┐
│  Checkout branch in myrepo-review  │
│──────────────────────────────────────│
│  🔍 Search branches...             │
│──────────────────────────────────────│
│  feature-auth           (current)  │
│  feature-payments                  │
│  fix-perf-regression               │
│  experiment/new-ui                 │
│──────────────────────────────────────│
│  ⚠ Branches in other worktrees:   │
│    main (in ~/dev/myrepo)          │
│    fix-perf (in ~/dev/myrepo-exp)  │
└────────────────────────────────────┘
```

### Entry Point 2: From the Stack View

The existing branch context menu already has checkout. When a branch is checked out in a different worktree, the existing `WorktreeBadge` on that branch already shows a toast: "Cannot checkout — already checked out in X." We extend this to offer: **"Switch to that worktree instead?"** as a clickable action in the toast.

---

## Technical Design

### Layer 1: Data Model Changes

#### 1a. Worktree Storage — Persistent Worktrees

Currently, worktrees are created in `/tmp` and are implicitly ephemeral. We need to support user-designated persistent worktree directories.

**Config Store Changes** (`src/node/store.ts`):

```typescript
// Current LocalRepo shape
type LocalRepo = {
  path: string
  isSelected: boolean
  activeWorktreePath: string | null
}

// No schema change needed! The existing activeWorktreePath + the worktrees[]
// from git itself give us everything we need. The only addition is an
// "Add Existing Worktree" flow that scans an arbitrary directory.
```

The key insight: **git already tracks worktrees** (`git worktree list`). We don't need to duplicate this in our config store. The `Repo.worktrees: Worktree[]` from the backend already enumerates all worktrees. What we need is:

1. A way to **add existing worktrees** that aren't created through Teapot (user may have created them via CLI)
2. A way to **switch** `activeWorktreePath` from the topbar (already exists in backend via `configStore.setActiveWorktree`)
3. A way to **checkout a branch** on any worktree, not just the active one (already exists: `checkoutWorktreeBranch` IPC)

#### 1b. New IPC Channel — Create Worktree at Custom Path

Currently `WorktreeOperation.create()` always generates a random path in `/tmp`. Add a variant:

```typescript
// New IPC channel
createWorktreeAtPath: {
  request: { repoPath: string; branch: string; targetPath: string }
  response: { success: boolean; error?: string; worktreePath?: string }
}
```

This allows "Create New Worktree..." to let the user pick a directory.

#### 1c. Surface Worktree List in LocalState

Currently `LocalRepo` only has `activeWorktreePath`. The full worktree list lives in `Repo` (backend model). We need the worktree list available in the topbar *without* needing `UiState` to be loaded (topbar renders before the full repo state loads).

**Approach:** Extend `LocalRepo` to include a lightweight worktree summary:

```typescript
type LocalRepo = {
  path: string
  isSelected: boolean
  activeWorktreePath: string | null
  worktrees: WorktreeSummary[]  // NEW — populated on repo selection
}

type WorktreeSummary = {
  path: string
  branch: string | null
  isMain: boolean
  isDirty: boolean
  isStale: boolean
}
```

This is populated when the repo is selected (or refreshed) via a lightweight `git worktree list --porcelain` call, independent of the full `getUiState` pipeline.

### Layer 2: Backend Changes

#### 2a. `WorktreeOperation.createAtPath(repoPath, branch, targetPath)`

New static method. Similar to `create()` but uses user-specified `targetPath` instead of generating one in `/tmp`.

```typescript
static async createAtPath(
  repoPath: string,
  branch: string,
  targetPath: string
): Promise<WorktreeOperationResult & { worktreePath?: string }> {
  // Validate targetPath is empty or doesn't exist
  // Run: git -C "$repoPath" worktree add "$targetPath" "$branch"
  // Return resolved path
}
```

#### 2b. `WorktreeOperation.addExisting(repoPath, worktreePath)`

Validate that a user-provided directory is already a git worktree of this repo. No git command needed — just verify `.git` file points back to the repo.

#### 2c. Worktree Summary Refresh

New lightweight function (doesn't build full UiState):

```typescript
static async getWorktreeSummaries(repoPath: string): Promise<WorktreeSummary[]> {
  const git = getGitAdapter()
  const worktrees = await git.listWorktrees(repoPath)
  // Map to WorktreeSummary with dirty status
  // This is fast — just git worktree list + git status --porcelain per worktree
}
```

#### 2d. New IPC Handler for `switchWorktree`

The existing `switchWorktree` handler already does the right thing:
1. Updates `configStore.setActiveWorktree`
2. Re-initializes the `GitWatcher` for the new path
3. Returns fresh `UiState`

No changes needed here.

### Layer 3: Frontend Changes

#### 3a. New Component: `WorktreeSelector`

**File:** `src/web/components/WorktreeSelector.tsx`

A Radix `Popover` component (matching the `RepoSelectorHeader` pattern) that:
- Shows the active worktree name as a button
- Opens a dropdown with all worktrees for the selected repo
- Each worktree item shows: name, branch, dirty status
- Actions: switch worktree, open in editor/terminal, checkout branch, create/add worktree

**Props:**
```typescript
interface WorktreeSelectorProps {
  repo: LocalRepo
  activeWorktreePath: string | null
  worktrees: WorktreeSummary[]
  onSwitchWorktree: (worktreePath: string) => Promise<void>
  onCheckoutBranch: (worktreePath: string, branch: string) => Promise<void>
  onCreateWorktree: () => void
  onAddExistingWorktree: () => void
}
```

#### 3b. Update `Topbar.tsx`

Add `WorktreeSelector` next to `RepoSelectorHeader`:

```tsx
<div className="flex items-center gap-1">
  <RepoSelectorHeader ... />
  {worktrees.length > 1 && (
    <>
      <span className="text-muted-foreground text-sm">/</span>
      <WorktreeSelector ... />
    </>
  )}
  <ForgeStatusIndicator />
</div>
```

**Progressive disclosure:** The selector only appears when there are multiple worktrees. Single-worktree repos look identical to today.

#### 3c. New Component: `CheckoutBranchDialog`

**File:** `src/web/components/CheckoutBranchDialog.tsx`

Modal dialog with:
- Search/filter input for branch names
- List of available branches (excluding those checked out in other worktrees)
- Section showing branches that are "taken" by other worktrees (grayed out with worktree path)
- Calls `checkoutWorktreeBranch` IPC on selection

#### 3d. Update `WorktreeBadge.tsx`

When a user tries to checkout a branch that's in another worktree (toast currently says "Cannot checkout — already checked out in X"), add an action button to the toast: **"Switch to worktree"** that calls `switchWorktree`.

#### 3e. Context/State Updates

**`LocalStateContext.tsx`:**
- Add `worktreeSummaries` to context value
- Refresh summaries when repo is selected and on git watcher events
- Expose `switchWorktree` and `checkoutBranchInWorktree` actions

**`UiStateContext.tsx`:**
- `switchWorktree` already exists — wire it to the new selector
- Add `checkoutBranchInWorktree` callback wrapping the existing IPC

### Layer 4: Worktree Lifecycle Improvements

#### 4a. "Add Existing Worktree" Flow

1. User clicks "Add Existing Worktree..." in the dropdown
2. Native folder picker opens (`window.api.showFolderPicker`)
3. Backend validates the selected directory is a git worktree of the current repo
4. If valid, git already knows about it — just refresh the worktree list
5. If invalid, show error toast: "This directory is not a worktree of {repo-name}"

Note: git tracks all worktrees internally. If a worktree was created via CLI (`git worktree add ~/dev/myrepo-review feature-branch`), Teapot will already see it in `git worktree list`. The "Add Existing Worktree" flow is mainly for cases where the user wants to verify and bring attention to a specific worktree — but realistically, just refreshing the list is sufficient. This action could alternatively be labeled **"Create New Worktree..."** and always go through the create flow.

#### 4b. "Create New Worktree" Flow

1. User clicks "Create New Worktree..." in the dropdown
2. Dialog opens with:
   - **Branch selector** — pick which branch to check out
   - **Location picker** — where to create the worktree directory (defaults to sibling of repo: `../myrepo-worktree-{branch}`)
3. Backend calls `git worktree add <path> <branch>`
4. On success, automatically switch to the new worktree

#### 4c. Worktree Removal

Already implemented. The existing `WorktreeBadge` context menu has "Delete Worktree" with confirmation. This stays as-is but also becomes accessible from the worktree selector dropdown context menu.

---

## Implementation Phases

### Phase 1: Core Selector (MVP)

**Goal:** Ship the worktree selector in the topbar that enables fast switching between existing worktrees.

**Changes:**
1. `WorktreeSelector` component — dropdown with worktree list, switch action
2. `Topbar.tsx` update — breadcrumb layout with progressive disclosure
3. Wire `switchWorktree` from `UiStateContext` to the selector
4. Populate worktree list from `Repo.worktrees` (already available in backend response)

**Backend:** No changes — all APIs already exist.

**What this gets you:** Users who create worktrees via CLI or via the existing branch context menu can now switch between them with one click from the topbar.

### Phase 2: Checkout Branch on Worktree

**Goal:** Let users change which branch a worktree is pointing to, without leaving the current view.

**Changes:**
1. `CheckoutBranchDialog` component — branch picker scoped to a worktree
2. Context menu on worktree items in the selector: "Checkout Branch..."
3. Wire to existing `checkoutWorktreeBranch` IPC
4. Update toast on checkout conflict: add "Switch to worktree" action

**Backend:** No changes — `checkoutWorktreeBranch` already exists.

### Phase 3: Create Worktree at Custom Path

**Goal:** Let users create persistent worktrees in directories they choose (not `/tmp`).

**Changes:**
1. `WorktreeOperation.createAtPath()` — new backend method
2. New IPC channel `createWorktreeAtPath`
3. "Create New Worktree..." dialog with branch + location pickers
4. Default location: sibling directory of the repo

### Phase 4: Polish and Edge Cases

1. **Keyboard shortcuts** — e.g., `Cmd+Shift+W` to open worktree selector
2. **Worktree status refresh** — lightweight polling or git watcher integration for dirty status of non-active worktrees
3. **Drag-and-drop branch to worktree** — drag a branch from the stack view onto a worktree in the selector to checkout
4. **Stale worktree handling** — auto-prune stale entries, offer to remove them from the selector
5. **Remember last worktree per repo** — already done via `configStore.activeWorktreePath`

---

## File Change Summary

| File | Change | Phase |
|------|--------|-------|
| `src/web/components/WorktreeSelector.tsx` | **New** — Main selector component | 1 |
| `src/web/components/Topbar.tsx` | Update layout to breadcrumb pattern | 1 |
| `src/web/components/RepoSelectorHeader.tsx` | Remove inline `WorktreeBadge` (moved to selector) | 1 |
| `src/web/contexts/UiStateContext.tsx` | Expose `checkoutBranchInWorktree` | 2 |
| `src/web/components/CheckoutBranchDialog.tsx` | **New** — Branch picker for worktree | 2 |
| `src/web/components/WorktreeBadge.tsx` | Add "switch to worktree" toast action | 2 |
| `src/node/operations/WorktreeOperation.ts` | Add `createAtPath()` method | 3 |
| `src/shared/types/ipc.ts` | Add `createWorktreeAtPath` channel | 3 |
| `src/node/handlers/repo.ts` | Register new handler | 3 |

---

## Open Questions

1. **Should the worktree selector be visible when there's only 1 worktree?** Recommendation: No (progressive disclosure). It appears automatically when a second worktree is created. An advanced user who wants to create their first additional worktree can do so from the branch context menu (which already has "Create Worktree").

2. **Should we show worktree dirty status in the selector trigger button?** E.g., a yellow dot when the active worktree has uncommitted changes. Recommendation: Yes — this is useful ambient information and matches the existing `WorktreeBadge` color coding.

3. **What happens when a worktree is deleted externally (rm -rf)?** Already handled — the backend's stale detection (`isStale`) marks these, and the selector shows them with red status + "Remove" action.

4. **Should worktree names be user-editable (aliases)?** Deferred to post-MVP. For now, use the directory name. An alias system would require config-store changes and add complexity.
