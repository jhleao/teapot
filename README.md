# Teapot

A Git GUI built with Electron that implements a **stacked diff workflow**. Visualizes repositories as a linear stack of commits on trunk, with feature branches displayed as spinoffs.

## Getting Started

```bash
pnpm install
pnpm dev          # Start development server
pnpm test         # Run tests
pnpm typecheck    # Type check both node and web
pnpm build        # Build for production
```

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Electron (Node.js)
- **Git Operations**: `simple-git` library via adapter pattern
- **IPC**: Type-safe communication between main and renderer processes

## Project Structure

```text
src/
├── node/                 # Electron main process (backend)
│   ├── core/             # Business logic
│   │   ├── git-adapter/  # Git operations abstraction (simple-git wrapper)
│   │   ├── forge/        # GitHub integration (PR creation, etc.)
│   │   └── utils/        # Repo building, rebase, commit utilities
│   ├── handlers/         # IPC request handlers
│   └── utils/            # Node-specific utilities
├── shared/               # Shared between main and renderer
│   └── types/            # Domain types, UI types, IPC contracts
├── web/                  # Electron renderer process (frontend)
│   ├── components/       # React components
│   ├── contexts/         # React contexts (UiStateContext, etc.)
│   ├── hooks/            # Custom React hooks
│   └── utils/            # Web-specific utilities
└── web-preload/          # Electron preload scripts
```

## Key Architecture Concepts

### Stacked Diff Workflow

Changes are organized as a stack of commits on trunk. Each new commit creates its own branch, enabling independent PR submission and review.

### Trunk-Centric Visualization

- Main branch (trunk) displayed as the primary vertical timeline
- Feature branches appear as "spinoffs" from specific trunk commits
- Remote trunk (`origin/main`) shown as a badge annotation, not a separate stack

### Two-Phase Data Model

1. **Domain Model** (`src/shared/types/domain.ts`): Raw git data
   - `Repo`, `Commit`, `Branch`, `WorkingTreeStatus`

2. **UI Model** (`src/shared/types/ui.ts`): Transformed for rendering
   - `UiState`, `UiStack`, `UiCommit`, `UiBranch`

Data flow: Git → `build-repo.ts` → Domain Model → `build-ui-state.ts` → UI Model

### React Context Architecture

The renderer uses nested context providers (`src/web/main.tsx`):

```text
ErrorBoundary              ← Crash recovery UI
  └─ LocalStateProvider    ← Repo list, selection (persisted)
       └─ UiStateProvider  ← Git state, theme, all git operations
            └─ DragProvider ← Drag-and-drop for rebase
                 └─ App
```

| Context | Purpose | Key State |
|---------|---------|-----------|
| `LocalStateContext` | Multi-repo management | `repos`, `selectedRepo` |
| `UiStateContext` | Git operations + UI | `uiState`, `isDark`, git action callbacks |
| `DragContext` | Rebase drag-and-drop | Drag state, drop targets |

**Note**: `ErrorBoundary` is outside providers, so provider failures show a generic error page.

### IPC Communication

Type-safe IPC using contract pattern in `src/shared/types/ipc.ts`:

```typescript
interface IpcContract {
  [IPC_CHANNELS.getRepo]: {
    request: { repoPath: string; declutterTrunk?: boolean }
    response: UiState | null
  }
  // ... other channels
}
```

Handlers in `src/node/handlers/repo.ts` implement each channel.

## Key Files

| File | Purpose |
|------|---------|
| `src/node/core/utils/build-repo.ts` | Load git data into domain model |
| `src/node/core/utils/build-ui-state.ts` | Transform domain model to UI model |
| `src/node/core/git-adapter/simple-git-adapter.ts` | Git operations wrapper |
| `src/node/core/rebase-executor.ts` | Rebase operation orchestration |
| `src/node/handlers/repo.ts` | IPC request handlers |
| `src/shared/types/ipc.ts` | IPC contract definitions |
| `src/node/core/utils/uncommit.ts` | Soft reset + branch cleanup |
| `src/node/core/utils/cleanup-branch.ts` | Delete merged branches (local + remote) |
| `src/node/core/utils/amend.ts` | Amend with auto-rebase of children |

## Feature Flags

Passed from renderer → main → repo building:

| Flag | Default | Description |
|------|---------|-------------|
| `declutterTrunk` | `true` | Hide trunk commits without branches/spinoffs |
| `loadRemotes` | `false` | Load all remote branches (remote trunk always loaded) |

## Core Features

### Commit Loading Strategy

| Branch Type | Depth Limit | Rationale |
|-------------|-------------|-----------|
| Local trunk | 200 commits | Prevents loading thousands in large repos |
| Remote trunk | Until known | Fills gap between local and remote |
| Feature branches | Unlimited | Typically small, need complete history |

### Rebase Workflow

1. User drags commit to new base → `submitRebaseIntent()`
2. Preview shown with `'prompting'` status
3. User confirms → `confirmRebaseIntent()` → `executeRebasePlan()`
4. On conflict → `'conflicted'` status, user resolves, then `continueRebase()`

Key files: `rebase-executor.ts`, `rebase-session-store.ts`, `build-rebase-intent.ts`

**Sibling Branch Detection**: When rebasing, all dependent branches are automatically included:

- Direct children (fork from parent's head)
- Siblings at same commit (multiple branches pointing to same SHA)
- Lineage siblings (branches whose commits intersect with parent's lineage)

This prevents orphaned commits when rebasing stacked branches.

### GitHub Integration

- PAT stored via `electron-store`
- PR creation through GitHub API (`src/node/core/forge/adapters/github.ts`)
- Specific error parsing for 401/403/404/422 responses
- **Ship It**: Squash-merge PRs via `PUT /repos/{owner}/{repo}/pulls/{number}/merge`
- **Mergeability**: `isMergeable` derived from GitHub's `mergeable === true && mergeable_state === 'clean'`
- **Update PR**: Force-push branch to sync local changes with remote PR

### Uncommit

Reverts the most recent commit while preserving changes in the working tree:

1. Soft reset HEAD to parent commit
2. Find and delete branches pointing to the uncommitted commit
3. Close any open PRs associated with deleted branches
4. Checkout to a branch at parent (prefers trunk-like branches)

Key file: `src/node/core/utils/uncommit.ts`

### Amend

Amends HEAD commit with staged changes, automatically rebasing dependent branches:

1. Identify child branches before amending
2. Perform `git commit --amend`
3. Auto-rebase children onto the new amended commit

This prevents orphaned branches when amending commits that have dependents.

Key file: `src/node/core/utils/amend.ts`

### Cleanup Branch

Deletes merged branches both locally and on remote:

1. Validate branch is not currently checked out
2. Attempt remote branch deletion (best effort - continues if fails)
3. Delete local branch

Used after "Ship It" to clean up merged feature branches.

Key file: `src/node/core/utils/cleanup-branch.ts`

### Merged Branch Detection

Branches are marked as `isMerged` based on:

1. **PR state** (authoritative): If PR exists and state is `'merged'`
2. **Closed PR fallback**: If PR is `'closed'`, check if commits are on trunk (handles squash/rebase merges)
3. **Local detection**: If no PR, check if branch head is ancestor of trunk

Key file: `src/node/core/utils/detect-merged-branches.ts`

## Common Patterns

### Placeholder Commits

Commits beyond depth limits are created as placeholders with empty messages:

```typescript
commit = { sha, message: '', timeMs: 0, parentSha: '', childrenSha: [] }
```

Always check `commit.message` to distinguish placeholders from loaded commits.

### Branch Lineage Collection

Walk backwards from HEAD through parent commits, collecting SHAs until reaching trunk or another branch pointer.

### Git Adapter Pattern

All git operations go through `GitAdapter` interface, implemented by `SimpleGitAdapter`. This enables consistent error handling and potential future backends.

## Known Edge Cases

- **Shallow clones**: Commit history may terminate early
- **Diverged histories**: Local and remote lineages merged by timestamp
- **Multiple remotes**: Only `origin` remote trunk is tracked
- **Empty commits during rebase**: Git auto-skips them, branches may point to same commit
- **Local vs Remote trunk**: `getTrunkHeadSha()` compares timestamps to pick the more recent one (handles both "Ship It" scenarios where remote advances and offline work where local is ahead)

## Known Issues

See `ISSUE-*.md` files for detailed analysis and proposed fixes:

- **Context error on crash** (`ISSUE-context-error-on-crash.md`): When `UiStateProvider` fails, the app shows "useUiStateContext must be used within a UiStateProvider" instead of a friendly error. Root cause: `Toaster` depends on `UiStateContext` for theme, but `ErrorBoundary` is outside the provider.

- **Trunk visualization when remote ahead** (`ISSUE-origin-main-ahead-visualization.md`): After rebasing on `origin/main` (before pulling), local `main` appears orphaned below the stack. The `buildTrunkUiStack` logic uses only remote lineage when remote is ahead, which is correct for post-Ship-It but confusing for pre-pull workflows.
