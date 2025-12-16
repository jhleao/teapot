---
Title: Detect no-op rebase intents
Assignee: None
Estimated effort: S
---

Right now Teapot accepts rebase intents even if the head and base are the same. To reproduce, try having two independent stacks from main and simply reorder the top one to be below. This is a no-op rebase intent but Teapot still shows as an acceptable rebase.
