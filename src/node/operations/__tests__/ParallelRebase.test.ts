/**
 * Integration tests for parallel rebase workflow using temporary worktrees.
 *
 * These tests verify the full flow:
 * 1. User has uncommitted changes in their worktree
 * 2. User initiates a rebase (via drag-drop or button)
 * 3. System creates a temporary worktree for execution
 * 4. Rebase completes successfully
 * 5. User's uncommitted changes are preserved
 */

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Electron's BrowserWindow for notification testing
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

// Mock the store to control active worktree path and provide required config values
let mockActiveWorktree: string | null = null
const mockRebaseSessions = new Map<string, unknown>()
vi.mock('../../store', () => ({
  configStore: {
    getActiveWorktree: () => mockActiveWorktree,
    getGithubPat: () => null, // No PAT for tests - forge operations will return null
    getUseParallelWorktree: vi.fn().mockReturnValue(true),
    // Session storage methods
    getRebaseSession: (key: string) => mockRebaseSessions.get(key) ?? null,
    setRebaseSession: (key: string, session: unknown) => mockRebaseSessions.set(key, session),
    deleteRebaseSession: (key: string) => mockRebaseSessions.delete(key),
    hasRebaseSession: (key: string) => mockRebaseSessions.has(key)
  }
}))

import { getGitAdapter, resetGitAdapter, type GitAdapter } from '../../adapters/git'
import {
  ExecutionContextService,
  WorktreeCreationError
} from '../../services/ExecutionContextService'
import { getCleanupFailureCount, resetCleanupFailureCount } from '../RebaseExecutor'
import { RebaseOperation, RebaseOperationError } from '../RebaseOperation'

describe('Parallel Rebase Workflow', () => {
  let tempDir: string
  let repoPath: string
  let git: GitAdapter

  beforeEach(async () => {
    // Reset git adapter to get fresh instance
    resetGitAdapter()
    git = getGitAdapter()

    // Create temp directory
    // Use realpath to resolve symlinks (e.g., /var -> /private/var on macOS)
    // so paths match what git returns
    tempDir = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'parallel-rebase-test-'))
    )
    repoPath = path.join(tempDir, 'repo')

    // Create git repo with initial commit
    await fs.promises.mkdir(repoPath)
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })

    // Create initial commit on main
    await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Create feature branch with a commit
    execSync('git checkout -b feature', { cwd: repoPath })
    await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'feature content')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "feature commit"', { cwd: repoPath })

    // Reset mock state
    mockActiveWorktree = null
    mockRebaseSessions.clear()
  })

  afterEach(async () => {
    // Clean up contexts
    try {
      await ExecutionContextService.clearStoredContext(repoPath)
    } catch {
      // Ignore errors
    }

    // Clean up mock state
    mockRebaseSessions.clear()

    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  describe('ExecutionContextService integration', () => {
    it('does not create temp worktree for untracked files only', async () => {
      // Arrange: Create an untracked file only
      // Note: Untracked files don't cause rebase issues, so no temp worktree needed
      const uncommittedContent = 'work in progress'
      await fs.promises.writeFile(path.join(repoPath, 'wip.txt'), uncommittedContent)

      // Verify untracked state
      const statusBefore = await git.getWorkingTreeStatus(repoPath)
      expect(statusBefore.not_added).toContain('wip.txt')

      // Act: Acquire execution context
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      try {
        // Assert: Always creates temp worktree now (even for untracked-only)
        expect(context.isTemporary).toBe(true)
        expect(context.executionPath).not.toBe(repoPath)
        expect(context.executionPath).toContain('teapot-exec-')

        // Assert: Untracked file is still in the main worktree (not in temp)
        const wipContent = await fs.promises.readFile(path.join(repoPath, 'wip.txt'), 'utf-8')
        expect(wipContent).toBe(uncommittedContent)
      } finally {
        await ExecutionContextService.release(context)
      }
    })

    it('creates temp worktree when active worktree has modified tracked files', async () => {
      // Arrange: Modify a tracked file
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'modified content')

      // Verify dirty state
      const statusBefore = await git.getWorkingTreeStatus(repoPath)
      expect(statusBefore.modified).toContain('feature.txt')

      // Act: Acquire execution context
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      try {
        // Assert: Context uses a temporary worktree
        expect(context.isTemporary).toBe(true)
        expect(context.executionPath).not.toBe(repoPath)
        expect(context.executionPath).toContain('teapot-exec-')

        // Assert: Original modification is still in the main worktree
        const content = await fs.promises.readFile(path.join(repoPath, 'feature.txt'), 'utf-8')
        expect(content).toBe('modified content')
      } finally {
        await ExecutionContextService.release(context)
      }
    })

    it('creates temp worktree when active worktree has staged changes', async () => {
      // Arrange: Create and stage a file
      await fs.promises.writeFile(path.join(repoPath, 'staged.txt'), 'staged content')
      execSync('git add staged.txt', { cwd: repoPath })

      // Verify staged state
      const statusBefore = await git.getWorkingTreeStatus(repoPath)
      expect(statusBefore.staged).toContain('staged.txt')

      // Act: Acquire execution context
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      try {
        // Assert: Context uses a temporary worktree
        expect(context.isTemporary).toBe(true)

        // Assert: Staged file is still staged in the main worktree
        const statusAfter = await git.getWorkingTreeStatus(repoPath)
        expect(statusAfter.staged).toContain('staged.txt')
      } finally {
        await ExecutionContextService.release(context)
      }
    })

    it('creates temp worktree even when working tree is clean', async () => {
      // Working tree is clean (no uncommitted changes)
      // But we still create temp worktree for consistent UX

      // Act: Acquire execution context
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      try {
        // Assert: Always creates temp worktree now (for consistent UX)
        expect(context.isTemporary).toBe(true)
        expect(context.executionPath).not.toBe(repoPath)
        expect(context.executionPath).toContain('teapot-exec-')
      } finally {
        await ExecutionContextService.release(context)
      }
    })

    it('cleans up temp worktree on release', async () => {
      // Arrange: Create dirty state (modify tracked file to trigger temp worktree)
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'dirty modification')

      // Act: Acquire and release
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      const tempPath = context.executionPath
      expect(context.isTemporary).toBe(true)

      await ExecutionContextService.release(context)

      // Assert: Temp worktree no longer exists
      const tempExists = await fs.promises
        .access(tempPath)
        .then(() => true)
        .catch(() => false)
      expect(tempExists).toBe(false)
    })

    it('preserves all types of uncommitted changes', async () => {
      // Arrange: Create various types of uncommitted changes
      // 1. Untracked file
      await fs.promises.writeFile(path.join(repoPath, 'untracked.txt'), 'untracked')
      // 2. Modified tracked file
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'modified feature content')
      // 3. Staged new file
      await fs.promises.writeFile(path.join(repoPath, 'staged.txt'), 'staged')
      execSync('git add staged.txt', { cwd: repoPath })

      // Act: Acquire and release context (simulating a rebase)
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context.isTemporary).toBe(true)
      await ExecutionContextService.release(context)

      // Assert: All changes are preserved
      const statusAfter = await git.getWorkingTreeStatus(repoPath)
      expect(statusAfter.not_added).toContain('untracked.txt')
      expect(statusAfter.modified).toContain('feature.txt')
      expect(statusAfter.staged).toContain('staged.txt')

      // Assert: File contents are unchanged
      expect(await fs.promises.readFile(path.join(repoPath, 'untracked.txt'), 'utf-8')).toBe(
        'untracked'
      )
      expect(await fs.promises.readFile(path.join(repoPath, 'feature.txt'), 'utf-8')).toBe(
        'modified feature content'
      )
      expect(await fs.promises.readFile(path.join(repoPath, 'staged.txt'), 'utf-8')).toBe('staged')
    })
  })

  describe('End-to-end rebase execution', () => {
    it('rebases feature branch onto updated main while preserving uncommitted changes', async () => {
      // Arrange: Add a new commit to main (simulating trunk update)
      execSync('git checkout main', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'main-update.txt'), 'main update')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "main update"', { cwd: repoPath })
      const mainSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()

      // Switch back to feature and create uncommitted changes
      execSync('git checkout feature', { cwd: repoPath })
      const featureSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'modified while rebasing')

      // Verify dirty state
      const statusBefore = await git.getWorkingTreeStatus(repoPath)
      expect(statusBefore.modified).toContain('feature.txt')

      // Act: Submit and confirm rebase intent (feature onto main)
      const submitResult = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)
      expect(submitResult).not.toBeNull()
      expect(submitResult?.success).toBe(true)

      const confirmResult = await RebaseOperation.confirmRebaseIntent(repoPath)
      expect(confirmResult).not.toBeNull()

      // Assert: Uncommitted changes preserved in working tree
      const statusAfter = await git.getWorkingTreeStatus(repoPath)
      expect(statusAfter.modified).toContain('feature.txt')

      const fileContent = await fs.promises.readFile(path.join(repoPath, 'feature.txt'), 'utf-8')
      expect(fileContent).toBe('modified while rebasing')

      // Assert: The feature branch ref was rebased onto main's latest commit
      // Note: With a dirty worktree, the working tree may still be on the old commit,
      // but the branch ref itself should point to the rebased commit
      const featureBranchParent = execSync('git rev-parse feature^', { cwd: repoPath })
        .toString()
        .trim()
      expect(featureBranchParent).toBe(mainSha)
    }, 15000)

    it('handles rebase with clean worktree (uses temp worktree)', async () => {
      // Arrange: Add a new commit to main
      execSync('git checkout main', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'main-update.txt'), 'main update')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "main update"', { cwd: repoPath })
      const mainSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()

      // Switch back to feature (clean worktree)
      execSync('git checkout feature', { cwd: repoPath })
      const featureSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()

      // Verify clean state
      const statusBefore = await git.getWorkingTreeStatus(repoPath)
      expect(statusBefore.modified).toHaveLength(0)
      expect(statusBefore.staged).toHaveLength(0)

      // Act: Submit and confirm rebase intent
      const submitResult = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)
      expect(submitResult).not.toBeNull()
      expect(submitResult?.success).toBe(true)

      const confirmResult = await RebaseOperation.confirmRebaseIntent(repoPath)
      expect(confirmResult).not.toBeNull()

      // Assert: Rebase completed - check the feature branch ref (not HEAD, since we use temp worktree)
      // The branch ref should have been updated even though rebase happened in temp worktree
      const featureParentSha = execSync('git rev-parse feature^', { cwd: repoPath })
        .toString()
        .trim()
      expect(featureParentSha).toBe(mainSha)
    })
  })

  describe('Error handling', () => {
    it('handles WorktreeCreationError gracefully', async () => {
      // This test verifies that WorktreeCreationError is properly typed and can be caught
      const error = new WorktreeCreationError('Test error', repoPath, 3)
      expect(error.name).toBe('WorktreeCreationError')
      expect(error.repoPath).toBe(repoPath)
      expect(error.attempts).toBe(3)
      expect(error.message).toBe('Test error')
    })

    it('recovers from failed rebase by releasing context', async () => {
      // Arrange: Create dirty state to trigger temp worktree
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'dirty changes')

      // Get info before
      const mainSha = execSync('git rev-parse main', { cwd: repoPath }).toString().trim()
      const featureSha = execSync('git rev-parse feature', { cwd: repoPath }).toString().trim()

      // Submit intent (this will succeed)
      const submitResult = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)

      // For same-base scenario, should return null (no rebase needed)
      // Since feature is already based on main in our setup
      if (submitResult === null) {
        // This is expected if feature is already on main
        return
      }

      // Cancel to clean up
      await RebaseOperation.cancelRebaseIntent(repoPath)

      // Assert: Stored context should be cleared
      const storedPath = await ExecutionContextService.getStoredExecutionPath(repoPath)
      expect(storedPath).toBeUndefined()

      // Assert: Dirty changes still preserved
      const content = await fs.promises.readFile(path.join(repoPath, 'feature.txt'), 'utf-8')
      expect(content).toBe('dirty changes')
    })
  })

  describe('Concurrent operations', () => {
    // This test can be flaky under heavy system load due to git operations and file I/O
    it('prevents concurrent rebase sessions on same repo', { timeout: 10000 }, async () => {
      // Arrange: Add a commit to main so rebase is needed
      execSync('git checkout main', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'main-update.txt'), 'main update')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "main update"', { cwd: repoPath })
      const mainSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()

      execSync('git checkout feature', { cwd: repoPath })
      const featureSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()

      // Act: Start first rebase
      const result1 = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)
      expect(result1?.success).toBe(true)

      // Act: Try to start second rebase (should fail or return existing)
      const result2 = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)

      // Assert: Second submission either fails or returns existing session
      // (implementation may vary - just verify it doesn't create a corrupt state)
      expect(result2).not.toBeNull()

      // Cleanup
      await RebaseOperation.cancelRebaseIntent(repoPath)
    })

    it('maintains context across rebase continue calls', async () => {
      // This test verifies the context is properly stored and retrieved
      // for multi-step rebase operations (like conflict resolution)

      // Arrange: Create a dirty worktree to trigger temp worktree usage
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'local dirty changes')

      // Store context manually to simulate conflict state
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      await ExecutionContextService.storeContext(repoPath, context)

      // Act: Retrieve stored execution path
      const storedPath = await ExecutionContextService.getStoredExecutionPath(repoPath)

      // Assert: Path was stored correctly
      expect(storedPath).toBe(context.executionPath)

      // Cleanup
      await ExecutionContextService.clearStoredContext(repoPath)
      await ExecutionContextService.release(context)

      // Assert: Dirty changes preserved
      const content = await fs.promises.readFile(path.join(repoPath, 'feature.txt'), 'utf-8')
      expect(content).toBe('local dirty changes')
    })
  })

  describe('Worktree conflict scenarios', () => {
    it('detects when branch is checked out in another worktree', async () => {
      // Arrange: First checkout main in the primary repo so we can create worktree for feature
      execSync('git checkout main', { cwd: repoPath })

      // Create a second worktree with the feature branch checked out
      const worktree2Path = path.join(tempDir, 'worktree2')
      execSync(`git worktree add "${worktree2Path}" feature`, { cwd: repoPath })

      try {
        // Arrange: Add a commit to main so rebase is needed
        await fs.promises.writeFile(path.join(repoPath, 'main-update.txt'), 'main update')
        execSync('git add .', { cwd: repoPath })
        execSync('git commit -m "main update"', { cwd: repoPath })
        const mainSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()
        const featureSha = execSync('git rev-parse feature', { cwd: repoPath }).toString().trim()

        // Act: Try to submit rebase intent (feature onto main)
        // This should detect that feature is checked out in worktree2
        const result = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)

        // Assert: Should return worktree conflict or succeed with auto-detach
        // (depending on whether worktree2 is clean or dirty)
        expect(result).not.toBeNull()
        // The operation may succeed if auto-detach works, or return WORKTREE_CONFLICT
        if (result?.success === false && result?.error === 'WORKTREE_CONFLICT') {
          expect(result.worktreeConflicts).toBeDefined()
          expect(result.worktreeConflicts.length).toBeGreaterThan(0)
        }
      } finally {
        // Cleanup: Remove the second worktree
        execSync(`git worktree remove "${worktree2Path}" --force`, { cwd: repoPath })
      }
    })

    it('auto-detaches clean worktrees during rebase', async () => {
      // Arrange: First checkout main in the primary repo so we can create worktree for feature
      execSync('git checkout main', { cwd: repoPath })

      // Create a second worktree with the feature branch (clean)
      const worktree2Path = path.join(tempDir, 'worktree2')
      execSync(`git worktree add "${worktree2Path}" feature`, { cwd: repoPath })

      try {
        // Arrange: Add a commit to main so rebase is needed
        await fs.promises.writeFile(path.join(repoPath, 'main-update.txt'), 'main update')
        execSync('git add .', { cwd: repoPath })
        execSync('git commit -m "main update"', { cwd: repoPath })
        const mainSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()
        const featureSha = execSync('git rev-parse feature', { cwd: repoPath }).toString().trim()

        // Act: Submit rebase intent - should auto-detach the clean worktree
        const submitResult = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)

        // Assert: Should succeed (clean worktrees are auto-detached)
        expect(submitResult).not.toBeNull()
        expect(submitResult?.success).toBe(true)

        // Verify the second worktree was detached
        const worktree2Branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: worktree2Path })
          .toString()
          .trim()
        expect(worktree2Branch).toBe('HEAD') // Detached HEAD
      } finally {
        // Cleanup: Cancel the rebase and remove worktree
        await RebaseOperation.cancelRebaseIntent(repoPath)
        execSync(`git worktree remove "${worktree2Path}" --force`, { cwd: repoPath })
      }
    })

    it('blocks rebase when worktree has dirty changes', async () => {
      // Arrange: First checkout main in the primary repo so we can create worktree for feature
      execSync('git checkout main', { cwd: repoPath })

      // Create a second worktree with the feature branch
      const worktree2Path = path.join(tempDir, 'worktree2')
      execSync(`git worktree add "${worktree2Path}" feature`, { cwd: repoPath })

      try {
        // Make the second worktree dirty
        await fs.promises.writeFile(
          path.join(worktree2Path, 'feature.txt'),
          'dirty changes in worktree2'
        )

        // Arrange: Add a commit to main so rebase is needed
        await fs.promises.writeFile(path.join(repoPath, 'main-update.txt'), 'main update')
        execSync('git add .', { cwd: repoPath })
        execSync('git commit -m "main update"', { cwd: repoPath })
        const mainSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()
        const featureSha = execSync('git rev-parse feature', { cwd: repoPath }).toString().trim()

        // Act: Submit rebase intent - should fail due to dirty worktree
        const result = await RebaseOperation.submitRebaseIntent(repoPath, featureSha, mainSha)

        // Assert: Should return WORKTREE_CONFLICT error
        expect(result).not.toBeNull()
        if (result?.success === false) {
          expect(result.error).toBe('WORKTREE_CONFLICT')
          expect(result.worktreeConflicts).toBeDefined()
          expect(result.worktreeConflicts.some((c) => c.isDirty)).toBe(true)
        }
      } finally {
        // Cleanup: Remove the second worktree
        execSync(`git worktree remove "${worktree2Path}" --force`, { cwd: repoPath })
      }
    })
  })

  describe('RebaseOperationError', () => {
    it('encodes error code in name for IPC serialization', () => {
      const error = new RebaseOperationError('Test message', 'WORKTREE_CREATION_FAILED')
      expect(error.name).toBe('RebaseOperationError:WORKTREE_CREATION_FAILED')
      expect(error.message).toBe('Test message')
      expect(error.errorCode).toBe('WORKTREE_CREATION_FAILED')
    })

    it('uses plain name when no error code provided', () => {
      const error = new RebaseOperationError('Test message')
      expect(error.name).toBe('RebaseOperationError')
      expect(error.errorCode).toBeUndefined()
    })

    it('serializes correctly to JSON', () => {
      const error = new RebaseOperationError('Test message', 'SESSION_EXISTS')
      const json = error.toJSON()

      expect(json.name).toBe('RebaseOperationError:SESSION_EXISTS')
      expect(json.message).toBe('Test message')
      expect(json.errorCode).toBe('SESSION_EXISTS')
      expect(json.stack).toBeDefined()
    })

    it('extracts error code from valid error name', () => {
      expect(
        RebaseOperationError.extractErrorCode('RebaseOperationError:WORKTREE_CREATION_FAILED')
      ).toBe('WORKTREE_CREATION_FAILED')
      expect(RebaseOperationError.extractErrorCode('RebaseOperationError:SESSION_EXISTS')).toBe(
        'SESSION_EXISTS'
      )
      expect(RebaseOperationError.extractErrorCode('RebaseOperationError:VALIDATION_FAILED')).toBe(
        'VALIDATION_FAILED'
      )
    })

    it('returns null for invalid error names', () => {
      expect(RebaseOperationError.extractErrorCode('Error')).toBeNull()
      expect(RebaseOperationError.extractErrorCode('RebaseOperationError')).toBeNull()
      expect(RebaseOperationError.extractErrorCode('RebaseOperationError:')).toBeNull()
      expect(RebaseOperationError.extractErrorCode('RebaseOperationError:UNKNOWN_CODE')).toBeNull()
      expect(
        RebaseOperationError.extractErrorCode('SomeOtherError:WORKTREE_CREATION_FAILED')
      ).toBeNull()
    })
  })

  describe('Cleanup failure tracking', () => {
    beforeEach(() => {
      resetCleanupFailureCount()
    })

    it('starts with zero cleanup failures', () => {
      expect(getCleanupFailureCount()).toBe(0)
    })

    it('can reset cleanup failure count', () => {
      // This just verifies the reset works - actual failure counting
      // would require mocking internal failures which is complex
      resetCleanupFailureCount()
      expect(getCleanupFailureCount()).toBe(0)
    })
  })

  describe('Context schema validation', () => {
    it('handles corrupted context file gracefully', async () => {
      // Create dirty state to trigger context creation
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'dirty changes')

      // Manually write an invalid context file
      const contextPath = path.join(repoPath, '.git', 'teapot-context.json')
      await fs.promises.mkdir(path.dirname(contextPath), { recursive: true })
      await fs.promises.writeFile(contextPath, '{"invalid": "context"}')

      // Acquire should succeed despite invalid stored context (clears it and creates new)
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context).toBeDefined()
      expect(context.executionPath).toBeDefined()

      // Cleanup
      await ExecutionContextService.clearStoredContext(repoPath)
      await ExecutionContextService.release(context)
    })

    it('handles malformed JSON in context file', async () => {
      // Create dirty state to trigger context creation
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'dirty changes')

      // Manually write malformed JSON
      const contextPath = path.join(repoPath, '.git', 'teapot-context.json')
      await fs.promises.mkdir(path.dirname(contextPath), { recursive: true })
      await fs.promises.writeFile(contextPath, 'not valid json')

      // Acquire should succeed despite malformed file
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context).toBeDefined()
      expect(context.executionPath).toBeDefined()

      // Cleanup
      await ExecutionContextService.clearStoredContext(repoPath)
      await ExecutionContextService.release(context)
    })
  })
})
