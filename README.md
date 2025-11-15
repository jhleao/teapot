# Teapot

## How to get determine which branch is the "main/trunk" branch?

The concept of "main/trunk" is not native to git. Instead, it's a conventionally named metadata symbolic reference created by git hosting tools such as github.

This means if the repository has never been pushed/pulled, there is not good way to determine which branch is the "main/trunk".

But if _is_ a remote-tracked repo, then you can obtain the reference like so:

```
git symbolic-ref refs/remotes/origin/HEAD
```
