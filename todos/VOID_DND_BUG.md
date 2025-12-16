---
Title: Void drag and drop bug
Assignee: None
Estimated effort: S
---

When dragging to a location that is either not close to any branch and letting go of the mouse button, Teapot drops the branch in the void and gets into an unrecoverable state where some part of the UI assumes a rebase intent has been submitted, but nothing shows. The only way to recover from this is restarting the app with Cmd+R.

What we should do, instead, is detect when a branch has been dropped in the void, and just cancel the operation and revert to the original state.
