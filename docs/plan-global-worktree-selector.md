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

## Worktree Storage: The `/tmp` Problem

### Why `/tmp` is dangerous for persistent worktrees

Currently `WorktreeOperation.create()` places all worktrees in `os.tmpdir()/teapot/worktrees/<random>`:

- **Linux**: `/tmp` is cleared on reboot by `systemd-tmpfiles` / `tmpwatch`. A worktree with uncommitted work would be silently destroyed.
- **macOS**: `os.tmpdir()` resolves to `/private/var/folders/.../T/`, which macOS periodically purges (every 3 days for unused items).
- **Data loss risk**: If a user treats a worktree as persistent (has build caches, uncommitted work, IDE config), a temp-directory purge causes silent data loss *and* leaves git with stale worktree references.

`/tmp` is appropriate only for the internal execution worktrees used during rebases (`/tmp/teapot/exec/`), which are truly ephemeral.

### Best practices for worktree location

The git documentation and community convention is to place worktrees as **siblings of the main repo**:

```
~/dev/
  myrepo/                  ← main worktree (original clone)
  myrepo-review/           ← worktree for code review
  myrepo-experiment/       ← worktree for experiments
```

This pattern:
- Survives reboots
- Keeps worktrees close to the repo for discoverability
- Avoids nesting worktrees inside the repo (which confuses git)
- Works naturally with IDE "Open Recent" and shell history

### Default worktree base path

**Decision:** Add a **"Default worktree location"** setting to `SettingsDialog`.

| Option | Path | Description |
|--------|------|-------------|
| **Next to repository** (default) | `<repo-parent>/<repo-name>-<branch>` | Sibling directory, e.g. `~/dev/myrepo-feature-auth` |
| **Custom path** | User-chosen base directory | e.g. `~/worktrees/myrepo/<branch>` |

The user can always override the path per-worktree in the "Create New Worktree" dialog. This setting only controls the default suggestion.

**Config store change** (`src/node/store.ts`):

```typescript
// Add to StoreSchema
worktreeBasePath: string | null  // null = "next to repository" (default)
```

**Settings UI** (`src/web/components/SettingsDialog.tsx`):

New section between "Preferred Editor" and "GitHub PAT":

```
Worktree Location
  Where new worktrees are created by default.
  ○ Next to repository (recommended)
  ○ Custom path: [ /home/user/worktrees ] [Browse]
```

---

## UX Design: Topbar Breadcrumb Pattern

Extend the existing topbar to a two-level breadcrumb: **Repo / Worktree**

```
┌──────────────────────────────────────────────────────────────┐
│  myrepo  ▾  /  myrepo-review  ▾  ●           ● GitHub      │
│  [repo]       [worktree]      [dirty dot]     [forge]       │
└──────────────────────────────────────────────────────────────┘
```

**Why this works:**
- Natural extension of the existing repo selector pattern
- Reads left-to-right: which repo → which worktree within that repo
- Doesn't consume additional vertical space
- The `/` separator creates a visual hierarchy without cluttering
- Familiar pattern (VS Code's breadcrumbs, terminal multiplexer panes)

### Always-visible selector

The worktree selector is **always visible**, even with a single worktree. This makes the feature discoverable and gives users a clear path to creating their first additional worktree. When there's only one worktree (the main one), the trigger shows:

```
  myrepo  ▾  /  myrepo  ▾
  [repo]       [worktree — same name as repo]
```

The dropdown still shows "Create New Worktree..." so users can get started.

### Dirty status indicator on trigger button

A **yellow dot** appears next to the worktree name when the active worktree has uncommitted changes. This matches the existing `WorktreeBadge` color coding and provides ambient awareness.

```
  myrepo  ▾  /  myrepo-review  ▾  ●      ← yellow dot = dirty
  myrepo  ▾  /  myrepo-review  ▾         ← no dot = clean
  myrepo  ▾  /  myrepo-review  ▾  ●      ← red dot = stale
```

### Worktree Selector Dropdown

```
┌────────────────────────────────────────────┐
│  ● myrepo                     (main)    ✓  │  ← main worktree, active
│    main · clean                             │
│─────────────────────────────────────────────│
│  ● myrepo-review                           │  ← yellow dot = dirty
│    feature-auth · 2 uncommitted changes     │
│─────────────────────────────────────────────│
│  ○ myrepo-experiment                       │  ← gray dot = clean
│    fix-perf · clean                         │
│─────────────────────────────────────────────│
│  ● myrepo-old                    ⚠ stale  │  ← red, path deleted
│    (path no longer exists)                  │
│═════════════════════════════════════════════│
│  + Create New Worktree...                   │
└─────────────────────────────────────────────┘
```

Each worktree item shows:
- **Status dot** — green (active/clean), yellow (dirty), gray (clean, not active), red (stale)
- **Directory name** (abbreviated from path; full path on hover tooltip)
- **"(main)" label** on the main worktree
- **Active checkmark** on the currently viewed worktree
- **Current branch** checked out in that worktree
- **Dirty summary** — "clean" or "N uncommitted changes"

**Click** any worktree item → switch to it (calls `switchWorktree`).

**Right-click** any worktree item → context menu:
- Checkout Branch...
- Open in Editor
- Open in Terminal
- Copy Path
- *(separator)*
- Discard Changes (only shown if dirty)
- Delete Worktree (not shown for main worktree; destructive confirmation if dirty)
- Remove from List (only shown for stale worktrees — calls `git worktree prune`)

**Trigger label** (the button in the topbar):
- Folder name of the active worktree: `myrepo-review ▾`
- If it's the main worktree: shows the repo folder name (visually identical to today's single-worktree behavior)

---

## Checkout Branch on Worktree

When a user wants to switch the branch that a worktree is pointing to, there are two entry points:

### Entry Point 1: From the Worktree Selector Dropdown

Right-click a worktree item → "Checkout Branch..." opens a branch picker scoped to that worktree.

```
┌─────────────────────────────────────────────┐
│  Checkout branch in myrepo-review           │
│─────────────────────────────────────────────│
│  🔍 Search branches...                      │
│─────────────────────────────────────────────│
│  feature-auth               (current)       │
│  feature-payments                           │
│  fix-perf-regression                        │
│  experiment/new-ui                          │
│─────────────────────────────────────────────│
│  Checked out in other worktrees:            │
│    main         → myrepo (main worktree)    │
│    fix-perf     → myrepo-experiment         │
└─────────────────────────────────────────────┘
```

- Branches already checked out in other worktrees are shown but **grayed out** with the worktree they belong to. Git enforces one-worktree-per-branch, so these are informational.
- Selecting a branch calls `checkoutWorktreeBranch` IPC.
- If the worktree is dirty, the checkout is blocked with a clear error: "Worktree has uncommitted changes. Commit or discard them first."

### Entry Point 2: From the Stack View

The existing branch context menu has checkout. When a branch is checked out in a different worktree, the current toast says "Cannot checkout — already checked out in X." We extend this toast with a clickable action: **"Switch to that worktree"** → calls `switchWorktree`.

---

## Technical Design

### Layer 1: Data Model Changes

#### 1a. Worktree List Availability in Topbar

Currently `LocalRepo` only has `activeWorktreePath`. The full worktree list lives in `Repo` (backend). We need worktree data available in the topbar *before* full `UiState` loads.

**Approach:** The `Repo.worktrees: Worktree[]` data already flows through `UiStateContext` on every refresh. We source the worktree list from the existing `UiState` refresh cycle rather than adding a separate fetch. This avoids new IPC channels and keeps a single source of truth.

For the brief moment before `UiState` loads (app startup), the selector shows just the active worktree name from `LocalRepo.activeWorktreePath` with a loading state for the dropdown.

#### 1b. New IPC Channel — Create Worktree at Custom Path

Currently `WorktreeOperation.create()` always generates a random path in `/tmp`. Add a variant:

```typescript
// New IPC channel
createWorktreeAtPath: {
  request: { repoPath: string; branch: string; targetPath: string }
  response: { success: boolean; error?: string; worktreePath?: string; uiState?: UiState | null }
}
```

#### 1c. Config Store — Default Worktree Base Path

```typescript
// Add to StoreSchema
worktreeBasePath: string | null  // null = "next to repository" (default)
```

New methods:
```typescript
getWorktreeBasePath(): string | null
setWorktreeBasePath(path: string | null): void
```

### Layer 2: Backend Changes

#### 2a. `WorktreeOperation.createAtPath(repoPath, branch, targetPath)`

New static method. Similar to `create()` but uses user-specified `targetPath`.

```typescript
static async createAtPath(
  repoPath: string,
  branch: string,
  targetPath: string
): Promise<WorktreeOperationResult & { worktreePath?: string }> {
  // 1. Validate targetPath doesn't already exist or is an empty directory
  // 2. Ensure parent directory exists
  // 3. Run: git -C "$repoPath" worktree add "$targetPath" "$branch"
  // 4. Resolve symlinks → return canonical path
}
```

**Validation rules:**
- `targetPath` must not exist, OR must be an empty directory
- `targetPath` must not be inside the repo directory (git doesn't allow nested worktrees)
- `branch` must not already be checked out in another worktree

#### 2b. Default Path Computation

```typescript
static computeDefaultWorktreePath(
  repoPath: string,
  branch: string,
  customBasePath: string | null
): string {
  const repoName = path.basename(repoPath)
  const safeBranch = branch.replace(/\//g, '-')  // feature/auth → feature-auth

  if (customBasePath) {
    // Custom: <basePath>/<repoName>-<branch>
    return path.join(customBasePath, `${repoName}-${safeBranch}`)
  }
  // Sibling: <repoParent>/<repoName>-<branch>
  return path.join(path.dirname(repoPath), `${repoName}-${safeBranch}`)
}
```

#### 2c. Migrate existing `create()` to use persistent paths

The existing `WorktreeOperation.create()` (called from branch context menu "Create Worktree") should be updated to use the default worktree base path instead of `/tmp`. This is a one-line change — replace the `os.tmpdir()` base with the computed default path.

The `createTemporary()` method (used for rebase execution) keeps using `/tmp` — these are genuinely ephemeral.

### Layer 3: Frontend Changes

#### 3a. New Component: `WorktreeSelector`

**File:** `src/web/components/WorktreeSelector.tsx`

A Radix `Popover` component matching the `RepoSelectorHeader` pattern:

```typescript
interface WorktreeSelectorProps {
  worktrees: Worktree[]        // from Repo.worktrees
  activeWorktreePath: string | null
  repoPath: string
}
```

Internal state:
- `isOpen` — popover visibility
- Consumes `switchWorktree` from `UiStateContext`
- Consumes `confirmationModal` from `UtilityModalsContext` (for delete confirmations)

#### 3b. New Component: `WorktreeSelectorItem`

Individual worktree row in the dropdown. Extracted for context menu handling:

```typescript
interface WorktreeSelectorItemProps {
  worktree: Worktree
  isActive: boolean
  onSwitch: (path: string) => void
  onCheckoutBranch: (worktreePath: string) => void
  onDelete: (worktreePath: string) => void
}
```

#### 3c. Update `Topbar.tsx`

Replace the current flat layout with the breadcrumb pattern:

```tsx
<div className="flex items-center gap-1">
  <RepoSelectorHeader ... />
  <span className="text-muted-foreground/50 text-sm">/</span>
  <WorktreeSelector
    worktrees={uiState?.worktrees ?? []}
    activeWorktreePath={repo?.activeWorktreePath}
    repoPath={repo?.path}
  />
  <ForgeStatusIndicator />
</div>
```

The `WorktreeSelector` needs access to `UiState` data. Currently `Topbar` only uses `LocalStateContext`. We'll add `useUiStateContext()` to `Topbar` to get the worktree list. This is a minimal change — `Topbar` already imports from contexts.

#### 3d. Remove inline `WorktreeBadge` from `RepoSelectorHeader`

The existing `WorktreeBadge` in `RepoSelectorHeader.tsx` (lines 176-181) is replaced by the new `WorktreeSelector`. Remove:

```tsx
// REMOVE this block from RepoSelectorHeader
{isInWorktree && activeWorktree && (
  <WorktreeBadge
    data={{ path: activeWorktree, status: 'active', isMain: false }}
    variant="compact"
  />
)}
```

#### 3e. New Component: `CheckoutBranchDialog`

**File:** `src/web/components/CheckoutBranchDialog.tsx`

Modal dialog with:
- Search/filter input for branch names
- List of local branches (excluding those checked out in other worktrees)
- Grayed-out section showing branches "taken" by other worktrees
- Dirty worktree guard — if target worktree is dirty, show warning and block
- Calls `checkoutWorktreeBranch` IPC on selection

#### 3f. New Component: `CreateWorktreeDialog`

**File:** `src/web/components/CreateWorktreeDialog.tsx`

Dialog for creating a new worktree:

```
┌─────────────────────────────────────────────────┐
│  Create New Worktree                       [X]  │
│─────────────────────────────────────────────────│
│                                                  │
│  Branch                                         │
│  [▾ Select a branch...              ]           │
│                                                  │
│  Location                                       │
│  [ ~/dev/myrepo-feature-auth        ] [Browse]  │
│                                                  │
│  ☐ Switch to this worktree after creation       │
│                                                  │
│                    [Cancel]  [Create Worktree]   │
└─────────────────────────────────────────────────┘
```

- Branch selector filters out branches already in worktrees
- Location auto-fills based on the default worktree base path setting + selected branch name
- "Switch to this worktree after creation" checkbox (default: checked)

#### 3g. Update `WorktreeBadge.tsx` — Toast Improvement

When checkout fails because a branch is in another worktree (currently a plain `toast.info`), enhance:

```typescript
toast.info(`Cannot checkout '${ref}' — already checked out in ${worktreePath}`, {
  action: {
    label: 'Switch to worktree',
    onClick: () => switchWorktree({ worktreePath })
  }
})
```

Sonner supports action buttons on toasts natively.

#### 3h. Settings Dialog Update

Add "Worktree Location" section to `SettingsDialog.tsx`:

```typescript
// New setting section after "Preferred Editor"
<SettingSection>
  <SettingLabel>Default Worktree Location</SettingLabel>
  <SettingDescription>
    Where new worktrees are created. Can be overridden per-worktree.
  </SettingDescription>
  <RadioGroup value={worktreeBasePath === null ? 'sibling' : 'custom'}>
    <Radio value="sibling">Next to repository</Radio>
    <Radio value="custom">
      Custom path
      <input value={worktreeBasePath ?? ''} ... />
      <button onClick={handleBrowseWorktreeBasePath}>Browse</button>
    </Radio>
  </RadioGroup>
</SettingSection>
```

### Layer 4: Context/State Wiring

**`UiStateContext.tsx`:**
- `switchWorktree` already exists — wire to the selector
- Add `checkoutBranchInWorktree` callback wrapping the existing IPC
- Expose `repo.worktrees` for the selector to consume

**`Topbar.tsx`:**
- Add `useUiStateContext()` to access worktree list
- Pass worktree data to `WorktreeSelector`

---

## Edge Cases and Decisions

### Switching worktrees

| Scenario | Behavior |
|----------|----------|
| **Switch while active worktree is dirty** | Allowed. The dirty state is preserved — git worktrees are independent. We switch the *view*, not the working directory. The user may want to check on another worktree without losing context. |
| **Switch while rebase is in progress** | **Blocked.** A rebase locks the active worktree. Show toast: "Cannot switch worktrees during a rebase. Finish or abort the rebase first." Check `uiState.isRebasing` before allowing switch. |
| **Switch to stale worktree** | **Blocked.** Show toast: "This worktree no longer exists. Remove it from the list?" with action button to prune. |
| **Active worktree becomes stale while viewing it** | The git watcher will detect the missing directory on next poll. Show an inline banner in the main view: "This worktree's directory has been removed." with "Switch to main worktree" action. |

### Creating worktrees

| Scenario | Behavior |
|----------|----------|
| **Branch already checked out in another worktree** | Git blocks this. Show error: "Branch 'X' is already checked out in worktree at 'Y'." |
| **Target path already exists and is non-empty** | Block creation. Show error: "Directory already exists and is not empty." |
| **Target path is inside the repo** | Block creation. Show error: "Worktree cannot be created inside the repository." |
| **No local branches to choose from** | Show empty state in the branch picker: "No branches available. Create a branch first." |
| **Detached HEAD worktree** | Supported — show commit SHA instead of branch name in the selector. Label: `abc1234 (detached)`. |

### Checking out branches

| Scenario | Behavior |
|----------|----------|
| **Worktree is dirty** | Block checkout. Show error: "Worktree has uncommitted changes. Commit or discard them first." (Already enforced by `WorktreeOperation.checkoutBranch`.) |
| **Branch is checked out in another worktree** | Branch appears grayed out in the picker. Not selectable. Shows which worktree has it. |
| **Checkout on non-active worktree** | Allowed — the IPC uses `git -C <worktreePath>` so it operates on the target worktree regardless of which one is "active" in the UI. The active worktree's view doesn't change. |

### Deleting worktrees

| Scenario | Behavior |
|----------|----------|
| **Delete main worktree** | Not allowed. "Delete" action is hidden for the main worktree. |
| **Delete currently active worktree** | Delete succeeds, then auto-switch to main worktree. Reset `activeWorktreePath` to `null`. |
| **Delete dirty worktree** | Requires confirmation with destructive variant: "This worktree has uncommitted changes that will be permanently lost." Uses `force: true`. |
| **Delete stale worktree** | Calls `git worktree prune` to clean up git's reference. No directory to delete. |

### Git watcher and state refresh

| Scenario | Behavior |
|----------|----------|
| **Switching worktrees** | `switchWorktree` IPC already re-initializes `GitWatcher` for the new path. The entire `UiState` refreshes, so the stack view updates to show the new worktree's branch/commits. |
| **Forge state after switch** | If the new worktree is on a different branch, the forge state (PRs) may need refresh. The existing `ForgeStateContext` refresh cycle handles this — it's triggered by `UiState` changes. |
| **Dirty status of non-active worktrees** | Fetched when the dropdown opens (or on a timer) via lightweight `git status --porcelain` calls. Not continuously watched — only the active worktree has a `GitWatcher`. |

### Topbar layout

| Scenario | Behavior |
|----------|----------|
| **No repo selected** | Worktree selector not shown. Same as today's empty state. |
| **Single worktree (typical)** | Selector still visible. Shows just the main worktree with "Create New Worktree..." in the dropdown. Trigger label matches repo name, so the breadcrumb reads: `myrepo ▾ / myrepo ▾` — this is intentional and clear. |
| **Long worktree names** | Trigger label truncates with ellipsis after ~20 chars. Full path in tooltip. |
| **Many worktrees (>6)** | Dropdown becomes scrollable (max-height with overflow, same pattern as repo selector). |

---

## Implementation Phases

### Phase 1: Core Selector + Persistent Paths (MVP)

**Goal:** Ship the worktree selector in the topbar with persistent worktree creation.

**Frontend changes:**
1. `WorktreeSelector` component — dropdown with worktree list, click to switch
2. `WorktreeSelectorItem` — individual row with status dot, branch, context menu
3. `Topbar.tsx` update — breadcrumb layout, always visible
4. `RepoSelectorHeader.tsx` — remove inline `WorktreeBadge`
5. Wire `switchWorktree` from `UiStateContext` to the selector
6. Dirty status dot on the trigger button

**Backend changes:**
1. `WorktreeOperation.createAtPath()` — new method for custom paths
2. `WorktreeOperation.create()` — change default path from `/tmp` to sibling directory
3. `WorktreeOperation.computeDefaultWorktreePath()` — path computation helper
4. Config store: `worktreeBasePath` setting (get/set)
5. New IPC channel: `createWorktreeAtPath`
6. Settings dialog: "Default Worktree Location" section

**What this gets you:** Users see all their worktrees in the topbar, switch with one click, and new worktrees are created in persistent locations by default.

### Phase 2: Checkout Branch + Create Dialog

**Goal:** Let users change which branch a worktree is pointing to, and create worktrees with a proper dialog.

**Frontend changes:**
1. `CheckoutBranchDialog` — branch picker scoped to a worktree
2. `CreateWorktreeDialog` — branch + location picker
3. Context menu on worktree items: "Checkout Branch..."
4. Toast improvement: "Switch to worktree" action on checkout conflict

**Backend changes:** None — `checkoutWorktreeBranch` IPC already exists.

### Phase 3: Polish

1. **Keyboard shortcuts** — `Cmd+Shift+W` / `Ctrl+Shift+W` to open worktree selector
2. **Worktree status refresh** — lightweight polling for dirty status of non-active worktrees when dropdown is open
3. **Drag-and-drop branch to worktree** — drag a branch from the stack view onto a worktree in the selector to checkout
4. **Rebase guard** — block worktree switching during active rebase
5. **Auto-switch after delete** — if active worktree is deleted, switch to main

---

## File Change Summary

| File | Change | Phase |
|------|--------|-------|
| `src/web/components/WorktreeSelector.tsx` | **New** — Main selector component | 1 |
| `src/web/components/Topbar.tsx` | Breadcrumb layout, add `useUiStateContext` | 1 |
| `src/web/components/RepoSelectorHeader.tsx` | Remove inline `WorktreeBadge` | 1 |
| `src/node/operations/WorktreeOperation.ts` | Add `createAtPath()`, update `create()` default path | 1 |
| `src/node/store.ts` | Add `worktreeBasePath` setting | 1 |
| `src/shared/types/ipc.ts` | Add `createWorktreeAtPath` channel + settings IPC | 1 |
| `src/node/handlers/repo.ts` | Register new handlers | 1 |
| `src/web/components/SettingsDialog.tsx` | "Default Worktree Location" section | 1 |
| `src/web/components/CheckoutBranchDialog.tsx` | **New** — Branch picker for worktree | 2 |
| `src/web/components/CreateWorktreeDialog.tsx` | **New** — Create worktree dialog | 2 |
| `src/web/components/WorktreeBadge.tsx` | Toast "Switch to worktree" action | 2 |
| `src/web/contexts/UiStateContext.tsx` | Expose `checkoutBranchInWorktree` | 2 |

---

## Decisions Made

| # | Question | Decision |
|---|----------|----------|
| 1 | Selector visible with only 1 worktree? | **Yes** — always visible for discoverability. |
| 2 | Show dirty status on trigger button? | **Yes** — yellow dot for uncommitted changes. |
| 3 | Worktree deleted externally? | Already handled — backend `isStale` detection + selector shows red status + "Remove" action. |
| 4 | User-editable worktree names (aliases)? | **Follow-up feature** — not in initial implementation. See below. |
| 5 | Default worktree location? | **Sibling of repo** by default, with a "Custom path" setting in Settings. |
| 6 | What about existing `/tmp` worktrees? | Existing worktrees stay where they are. Only *new* worktrees use the new default. Users can re-create them if desired. |

---

## Follow-Up Features (Post-MVP)

### Worktree Aliases

Allow users to assign custom names to worktrees (e.g., "Review" instead of "myrepo-review"). Requires:

- Config store: `worktreeAliases: Record<string, string>` — maps worktree path → display name
- UI: Editable via context menu "Rename..." on worktree items in the dropdown
- Selector trigger and dropdown show alias instead of folder name
- Alias is purely cosmetic — no filesystem changes

### Worktree Templates

Pre-configure worktree setups (e.g., "always have a review worktree and an experiment worktree"). Lower priority — depends on how users actually use the feature.
