---
Title: Worktree Support
Assignee: None
Estimated effort: XL
---

Below are rough notes on how we could add worktree support to Teapot.

Each worktree is basically a new local copy of the repository in a different folder. Which means each copy is individually checked out to a different branch, and has a separate working tree (modified files).

I was thinking a good way to represent this could be showing, besides the branch badge, a “worktree badge” of sorts, indicating that a certain worktree (not the current) is checked out to that branch. Additionally, that button could be e.g. yellow if that worktree has uncommitted changes, because that means we can’t do anything with that branch (or worktree).

The checked out branch of the current worktree could just use the regular blue highlight.

Maybe dragging a worktree badge somewhere else changes the checkout of that worktree. This way you can get a worktree “out of the way” for you to do stuff, as long as it’s clean.

A context menu (right click) on a (not current) worktree badge could have options

1. Discard all changes (clean index)
2. Delete worktree
3. Commit changes (flushes the changes to a new commit/branch)

To switch between worktrees, we could make it so double clicking a worktree badge, Teapot switches to point at the git repository at that location, and essentially that becomes the “current” worktree. This is needed because Teapot would only show the changed files+commit view for the current worktree.

We could also make use of a button to “open this repo in your editor”, because switching a worktree in Teapot does not mean the editor will follow (the editor will stay pointing at the previous path).

Lastly, the annoying part is performing rebases when one or more of the rebase branches are checked out by another (non current) worktree. Git won’t let you touch these branches from other worktrees. This means we’d have to perform part of the rebase from the worktree that is checked out to that branch (i.e. switching back and forth between worktrees mid-rebase). Maybe there is an easier solution to this.

We have this whole namespace in Teapot called “WorkingTree” (the changed files list). This will start becoming confusing when we add worktrees, and I don’t even think this is conceptually correct anyway. Let’s consider renaming that.
