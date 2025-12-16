---
Title: Support multiple commits per branch
Assignee: None
Estimated effort: XL
---

Right now Teapot assumes (and almost enforces) that every commit must have a branch 1-1. While this makes stacking and rebasing easier to reason about, it's a constraint that is very opinionated, and not everyone would love to adopt (I, for one, frowned upon this at first).

Adding support for multiple commits per branch is actually not super hard. What this means, in practice, is:

When dragging a branch, we should consider that we're dragging along all parent branchless commits until we reach a commit that does have a branch.

We could also have some UI to indicate that Teapot considers these parent commits as "part" of the branch.

This is, in fact, much closer to how most people reason about git and branches.

We could also consider adding an option, when committing, to NOT create a new branch and instead commit to the current branch.
