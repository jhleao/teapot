# Idea: Typed Git Error Classes

**Source:** `2339-worktree-branch-deletion.md` (post-mortem)
**Status:** Proposed
**Priority:** High (maintainability, developer experience)
**Effort:** Medium (1 week)

## Problem

Git operations can fail in many ways, but error handling is inconsistent:

1. **String parsing scattered**: Callers parse error messages to determine failure type
2. **No type safety**: Can't use `instanceof` to check error types
3. **Inconsistent handling**: Same error handled differently in different places
4. **Poor discoverability**: No central place to see what errors an operation can throw

### Current State

```typescript
// Caller must parse error messages
try {
  await git.deleteBranch(repoPath, branch)
} catch (error) {
  if (error.message.includes('used by worktree')) {
    // Handle worktree conflict
  } else if (error.message.includes('not found')) {
    // Handle branch not found
  } else {
    throw error
  }
}
```

This is fragile:
- Error message format can change
- Easy to miss error cases
- Duplicated parsing logic across callers

## Proposed Solution

Create a hierarchy of typed error classes for common git errors. Errors are thrown by the adapter layer, and callers use `instanceof` checks.

### Error Hierarchy

```typescript
// Base error for all git operations
export class GitError extends Error {
  readonly name = 'GitError'
  readonly operation: string

  constructor(operation: string, message: string, cause?: unknown) {
    super(message)
    this.operation = operation
    this.cause = cause
  }
}

// Branch-specific errors
export class BranchError extends GitError {
  readonly branch: string

  constructor(branch: string, operation: string, message: string, cause?: unknown) {
    super(operation, message, cause)
    this.branch = branch
  }
}

export class BranchNotFoundError extends BranchError {
  readonly name = 'BranchNotFoundError'

  constructor(branch: string, cause?: unknown) {
    super(branch, 'deleteBranch', `Branch '${branch}' not found`, cause)
  }
}

export class BranchAlreadyExistsError extends BranchError {
  readonly name = 'BranchAlreadyExistsError'

  constructor(branch: string, cause?: unknown) {
    super(branch, 'createBranch', `Branch '${branch}' already exists`, cause)
  }
}

// Worktree-specific errors
export class WorktreeError extends GitError {
  readonly worktreePath: string

  constructor(
    worktreePath: string,
    operation: string,
    message: string,
    cause?: unknown
  ) {
    super(operation, message, cause)
    this.worktreePath = worktreePath
  }
}

export class WorktreeConflictError extends WorktreeError {
  readonly name = 'WorktreeConflictError'
  readonly branch: string

  constructor(branch: string, worktreePath: string, cause?: unknown) {
    super(
      worktreePath,
      'branchOperation',
      `Branch '${branch}' is used by worktree at '${worktreePath}'`,
      cause
    )
    this.branch = branch
  }
}

export class DirtyWorktreeError extends WorktreeError {
  readonly name = 'DirtyWorktreeError'

  constructor(worktreePath: string, cause?: unknown) {
    super(
      worktreePath,
      'worktreeOperation',
      `Worktree at '${worktreePath}' has uncommitted changes`,
      cause
    )
  }
}

// Lock errors
export class IndexLockedError extends GitError {
  readonly name = 'IndexLockedError'
  readonly lockPath: string

  constructor(lockPath: string, cause?: unknown) {
    super('gitOperation', `Index locked: ${lockPath}`, cause)
    this.lockPath = lockPath
  }
}

// Rebase errors
export class RebaseError extends GitError {
  readonly name = 'RebaseError'
}

export class RebaseConflictError extends RebaseError {
  readonly name = 'RebaseConflictError'
  readonly conflictedFiles: string[]

  constructor(conflictedFiles: string[], cause?: unknown) {
    super('rebase', `Rebase conflict in: ${conflictedFiles.join(', ')}`, cause)
    this.conflictedFiles = conflictedFiles
  }
}

export class RebaseInProgressError extends RebaseError {
  readonly name = 'RebaseInProgressError'

  constructor(cause?: unknown) {
    super('rebase', 'A rebase is already in progress', cause)
  }
}
```

### Usage in Adapter Layer

```typescript
// src/node/adapters/git/SimpleGitAdapter.ts

async deleteBranch(dir: string, ref: string): Promise<void> {
  try {
    await this.git(dir).branch(['-D', ref])
  } catch (error) {
    throw this.parseAndThrow('deleteBranch', ref, error)
  }
}

private parseAndThrow(
  operation: string,
  ref: string,
  error: unknown
): never {
  const message = this.extractMessage(error)

  // Check for specific error patterns
  if (message.includes('used by worktree')) {
    const match = message.match(/worktree at '([^']+)'/)
    throw new WorktreeConflictError(ref, match?.[1] ?? 'unknown', error)
  }

  if (message.includes('not found')) {
    throw new BranchNotFoundError(ref, error)
  }

  if (message.includes('already exists')) {
    throw new BranchAlreadyExistsError(ref, error)
  }

  // Generic git error
  throw new GitError(operation, message, error)
}
```

### Usage in Callers

```typescript
// Clean, type-safe error handling
async function handleBranchDeletion(repoPath: string, branch: string) {
  try {
    await git.deleteBranch(repoPath, branch)
  } catch (error) {
    if (error instanceof WorktreeConflictError) {
      // TypeScript knows error.worktreePath and error.branch exist
      await handleWorktreeConflict(error.worktreePath, error.branch)
      return
    }

    if (error instanceof BranchNotFoundError) {
      // Already deleted, that's fine
      return
    }

    throw error
  }
}
```

---

## Architecture Design Decision

### ADR-001: Error Class Hierarchy

**Decision:** Create a hierarchy of error classes rooted at `GitError`.

**Rationale:**
- Enables `instanceof` checks for type-safe error handling
- Provides specific properties for each error type (e.g., `branch`, `worktreePath`)
- Follows established patterns (Node.js errors, DOM errors)
- Self-documenting: error types show what can go wrong

**Alternatives Considered:**
1. **Error codes on generic Error**: Rejected - no type safety, no specific properties
2. **Result types (Either/Option)**: Rejected - doesn't match JavaScript conventions
3. **Error parsing at each call site**: Rejected - duplicated logic, fragile

### ADR-002: Errors Thrown by Adapter Layer

**Decision:** The adapter layer (`SimpleGitAdapter`) parses git errors and throws typed errors. Operation code catches typed errors.

**Rationale:**
- Centralizes error parsing logic
- Operation code is cleaner (no string parsing)
- Single place to update when git output changes
- Adapter layer already wraps git commands

### ADR-003: Include Original Error as Cause

**Decision:** All typed errors include the original error via the `cause` property.

**Rationale:**
- Preserves full stack trace for debugging
- Original error may contain useful details
- Follows ES2022 Error cause convention
- Enables logging original error when needed

### ADR-004: Error Properties Match Domain Concepts

**Decision:** Error classes have properties that match domain concepts (e.g., `branch`, `worktreePath`) rather than raw git output.

**Rationale:**
- Callers work with domain concepts, not git internals
- Easier to use in error messages and UI
- Abstracts git implementation details

---

## First Implementation Steps

### Step 1: Create Error Class Hierarchy (1 hour)

```typescript
// src/node/shared/errors.ts

export class GitError extends Error {
  readonly name = 'GitError'

  constructor(
    readonly operation: string,
    message: string,
    cause?: unknown
  ) {
    super(message)
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class BranchError extends GitError {
  constructor(
    readonly branch: string,
    operation: string,
    message: string,
    cause?: unknown
  ) {
    super(operation, message, cause)
  }
}

export class BranchNotFoundError extends BranchError {
  readonly name = 'BranchNotFoundError'

  constructor(branch: string, cause?: unknown) {
    super(branch, 'branch', `Branch '${branch}' not found`, cause)
  }
}

export class BranchAlreadyExistsError extends BranchError {
  readonly name = 'BranchAlreadyExistsError'

  constructor(branch: string, cause?: unknown) {
    super(branch, 'branch', `Branch '${branch}' already exists`, cause)
  }
}

export class WorktreeError extends GitError {
  constructor(
    readonly worktreePath: string,
    operation: string,
    message: string,
    cause?: unknown
  ) {
    super(operation, message, cause)
  }
}

export class WorktreeConflictError extends WorktreeError {
  readonly name = 'WorktreeConflictError'

  constructor(
    readonly branch: string,
    worktreePath: string,
    cause?: unknown
  ) {
    super(
      worktreePath,
      'branch',
      `Branch '${branch}' is used by worktree at '${worktreePath}'`,
      cause
    )
  }
}

export class DirtyWorktreeError extends WorktreeError {
  readonly name = 'DirtyWorktreeError'

  constructor(worktreePath: string, cause?: unknown) {
    super(
      worktreePath,
      'worktree',
      `Worktree at '${worktreePath}' has uncommitted changes`,
      cause
    )
  }
}

export class IndexLockedError extends GitError {
  readonly name = 'IndexLockedError'

  constructor(
    readonly lockPath: string,
    cause?: unknown
  ) {
    super('index', `Index locked: ${lockPath}`, cause)
  }
}

export class RebaseConflictError extends GitError {
  readonly name = 'RebaseConflictError'

  constructor(
    readonly conflictedFiles: string[],
    cause?: unknown
  ) {
    super(
      'rebase',
      `Rebase conflict in: ${conflictedFiles.join(', ')}`,
      cause
    )
  }
}
```

### Step 2: Create Centralized Error Parser (1 hour)

```typescript
// src/node/adapters/git/GitErrorParser.ts

import {
  GitError,
  BranchNotFoundError,
  BranchAlreadyExistsError,
  WorktreeConflictError,
  IndexLockedError,
  RebaseConflictError,
} from '../../shared/errors'

export class GitErrorParser {
  static parse(operation: string, context: string, error: unknown): GitError {
    const message = this.extractMessage(error)

    // Worktree conflicts
    const worktreeMatch = message.match(
      /(?:used by|already used by) worktree at '([^']+)'/
    )
    if (worktreeMatch) {
      return new WorktreeConflictError(context, worktreeMatch[1], error)
    }

    // Branch not found
    if (message.includes('not found') || message.includes('did not match')) {
      return new BranchNotFoundError(context, error)
    }

    // Branch already exists
    if (message.includes('already exists')) {
      return new BranchAlreadyExistsError(context, error)
    }

    // Index locked
    const lockMatch = message.match(/Unable to create '([^']+\.lock)'/)
    if (lockMatch) {
      return new IndexLockedError(lockMatch[1], error)
    }

    // Rebase conflicts
    if (message.includes('CONFLICT')) {
      const files = this.extractConflictedFiles(message)
      return new RebaseConflictError(files, error)
    }

    // Generic git error
    return new GitError(operation, message, error)
  }

  private static extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return String(error)
  }

  private static extractConflictedFiles(message: string): string[] {
    const files: string[] = []
    const regex = /CONFLICT \([^)]+\): (?:Merge conflict in |)([^\n]+)/g
    let match
    while ((match = regex.exec(message)) !== null) {
      files.push(match[1].trim())
    }
    return files
  }
}
```

### Step 3: Integrate into SimpleGitAdapter (2 hours)

```typescript
// src/node/adapters/git/SimpleGitAdapter.ts

import { GitErrorParser } from './GitErrorParser'

export class SimpleGitAdapter {
  async deleteBranch(dir: string, ref: string): Promise<void> {
    try {
      await this.git(dir).branch(['-D', ref])
    } catch (error) {
      throw GitErrorParser.parse('deleteBranch', ref, error)
    }
  }

  async createBranch(dir: string, ref: string, startPoint?: string): Promise<void> {
    try {
      const args = startPoint ? [ref, startPoint] : [ref]
      await this.git(dir).branch(args)
    } catch (error) {
      throw GitErrorParser.parse('createBranch', ref, error)
    }
  }

  async checkout(dir: string, ref: string): Promise<void> {
    try {
      await this.git(dir).checkout(ref)
    } catch (error) {
      throw GitErrorParser.parse('checkout', ref, error)
    }
  }
}
```

### Step 4: Update Callers to Use Typed Errors (2 hours)

```typescript
// src/node/operations/BranchOperation.ts

import {
  WorktreeConflictError,
  BranchNotFoundError,
  DirtyWorktreeError,
} from '../shared/errors'

export class BranchOperation {
  static async delete(repoPath: string, branch: string): Promise<void> {
    try {
      await git.deleteBranch(repoPath, branch)
    } catch (error) {
      if (error instanceof WorktreeConflictError) {
        await this.handleWorktreeConflict(repoPath, error)
        return
      }

      if (error instanceof BranchNotFoundError) {
        log.info(`Branch ${branch} already deleted`)
        return
      }

      throw error
    }
  }

  private static async handleWorktreeConflict(
    repoPath: string,
    error: WorktreeConflictError
  ): Promise<void> {
    if (await isWorktreeDirty(error.worktreePath)) {
      throw new DirtyWorktreeError(error.worktreePath)
    }

    await WorktreeOperation.remove(repoPath, error.worktreePath, true)
    await git.deleteBranch(repoPath, error.branch)
  }
}
```

### Step 5: Add Comprehensive Tests (2 hours)

```typescript
// src/node/__tests__/shared/errors.test.ts

describe('GitError hierarchy', () => {
  it('WorktreeConflictError is instance of WorktreeError and GitError', () => {
    const error = new WorktreeConflictError('main', '/path/to/worktree')

    expect(error).toBeInstanceOf(WorktreeConflictError)
    expect(error).toBeInstanceOf(WorktreeError)
    expect(error).toBeInstanceOf(GitError)
    expect(error).toBeInstanceOf(Error)
  })

  it('preserves original error as cause', () => {
    const originalError = new Error('git: branch in use')
    const error = new WorktreeConflictError('main', '/path', originalError)

    expect(error.cause).toBe(originalError)
  })

  it('provides typed properties', () => {
    const error = new WorktreeConflictError('feature', '/path/to/wt')

    expect(error.branch).toBe('feature')
    expect(error.worktreePath).toBe('/path/to/wt')
    expect(error.operation).toBe('branch')
  })
})

describe('GitErrorParser', () => {
  it('parses worktree conflict error', () => {
    const gitError = new Error(
      "fatal: cannot delete branch 'main' used by worktree at '/repo/wt'"
    )

    const parsed = GitErrorParser.parse('deleteBranch', 'main', gitError)

    expect(parsed).toBeInstanceOf(WorktreeConflictError)
    expect((parsed as WorktreeConflictError).worktreePath).toBe('/repo/wt')
  })

  it('parses branch not found error', () => {
    const gitError = new Error("error: branch 'foo' not found")

    const parsed = GitErrorParser.parse('deleteBranch', 'foo', gitError)

    expect(parsed).toBeInstanceOf(BranchNotFoundError)
  })
})
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Git error format changes | Centralized parser; tests catch regressions |
| Missing error patterns | Generic `GitError` as fallback; add patterns iteratively |
| Error class proliferation | Only create classes for actionable errors |
| Prototype chain issues | Use `Object.setPrototypeOf` in constructor |
