# UX Analysis: "Clean Up" and "Delete Branch" Button Side Effects

## Executive Summary

Both the "Clean Up" and "Delete Branch" buttons perform multiple cascading operations silently, violating the UX principle of **least surprise**. A user clicking "Delete Branch" expects a local branch deletion — not a GitHub PR being closed and a remote branch being wiped. Similarly, "Clean Up" suggests tidying metadata, not reaching out to GitHub to delete remote branches.

---

## 1. Current Behavior Audit

### "Clean Up" Button

**Surfaces in:** `GitForgeSection.tsx` (3 locations: `TrunkCleanupSection` line 327, `ClosedPrSection` line 371, `MergedBranchSection` line 543)

**Backend:** `BranchOperation.cleanup()` at `src/node/operations/BranchOperation.ts:118-155`

| # | Operation | Scope | Visible to user? |
|---|-----------|-------|-------------------|
| 1 | Remove worktree (deletes directory on disk) | Local filesystem | No warning |
| 2 | Delete remote branch via GitHub API | Remote / GitHub | **No — silent** |
| 3 | Delete remote-tracking ref (`origin/branch`) | Local git state | No |
| 4 | Force-delete local branch (`git branch -D`) | Local git state | No |
| 5 | Update active worktree config if needed | Local config | No |

**Critical issue:** Operation #2 is a destructive remote action. The button label "Clean up" suggests local housekeeping, not deleting a branch on GitHub. Users who share branches or keep remote refs for audit/reference will lose data without any confirmation.

### "Delete Branch" Button

**Surface:** `BranchBadge.tsx` context menu item (line 188)

**Backend:** `BranchOperation.delete()` at `src/node/operations/BranchOperation.ts:173-220`

| # | Operation | Scope | Visible to user? |
|---|-----------|-------|-------------------|
| 1 | Permission check (trunk / current branch) | Validation | Yes (disabled state) |
| 2 | Remove worktree (deletes directory on disk) | Local filesystem | No warning |
| 3 | **Close associated open PR on GitHub** | Remote / GitHub | **No — silent** |
| 4 | Delete remote branch via GitHub API | Remote / GitHub | **No — silent** |
| 5 | Delete remote-tracking ref (`origin/branch`) | Local git state | No |
| 6 | Force-delete local branch (`git branch -D`) | Local git state | No |

**Critical issues:**
- Operation #3 closes a PR on GitHub. This is a **major unexpected side effect**. "Delete branch" does not imply "close my pull request." A PR might have ongoing review discussions, CI results, or audit significance. Closing it silently is destructive.
- Operation #4 deletes the remote branch. Users expect "delete branch" to mean the local ref, not a coordinated multi-system teardown.

---

## 2. UX Engineering Critique

### Violated Principles

1. **Principle of Least Surprise**: Both buttons do far more than their labels promise. "Delete Branch" should delete a branch. "Clean Up" should clean up local state. Neither label communicates remote GitHub operations.

2. **Single Responsibility (for UI actions)**: Each button bundles 4–6 distinct operations into one click. If any intermediate step fails, the state becomes partially applied and hard to reason about.

3. **Reversibility / Undo**: Closing a PR and deleting a remote branch are **irreversible** in practice (PR comments, review threads, and CI data are lost or orphaned). There is no confirmation dialog, no undo, and no way to recover.

4. **Transparency**: Side effects involving external systems (GitHub API) should be explicitly disclosed to the user before execution, not logged to a console the user will never see.

5. **Scope Escalation Without Consent**: The user initiated a local operation (button in a desktop app). The app escalated to a remote system (GitHub) without asking.

### Severity Rating

| Side Effect | Severity | Reason |
|---|---|---|
| Closing a PR silently | **Critical** | Irreversible; affects collaborators; unexpected from "Delete Branch" |
| Deleting remote branch silently | **High** | Affects shared state; unexpected from a local UI action |
| Removing worktree without warning | **Medium** | Destructive locally but recoverable; should have confirmation if dirty |
| Deleting local branch | **Expected** | This is what the button says it does |
| Deleting remote-tracking ref | **Low** | Automatically restored on next `git fetch`; cosmetic |

---

## 3. Remediation Plan

### 3.1 — Separate "Delete Branch" Into Atomic Operations

**Goal**: The "Delete Branch" action should **only** delete the local branch. Remote operations become separate, explicit user choices.

**Changes to `BranchOperation.delete()` (`src/node/operations/BranchOperation.ts:173-220`):**

- **Remove** the call to `this.closePullRequestForBranch()` (line 191). Deleting a branch must never close a PR.
- **Remove** the remote branch deletion block (lines 193-202). Deleting a local branch should not reach out to GitHub.
- **Remove** the remote-tracking ref deletion (lines 204-216). This can be left for a separate "prune" or "clean up remotes" action.
- **Keep** the worktree removal (line 189) since the local branch cannot be deleted while a worktree references it — but add a **confirmation dialog** before proceeding when a worktree exists.

**Result**: `BranchOperation.delete()` becomes: validate → (confirm worktree removal if needed) → `git branch -D`.

### 3.2 — Reduce "Clean Up" to Local-Only Scope

**Goal**: "Clean Up" for merged branches should only remove local artifacts, not reach out to GitHub.

**Changes to `BranchOperation.cleanup()` (`src/node/operations/BranchOperation.ts:118-155`):**

- **Remove** the remote branch deletion call via `gitForgeService.deleteRemoteBranch()` (lines 125-133).
- **Keep** worktree removal (line 123) — necessary for local cleanup of merged branches.
- **Keep** remote-tracking ref deletion (lines 140-151) — this is local state only and prevents the merged branch from reappearing in the UI after a fetch if the remote branch is already gone (e.g., GitHub auto-delete after merge).
- **Keep** local branch deletion (line 153) — this is the core purpose.

**Result**: `BranchOperation.cleanup()` becomes: validate → remove worktree → delete local tracking ref → delete local branch. Purely local.

### 3.3 — Introduce Explicit "Delete Remote Branch" Action

**Goal**: Give users an explicit, separate control for deleting the remote branch on GitHub.

**Implementation:**

- Add a new `BranchOperation.deleteRemote()` method that **only** calls `gitForgeService.deleteRemoteBranch()` and cleans up the tracking ref.
- Expose this as a separate context menu item: **"Delete remote branch"** in `BranchBadge.tsx`.
- This item should include a confirmation dialog: _"This will delete the branch 'feature-x' on GitHub. This cannot be undone. Continue?"_
- Visually distinguish it (e.g., red text or a warning icon) to signal destructiveness.

### 3.4 — Introduce Explicit "Close PR" Action (or Remove Automatic Closure Entirely)

**Goal**: Never close a PR as a side effect of another operation.

**Options (pick one):**

**Option A — Remove automatic PR closure entirely (recommended):**
- Delete the `closePullRequestForBranch()` private method entirely.
- If users want to close a PR, they do so from the PR link already shown in the UI, or via a dedicated "Close PR" button.
- This is the safest approach and respects the fact that PRs have independent lifecycle from branches.

**Option B — Add a separate "Close PR" button:**
- Surface a "Close PR" button in `GitForgeSection.tsx` next to the PR link, only for open PRs.
- Requires confirmation: _"This will close PR #42 on GitHub. Continue?"_
- Never triggered as a side effect of branch operations.

### 3.5 — Add Confirmation Dialogs for Remaining Destructive Actions

Even after scoping down the operations, add confirmation for:

| Action | Confirmation message |
|---|---|
| Delete branch (local) with worktree | "Branch 'X' has a worktree at /path. The worktree will be removed. Continue?" |
| Delete remote branch (new action) | "Delete branch 'X' from GitHub? This cannot be undone." |
| Close PR (if Option B) | "Close PR #N on GitHub? This cannot be undone." |

**Implementation**: Use the existing `electron.dialog.showMessageBox()` pattern already present in the IPC handlers (`src/node/handlers/repo.ts`), but call it **before** executing the operation, not just on error.

### 3.6 — Update Button Labels for Clarity

| Current Label | New Label | Reason |
|---|---|---|
| "Clean up" | "Remove local branch" | Accurately describes the (now reduced) scope |
| "Delete branch" (context menu) | "Delete local branch" | Distinguishes from the new "Delete remote branch" option |

Alternatively, if "Delete local branch" feels verbose, keep "Delete branch" but ensure the context menu **also** shows "Delete remote branch" as a sibling — the contrast makes the scope clear.

---

## 4. Summary of Code Changes

| File | Change |
|---|---|
| `src/node/operations/BranchOperation.ts` | Remove remote branch deletion from `cleanup()`. Remove PR closure and remote branch deletion from `delete()`. Add new `deleteRemote()` method. |
| `src/node/handlers/repo.ts` | Add `deleteRemoteBranch` IPC handler with confirmation dialog. Remove silent side effects from existing handlers. |
| `src/web/components/BranchBadge.tsx` | Add "Delete remote branch" context menu item. Update label of existing delete to clarify scope. |
| `src/web/components/GitForgeSection.tsx` | Optionally add "Close PR" button for open PRs (if Option B). Update "Clean up" label. |
| `src/web/contexts/UiStateContext.tsx` | Add `deleteRemoteBranch` method to context. |
| `src/shared/` (IPC types) | Add IPC channel type for `deleteRemoteBranch`. |

---

## 5. Migration / Backwards Compatibility

- These are purely behavioral changes to existing UI actions — no data migration needed.
- Users who relied on "Delete Branch" to also close PRs will need to close PRs separately. This is the **correct** behavior; the previous behavior was a foot-gun.
- The remote branch deletion feature is not removed, just moved to an explicit action. No functionality is lost.
