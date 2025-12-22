---
Title: Rebase intent calculation is slow
Assignee: None
Estimated effort: L
---

It's unclear exactly where is the bottleneck, but calculating rebase intents is slow right now, to the point of >2s in larger repositories. The larger the repo, the slower it gets.

This might be a mix of the network state refresh with Git Forge, and just generally inefficient approaches to constructing the repo model + ui state model.

We have to profile the code, find the bottlenecks, and fix them.
