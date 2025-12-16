---
Title: Rebase queue recovery from external "continue" command
Assignee: None
Estimated effort: L
---

Is there a way to have Teapot not break if we commit the conflict resolution from the editor? (i.e. clicking the “Continue” button from vscode, instead of “Continue” in Teapot).

Right now when that happens, Teapot simply loses the context of what rebase was happening, and you have to initiate a brand new one from a bogus state where you have two half-rebased stacks.

I don’t have the whole context of RebaseQueue state management in my brain, but I would assume it’s possible to recover from that based on the RebaseQueue state? Essentially we’d have a RebaseQueue that has not been completed, and that could mean the state (and rebase operation) is picked back up?
