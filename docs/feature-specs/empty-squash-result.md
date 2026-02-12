# Empty Squash Result Detection and Handling

## Overview

When a user squashes a child branch into its parent, it is possible for the combined changes to produce no net difference from the grandparent. This happens when the child branch's changes exactly undo the parent branch's changes. Rather than failing with a cryptic "empty commit" error, the system should detect this scenario upfront, present a clear explanation to the user, and offer to cleanly remove both branches.

## Terminology

- **Target branch**: The branch the user selected to squash (the child).
- **Parent branch**: The branch the target will be squashed into.
- **Grandparent**: The branch (or commit) that the parent branch is based on.
- **Descendants**: Any branches stacked on top of the target branch.

## Detection

### When does a squash result become empty?

A squash combines the target's changes into the parent by amending the parent's HEAD commit. The result is empty when the target's tree is identical to the grandparent's tree. In other words, the diff from the grandparent commit to the target's HEAD is empty.

This is distinct from an "empty branch" (a branch with no diff from its parent). An empty branch has no changes of its own. An empty *result* means the branch has changes, but those changes precisely reverse the parent's changes.

### Detection rules

1. If the branch is already empty (no diff from parent), treat it as the existing "empty branch" flow. Do not check for empty result.
2. If the branch is not empty, compute the diff from the grandparent commit to the target's HEAD.
3. If that diff is empty, mark the result as "would be empty."
4. If the parent has no grandparent (i.e., the parent is a root commit), empty result detection is skipped.

### When to detect

Detection must happen during the **preview** phase (before the user confirms) so the UI can adapt. It must also be verified again at **execution** time to guard against concurrent changes.

## User Interface

### Confirmation dialog

When the result would be empty, the confirmation dialog changes its presentation entirely:

**Title**: "Remove {target} and {parent}" instead of "Squash {target} into {parent}."

**Warning banner**: A prominent warning (amber/yellow styling) with:
- Heading: "Changes cancel out"
- Body: "The changes in {target} undo the changes in {parent}. Both branches will be removed."

**Commit message**: The commit message textarea is hidden. There is no commit to write a message for.

**Branch choice**: The branch name choice UI (keep parent / keep child / keep both / rename) is hidden. Both branches will always be deleted.

**Descendants notice**: If the target branch has descendant branches, an info box displays:
- Heading: "Will rebase"
- Body: A comma-separated list of descendant branch names that will be rebased onto the grandparent.

**Confirm button**: Labeled "Remove Branches" instead of "Squash." While the operation is in progress, the label changes to "Removing..." instead of "Squashing..."

**Cancel button**: Behaves identically to the normal squash dialog. Closing or cancelling the dialog leaves all branches untouched.

### Error reporting

If the operation fails and the error type is "empty result" (a safety-net catch for cases where detection missed it), the error message displayed to the user should be: "Cannot squash: combined changes produce an empty commit."

## Execution

### Without descendants

When there are no branches stacked on top of the target:

1. Ensure the repository's working directory is not currently on either the target or the parent branch. If it is, switch to the grandparent branch. If the grandparent branch is unavailable (e.g., checked out in another worktree), detach HEAD at the grandparent commit.
2. Delete the target branch (local and remote).
3. Delete the parent branch (local and remote).
4. Close any open pull requests associated with either branch.
5. Restore the user's original checkout state (see "HEAD management" below).

### With descendants

When branches are stacked on top of the target:

1. Acquire an isolated execution context (e.g., a temporary worktree) for rebase operations.
2. Rebase all descendant branches onto the grandparent commit, in stack order (direct child first, then its child, etc.).
3. If any descendant rebase encounters a conflict, roll back all branch positions to their original state and report the conflict. No branches are deleted.
4. If rebase succeeds, release the execution context.
5. Ensure the repository's working directory is not on a branch about to be deleted (same logic as "without descendants").
6. Delete the target branch and the parent branch (local and remote).
7. Close any open pull requests associated with either branch.
8. Restore the user's original checkout state.

### Safety-net catch

Even with upfront detection, the actual commit operation (in the normal squash path) should catch "empty commit" errors gracefully. If the commit fails because the result is empty, return a structured error rather than an unhandled exception. This guards against race conditions where the branch state changed between preview and execution.

## HEAD Management

Deleting branches that may be currently checked out requires careful handling of the repository's HEAD state, especially in multi-worktree environments.

### Before deletion: ensure not on deleted branch

Before deleting the target and parent branches, check the current branch of the active working directory:

1. If HEAD is detached or on an unrelated branch, no action needed.
2. If HEAD is on the target or parent branch, attempt to check out the grandparent branch by name.
3. If the grandparent branch is unavailable (e.g., it is checked out in another worktree in a multi-worktree setup), fall back to detaching HEAD at the grandparent commit SHA.

### After deletion: restore original state

After branch deletion, restore the user to where they were before the operation:

1. If the user was originally on one of the deleted branches, leave them on whatever the "ensure not on deleted branch" step chose (the grandparent branch or detached at its SHA). Do not attempt to restore the original branch.
2. If the user was originally on a different branch, check it out. If checkout fails (e.g., the branch is in another worktree), fall back to detaching HEAD at the original commit SHA.
3. If the user was originally in a detached HEAD state, restore the original commit SHA.

### Multi-worktree considerations

In a multi-worktree setup, a branch can only be checked out in one worktree at a time. The grandparent branch may be checked out in a different worktree. The system must handle this gracefully by falling back to detached HEAD rather than failing the entire operation.

When parallel worktrees are disabled and the execution context shares the same working directory as the user's repository, internal rebase operations may leave HEAD on the parent branch. The system must account for this by always checking the current HEAD state before deletion, not relying on a stale "original branch" value captured before the operation began.

## Rollback

If the operation fails at any point after modifying branch positions (during descendant rebase), all branches must be rolled back to their original positions. This includes:

- Resetting each branch to its original commit SHA.
- Restoring the user's HEAD to its original state.
- No branches should be deleted if the operation did not complete successfully.

## Edge Cases

### Target is at the bottom of a deep stack

Example: `main -> parent -> target -> child1 -> child2 -> child3`

All three descendants must be rebased onto main in order. If any rebase conflicts, all are rolled back.

### User is on the target branch during operation

The user may initiate the squash while having the target branch checked out. The system must move HEAD before deleting the branch, then leave the user on the grandparent.

### User is on the parent branch during operation

Same as above. The parent is also being deleted, so the system must move HEAD to the grandparent.

### User is on an unrelated branch

The system should restore the user to their original branch after the operation completes. If the original branch happens to be checked out in another worktree (preventing checkout), fall back to detached HEAD at the original SHA.

### User is in detached HEAD state

The system should restore the exact commit SHA the user was detached at.

### Grandparent branch is checked out in another worktree

The system cannot check out the grandparent branch by name. It must fall back to detaching HEAD at the grandparent commit SHA. The operation should still succeed.

### Parent branch is a root commit (no grandparent)

If the parent branch's commit has no parent (it is a root commit), empty result detection is skipped because there is no grandparent to compare against. The normal squash flow proceeds and may fail with an empty commit error, which is caught by the safety net.

### Descendant rebase conflicts

If a descendant branch conflicts during rebase onto the grandparent, the operation fails gracefully. All branches are rolled back to their original state, and the conflict is reported to the user. No branches are deleted.

### Concurrent modification

If a branch is modified by another process between preview and execution, the execution phase re-validates. Branch position verification ensures that if a branch has moved, the operation aborts rather than producing incorrect results.

### Pull requests on both branches

Both the target and parent branches may have open pull requests. All open PRs on both branches must be closed as part of the cleanup.

### Empty branch vs. empty result

These are two distinct scenarios that must not be conflated:

- **Empty branch**: The target has no diff from its parent (e.g., only empty commits). Handled by the existing "empty branch" deletion flow.
- **Empty result**: The target has real changes, but they cancel out the parent's changes. Handled by the flow described in this spec.

If a branch is empty, it should never be flagged as "result would be empty." The empty branch check takes precedence.

## Test Cases

### Unit tests

#### Detection (preview)

1. **Detects empty result when child reverts parent changes** — Parent modifies a file, target reverts it to the grandparent's version. Preview should report `resultWouldBeEmpty = true` and `isEmpty = false`.

2. **Does not flag empty result for a normal squash** — Parent and target make different, non-cancelling changes. Preview should report `resultWouldBeEmpty = false`.

3. **Empty branch takes precedence over empty result** — Target is an empty branch (no diff from parent, e.g. only empty commits). Preview should report `isEmpty = true` and `resultWouldBeEmpty = false`. The empty branch flow should be used, not the empty result flow.

4. **Does not flag empty result when parent is a root commit** — Parent has no grandparent (it is the first commit in the repo). Preview should not attempt empty result detection and should not crash.

5. **Includes descendant branches in preview when result would be empty** — Target has descendants. Preview should report `resultWouldBeEmpty = true` and list the descendant branches.

#### Execution — without descendants

6. **Deletes both branches when result would be empty** — Stack: grandparent -> parent -> target (reverts parent). Both parent and target should be deleted. Grandparent should remain.

7. **Moves HEAD to grandparent when user is on the target branch** — User is checked out on target. After execution, user should be on the grandparent branch, not in detached HEAD.

8. **Moves HEAD to grandparent when user is on the parent branch** — User is checked out on parent. After execution, user should be on the grandparent branch.

9. **Restores original branch when user is on an unrelated branch** — User is on a branch not involved in the squash. After execution, user should still be on that branch.

10. **Restores detached HEAD when user was detached before operation** — User is in detached HEAD state at some commit. After execution, user should be detached at the same commit.

11. **Falls back to detached HEAD when grandparent branch is unavailable** — Grandparent branch cannot be checked out (e.g. it is in another worktree). User is on the parent branch. After execution, user should be detached at the grandparent commit SHA rather than failing.

#### Execution — with descendants

12. **Rebases single descendant onto grandparent** — Stack: grandparent -> parent -> target (reverts parent) -> child. After execution, parent and target are deleted, child is rebased onto grandparent and retains its content.

13. **Rebases multiple descendants in stack order** — Stack: grandparent -> parent -> target -> child1 -> child2. After execution, parent and target are deleted, child1 and child2 are rebased onto grandparent, both retain their content, and child2's parent commit is child1.

14. **Rolls back all branches on descendant rebase conflict** — A descendant has changes that conflict with the grandparent. Execution should fail, report the conflict, and leave all branches (parent, target, descendants) at their original positions. No branches should be deleted.

15. **Reports modified branches after successful rebase** — After rebasing descendants, the result should list which branches had their SHAs changed.

#### PR cleanup

16. **Closes PR on target branch when it has an open PR** — Target has an open pull request. After execution, the PR should be closed.

17. **Closes PR on parent branch when it has an open PR** — Parent has an open pull request. After execution, the PR should be closed.

18. **Closes PRs on both branches when both have open PRs** — Both target and parent have open pull requests. After execution, both PRs should be closed.

#### Safety-net catch

19. **Returns structured error when commit produces empty result unexpectedly** — The normal squash path (not the empty-result path) encounters an "empty commit" error during the amend. The system should return a structured error with the "empty result" blocker, not throw an unhandled exception.

#### Error reporting

20. **Maps empty result error to user-facing message** — The "empty result" blocker should produce the message: "Cannot squash: combined changes produce an empty commit."

### E2E tests

#### Dialog presentation

21. **Shows "Remove" dialog when result would be empty** — Set up a stack where target reverts parent. Open squash dialog via context menu. Verify the dialog title says "Remove {target} and {parent}", the warning banner says "Changes cancel out", the commit message textarea is not visible, the branch choice UI is not visible, and the confirm button says "Remove Branches".

22. **Shows "Will rebase" notice when descendants exist** — Set up a stack with descendants where target reverts parent. Open squash dialog. Verify the "Will rebase" section is visible and lists the descendant branch names.

23. **Does not show "Squash" button when result would be empty** — Open the empty-result dialog. Verify there is no button labeled "Squash".

#### Dialog actions

24. **Removes both branches when user confirms** — Open the empty-result dialog and click "Remove Branches". Verify both target and parent branches disappear from the UI.

25. **Rebases descendants and removes both branches on confirm** — Stack with descendants. Confirm the remove dialog. Verify parent and target disappear, descendant branch remains visible in the UI.

26. **Cancelling preserves all branches** — Open the empty-result dialog and click "Cancel". Verify all branches (target, parent, and any descendants) remain visible in the UI.

27. **Closing dialog via overlay/escape preserves all branches** — Open the empty-result dialog and dismiss it without using the Cancel button (e.g. press Escape or click the overlay). Verify all branches remain.
