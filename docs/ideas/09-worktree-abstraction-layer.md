# Idea: Worktree Abstraction Layer

**Source:** `docs/post-mortems/2026-01-parallel-rebase-temp-worktree-conflicts.md`
**Status:** Proposed (from post-mortem lessons)
**Priority:** High

## Problem Context

The parallel rebase feature had 7 interconnected bugs, with a core issue being that git linked worktrees have different structure than main worktrees.

In main worktree: `.git` is a directory containing git state
In linked worktree: `.git` is a file containing `gitdir: /path/to/actual/git/dir`

Code that accessed `.git/` directly (e.g., for rebase state detection) failed for linked worktrees.

## Proposed Solution

Create a unified abstraction that handles linked vs main worktrees transparently:

```typescript
// src/node/domain/Worktree.ts

export class Worktree {
  readonly path: string
  readonly gitDir: string
  readonly isLinked: boolean

  private constructor(path: string, gitDir: string, isLinked: boolean) {
    this.path = path
    this.gitDir = gitDir
    this.isLinked = isLinked
  }

  static async fromPath(worktreePath: string): Promise<Worktree> {
    const gitPath = path.join(worktreePath, '.git')
    const stat = await fs.promises.stat(gitPath)

    if (stat.isDirectory()) {
      return new Worktree(worktreePath, gitPath, false)
    }

    // Linked worktree - resolve gitdir pointer
    const content = await fs.promises.readFile(gitPath, 'utf-8')
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (!match) throw new Error(`Invalid .git file: ${gitPath}`)

    const gitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(worktreePath, match[1])

    return new Worktree(worktreePath, gitDir, true)
  }

  /** Path to rebase-merge directory */
  get rebaseMergePath(): string {
    return path.join(this.gitDir, 'rebase-merge')
  }

  /** Path to rebase-apply directory */
  get rebaseApplyPath(): string {
    return path.join(this.gitDir, 'rebase-apply')
  }

  /** Check if rebase is in progress */
  async isRebasing(): Promise<boolean> {
    const [mergeExists, applyExists] = await Promise.all([
      fs.promises.access(this.rebaseMergePath).then(
        () => true,
        () => false
      ),
      fs.promises.access(this.rebaseApplyPath).then(
        () => true,
        () => false
      )
    ])
    return mergeExists || applyExists
  }

  /** Get lock file path */
  lockFilePath(lockName: string): string {
    return path.join(this.gitDir, lockName)
  }
}
```

## Usage Pattern

```typescript
// Before (buggy)
const gitDir = path.join(dir, '.git')
const rebaseMerge = path.join(gitDir, 'rebase-merge')
const isRebasing = await fs.promises.access(rebaseMerge).then(
  () => true,
  () => false
)

// After (correct for both linked and main worktrees)
const worktree = await Worktree.fromPath(dir)
const isRebasing = await worktree.isRebasing()
```

## Benefits

1. **Correct git directory resolution** for all worktree types
2. **Single source of truth** for path calculations
3. **Encapsulated complexity** - callers don't need to know structure
4. **Testable** - can mock Worktree instance

## Files to Update

- `SimpleGitAdapter.ts` - `detectRebase()`, `checkForLockFile()`, `getRebaseState()`
- `ExecutionContextService.ts` - lock file operations
- Any other code accessing `.git/` directly

---

## Architecture Design Decision

### ADR-001: Domain Class with Factory Method

**Decision:** Create `Worktree` as immutable domain class with `fromPath()` async factory.

**Rationale:**

- Encapsulates git directory resolution logic
- Immutable after construction (path, gitDir, isLinked don't change)
- Factory method handles async file system operations
- Follows existing domain class patterns in codebase

**Alternatives Considered:**

1. **Utility functions**: Rejected - no encapsulation, repeated logic
2. **GitAdapter methods**: Rejected - couples path resolution to git operations
3. **Synchronous construction with lazy resolution**: Rejected - complicates usage

### ADR-002: Centralized Path Accessors

**Decision:** Provide getters for common git-internal paths (rebaseMergePath, rebaseApplyPath, lockFilePath).

**Rationale:**

- All callers get consistent, correct paths
- New paths can be added without changing callers
- Self-documenting API

### ADR-003: Cache Worktree Instances

**Decision:** Cache `Worktree` instances by path to avoid repeated file system access.

**Rationale:**

- Worktree structure doesn't change during runtime
- Saves repeated file reads for gitdir resolution
- Cache can be cleared if worktree is deleted

---

## First Implementation Steps

### Step 1: Create Worktree Domain Class (1 hour)

```typescript
// src/node/domain/Worktree.ts
import * as path from 'path'
import * as fs from 'fs'

const worktreeCache = new Map<string, Worktree>()

export class Worktree {
  private constructor(
    readonly path: string,
    readonly gitDir: string,
    readonly isLinked: boolean
  ) {}

  static async fromPath(worktreePath: string): Promise<Worktree> {
    // Check cache first
    const cached = worktreeCache.get(worktreePath)
    if (cached) return cached

    const gitPath = path.join(worktreePath, '.git')

    try {
      const stat = await fs.promises.stat(gitPath)

      if (stat.isDirectory()) {
        // Main worktree - .git is directory
        const wt = new Worktree(worktreePath, gitPath, false)
        worktreeCache.set(worktreePath, wt)
        return wt
      }
    } catch {
      throw new Error(`Not a git worktree: ${worktreePath}`)
    }

    // Linked worktree - .git is file with gitdir pointer
    const content = await fs.promises.readFile(gitPath, 'utf-8')
    const match = content.match(/^gitdir:\s*(.+)$/m)

    if (!match) {
      throw new Error(`Invalid .git file format: ${gitPath}`)
    }

    const resolvedGitDir = path.isAbsolute(match[1])
      ? match[1]
      : path.resolve(worktreePath, match[1])

    const wt = new Worktree(worktreePath, resolvedGitDir, true)
    worktreeCache.set(worktreePath, wt)
    return wt
  }

  static clearCache(worktreePath?: string): void {
    if (worktreePath) {
      worktreeCache.delete(worktreePath)
    } else {
      worktreeCache.clear()
    }
  }

  // Common git-internal paths
  get rebaseMergePath(): string {
    return path.join(this.gitDir, 'rebase-merge')
  }

  get rebaseApplyPath(): string {
    return path.join(this.gitDir, 'rebase-apply')
  }

  get headPath(): string {
    return path.join(this.gitDir, 'HEAD')
  }

  lockFilePath(name: string): string {
    return path.join(this.gitDir, name)
  }

  // Common operations
  async isRebasing(): Promise<boolean> {
    const [mergeExists, applyExists] = await Promise.all([
      fs.promises.access(this.rebaseMergePath).then(
        () => true,
        () => false
      ),
      fs.promises.access(this.rebaseApplyPath).then(
        () => true,
        () => false
      )
    ])
    return mergeExists || applyExists
  }

  async hasLock(lockName: string): Promise<boolean> {
    try {
      await fs.promises.access(this.lockFilePath(lockName))
      return true
    } catch {
      return false
    }
  }
}
```

### Step 2: Update SimpleGitAdapter (2 hours)

```typescript
// src/node/git/SimpleGitAdapter.ts

// Before (buggy for linked worktrees):
async detectRebase(repoPath: string): Promise<boolean> {
  const gitDir = path.join(repoPath, '.git')
  const rebaseMerge = path.join(gitDir, 'rebase-merge')
  return fs.existsSync(rebaseMerge)
}

// After (correct for all worktrees):
async detectRebase(repoPath: string): Promise<boolean> {
  const worktree = await Worktree.fromPath(repoPath)
  return worktree.isRebasing()
}
```

### Step 3: Update ExecutionContextService (1 hour)

```typescript
// src/node/services/ExecutionContextService.ts

// Before:
const lockPath = path.join(repoPath, '.git', 'teapot-exec.lock')

// After:
const worktree = await Worktree.fromPath(repoPath)
const lockPath = worktree.lockFilePath('teapot-exec.lock')
```

### Step 4: Add Tests (1 hour)

```typescript
// src/node/domain/__tests__/Worktree.test.ts
describe('Worktree', () => {
  it('resolves main worktree correctly', async () => {
    const wt = await Worktree.fromPath('/repo')
    expect(wt.gitDir).toBe('/repo/.git')
    expect(wt.isLinked).toBe(false)
  })

  it('resolves linked worktree correctly', async () => {
    // Mock .git file with gitdir pointer
    const wt = await Worktree.fromPath('/repo/.worktrees/feature')
    expect(wt.gitDir).toMatch(/\.git\/worktrees\/feature/)
    expect(wt.isLinked).toBe(true)
  })

  it('provides correct rebase paths', async () => {
    const wt = await Worktree.fromPath('/repo')
    expect(wt.rebaseMergePath).toBe('/repo/.git/rebase-merge')
  })
})
```

---

## Risks and Mitigations

| Risk                                  | Mitigation                                 |
| ------------------------------------- | ------------------------------------------ |
| Cache invalidation on worktree delete | Call `Worktree.clearCache(path)` on delete |
| Symlink edge cases                    | Use `fs.promises.realpath()` if needed     |
| Performance of async factory          | Cache mitigates repeated lookups           |
