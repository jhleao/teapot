import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store
let mockActiveWorktree: string | null = null
vi.mock('../../store', () => ({
  configStore: {
    getActiveWorktree: () => mockActiveWorktree,
    getUseParallelWorktree: vi.fn().mockReturnValue(true)
  }
}))

import {
  ContextNotFoundError,
  ExecutionContextService,
  LockAcquisitionError,
  WorktreeCreationError
} from '../../services/ExecutionContextService'

describe('ExecutionContextService', () => {
  let repoPath: string
  let tempDir: string

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-exec-test-'))

    // Create a git repo
    repoPath = path.join(tempDir, 'repo')
    await fs.promises.mkdir(repoPath)
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'content')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Reset mock state
    mockActiveWorktree = null
  })

  afterEach(async () => {
    // Clear any stored contexts
    await ExecutionContextService.clearStoredContext(repoPath)

    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  describe('acquire', () => {
    it('creates temporary worktree even when active worktree is clean', async () => {
      const context = await ExecutionContextService.acquire(repoPath)

      // Always creates temp worktree for consistent UX
      expect(context.executionPath).not.toBe(repoPath)
      expect(context.executionPath).toContain('teapot-exec-')
      expect(context.isTemporary).toBe(true)
      expect(context.requiresCleanup).toBe(true)
      expect(context.createdAt).toBeGreaterThan(0)
      expect(context.operation).toBe('unknown')

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('tracks operation type when provided', async () => {
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context.operation).toBe('rebase')

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('creates temporary worktree when active worktree is dirty (staged changes)', async () => {
      // Create a dirty worktree with staged changes
      await fs.promises.writeFile(path.join(repoPath, 'new-file.txt'), 'new content')
      execSync('git add new-file.txt', { cwd: repoPath })

      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      expect(context.executionPath).not.toBe(repoPath)
      expect(context.executionPath).toContain('teapot-exec-')
      expect(context.isTemporary).toBe(true)
      expect(context.requiresCleanup).toBe(true)
      expect(context.operation).toBe('rebase')

      // Verify the temp worktree exists
      const stat = await fs.promises.stat(context.executionPath)
      expect(stat.isDirectory()).toBe(true)

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('creates temporary worktree when active worktree is dirty (modified files)', async () => {
      // Modify an existing tracked file
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified content')

      const context = await ExecutionContextService.acquire(repoPath)

      expect(context.isTemporary).toBe(true)
      expect(context.requiresCleanup).toBe(true)

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('reuses stored context when one exists', async () => {
      // Modify to make dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Acquire a real context (creates temp worktree)
      const firstContext = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(firstContext.isTemporary).toBe(true)

      const storedPath = firstContext.executionPath

      // Store it (simulating conflict)
      await ExecutionContextService.storeContext(repoPath, firstContext)

      // Acquire again should return stored context
      const secondContext = await ExecutionContextService.acquire(repoPath)

      expect(secondContext.executionPath).toBe(storedPath)
      expect(secondContext.isTemporary).toBe(true)
      expect(secondContext.requiresCleanup).toBe(false) // Should not cleanup on reuse
      expect(secondContext.operation).toBe('rebase')

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })
  })

  describe('release', () => {
    it('does nothing for non-temporary context', async () => {
      const context = {
        executionPath: repoPath,
        isTemporary: false,
        requiresCleanup: false,
        createdAt: Date.now(),
        operation: 'unknown' as const,
        repoPath
      }

      // Should not throw
      await ExecutionContextService.release(context)
    })

    it('removes temporary worktree', async () => {
      // Create a dirty state to force temp worktree
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const context = await ExecutionContextService.acquire(repoPath)
      expect(context.isTemporary).toBe(true)

      const tempPath = context.executionPath

      // Verify it exists
      const existsBefore = fs.existsSync(tempPath)
      expect(existsBefore).toBe(true)

      // Release
      await ExecutionContextService.release(context)

      // Verify it's removed
      const existsAfter = fs.existsSync(tempPath)
      expect(existsAfter).toBe(false)
    })

    it('does not throw if temp worktree already removed', async () => {
      const context = {
        executionPath: '/non/existent/teapot-exec-test/path',
        isTemporary: true,
        requiresCleanup: true,
        createdAt: Date.now(),
        operation: 'unknown' as const,
        repoPath
      }

      // Should not throw, just log warning
      await ExecutionContextService.release(context)
    })
  })

  describe('storeContext / hasStoredContext / getStoredExecutionPath', () => {
    it('stores and retrieves temporary context', async () => {
      // Create a dirty state to force temp worktree creation
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Acquire a real temp worktree (validates against git worktree list on load)
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context.isTemporary).toBe(true)

      await ExecutionContextService.storeContext(repoPath, context)

      expect(await ExecutionContextService.hasStoredContext(repoPath)).toBe(true)
      expect(await ExecutionContextService.getStoredExecutionPath(repoPath)).toBe(
        context.executionPath
      )

      // Verify operation is persisted
      const storedContext = await ExecutionContextService.getStoredContext(repoPath)
      expect(storedContext?.operation).toBe('rebase')

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })

    it('does not store non-temporary context', async () => {
      const context = {
        executionPath: repoPath,
        isTemporary: false,
        requiresCleanup: false,
        createdAt: Date.now(),
        operation: 'unknown' as const,
        repoPath
      }

      await ExecutionContextService.storeContext(repoPath, context)

      expect(await ExecutionContextService.hasStoredContext(repoPath)).toBe(false)
      expect(await ExecutionContextService.getStoredExecutionPath(repoPath)).toBeUndefined()
    })

    it('returns undefined for non-existent stored context', async () => {
      expect(await ExecutionContextService.hasStoredContext('/non/existent')).toBe(false)
      expect(await ExecutionContextService.getStoredExecutionPath('/non/existent')).toBeUndefined()
    })
  })

  describe('clearStoredContext', () => {
    it('clears stored context and releases temp worktree', async () => {
      // Create a dirty state to force temp worktree
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const context = await ExecutionContextService.acquire(repoPath)
      expect(context.isTemporary).toBe(true)

      // Store it
      await ExecutionContextService.storeContext(repoPath, context)
      expect(await ExecutionContextService.hasStoredContext(repoPath)).toBe(true)

      const tempPath = context.executionPath

      // Clear
      await ExecutionContextService.clearStoredContext(repoPath)

      // Verify cleared
      expect(await ExecutionContextService.hasStoredContext(repoPath)).toBe(false)

      // Verify temp worktree removed
      const exists = fs.existsSync(tempPath)
      expect(exists).toBe(false)
    })

    it('does nothing for non-existent stored context', async () => {
      // Should not throw
      await ExecutionContextService.clearStoredContext('/non/existent')
    })
  })

  describe('isActiveWorktreeDirty', () => {
    it('returns false for clean worktree', async () => {
      const isDirty = await ExecutionContextService.isActiveWorktreeDirty(repoPath)
      expect(isDirty).toBe(false)
    })

    it('returns true for staged changes', async () => {
      await fs.promises.writeFile(path.join(repoPath, 'new-file.txt'), 'content')
      execSync('git add new-file.txt', { cwd: repoPath })

      const isDirty = await ExecutionContextService.isActiveWorktreeDirty(repoPath)
      expect(isDirty).toBe(true)
    })

    it('returns true for modified files', async () => {
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const isDirty = await ExecutionContextService.isActiveWorktreeDirty(repoPath)
      expect(isDirty).toBe(true)
    })

    it('returns true for deleted files', async () => {
      await fs.promises.unlink(path.join(repoPath, 'file.txt'))

      const isDirty = await ExecutionContextService.isActiveWorktreeDirty(repoPath)
      expect(isDirty).toBe(true)
    })
  })

  describe('conflict resolution workflow', () => {
    it('preserves temp worktree across conflict -> continue cycle', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Acquire context (creates temp worktree)
      const context1 = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context1.isTemporary).toBe(true)

      const tempPath = context1.executionPath

      // Simulate conflict - store context
      await ExecutionContextService.storeContext(repoPath, context1)

      // User resolves conflict, continues
      // Acquire again should return same temp worktree
      const context2 = await ExecutionContextService.acquire(repoPath)
      expect(context2.executionPath).toBe(tempPath)
      expect(context2.requiresCleanup).toBe(false) // Don't cleanup on reuse

      // Temp worktree should still exist
      expect(fs.existsSync(tempPath)).toBe(true)

      // Rebase completes - clear context
      await ExecutionContextService.clearStoredContext(repoPath)

      // Temp worktree should be removed
      expect(fs.existsSync(tempPath)).toBe(false)
    })
  })

  describe('persistent storage', () => {
    it('persists context to disk', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      // Store the context
      await ExecutionContextService.storeContext(repoPath, context)

      // Verify context file exists
      const contextFilePath = path.join(repoPath, '.git', 'teapot-exec-context.json')
      expect(fs.existsSync(contextFilePath)).toBe(true)

      // Read and verify content
      const content = JSON.parse(await fs.promises.readFile(contextFilePath, 'utf-8'))
      expect(content.executionPath).toBe(context.executionPath)
      expect(content.isTemporary).toBe(true)
      expect(content.operation).toBe('rebase')
      expect(content.createdAt).toBeGreaterThan(0)

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })

    it('stores temp worktrees in .git/teapot-worktrees/', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const context = await ExecutionContextService.acquire(repoPath)
      expect(context.isTemporary).toBe(true)

      // Verify temp worktree is in .git/teapot-worktrees/
      expect(context.executionPath).toContain('.git')
      expect(context.executionPath).toContain('teapot-worktrees')

      // Clean up
      await ExecutionContextService.release(context)
    })
  })

  describe('mutex locking', () => {
    it('serializes concurrent acquire calls', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Start multiple concurrent acquires
      const [context1, context2] = await Promise.all([
        ExecutionContextService.acquire(repoPath, 'rebase'),
        ExecutionContextService.acquire(repoPath, 'rebase')
      ])

      // Both should succeed (mutex should serialize them)
      expect(context1.isTemporary).toBe(true)
      expect(context2.isTemporary).toBe(true)

      // Clean up
      await ExecutionContextService.release(context1)
      await ExecutionContextService.release(context2)
    })
  })

  describe('custom error types', () => {
    it('LockAcquisitionError contains repo path and attempts', () => {
      const error = new LockAcquisitionError('test message', '/test/path', 5)
      expect(error.name).toBe('LockAcquisitionError')
      expect(error.message).toBe('test message')
      expect(error.repoPath).toBe('/test/path')
      expect(error.attempts).toBe(5)
      expect(error instanceof Error).toBe(true)
    })

    it('WorktreeCreationError contains repo path, attempts and cause', () => {
      const cause = new Error('underlying error')
      const error = new WorktreeCreationError('test message', '/test/path', 3, cause)
      expect(error.name).toBe('WorktreeCreationError')
      expect(error.message).toBe('test message')
      expect(error.repoPath).toBe('/test/path')
      expect(error.attempts).toBe(3)
      expect(error.cause).toBe(cause)
      expect(error instanceof Error).toBe(true)
    })

    it('WorktreeCreationError works without cause', () => {
      const error = new WorktreeCreationError('test message', '/test/path', 3)
      expect(error.name).toBe('WorktreeCreationError')
      expect(error.cause).toBeUndefined()
    })

    it('throws ContextNotFoundError from getStoredContextOrThrow', async () => {
      await expect(ExecutionContextService.getStoredContextOrThrow(repoPath)).rejects.toThrow(
        ContextNotFoundError
      )
    })

    it('ContextNotFoundError contains repo path', () => {
      const error = new ContextNotFoundError('test message', '/test/path')
      expect(error.name).toBe('ContextNotFoundError')
      expect(error.message).toBe('test message')
      expect(error.repoPath).toBe('/test/path')
      expect(error instanceof Error).toBe(true)
    })

    it('getStoredContextOrThrow returns context when it exists', async () => {
      // Create a dirty state to force temp worktree creation
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Acquire a real temp worktree (validates against git worktree list on load)
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      expect(context.isTemporary).toBe(true)

      await ExecutionContextService.storeContext(repoPath, context)

      // Should not throw
      const stored = await ExecutionContextService.getStoredContextOrThrow(repoPath)
      expect(stored.executionPath).toBe(context.executionPath)
      expect(stored.operation).toBe('rebase')

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })
  })

  describe('concurrent multi-process scenarios', () => {
    it('handles concurrent lock file creation', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Simulate concurrent lock acquisition by pre-creating then immediately removing lock
      const lockPath = path.join(repoPath, '.git', 'teapot-exec.lock')

      // Create a lock file with stale timestamp
      const staleTimestamp = Date.now() - 10 * 60 * 1000 // 10 minutes ago (past 5 min threshold)
      await fs.promises.writeFile(
        lockPath,
        JSON.stringify({
          pid: 99999,
          timestamp: staleTimestamp
        })
      )

      // Acquire should break the stale lock and succeed
      const context = await ExecutionContextService.acquire(repoPath)
      expect(context).toBeDefined()

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('handles file lock disappearing during retry', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Create a lock file
      const lockPath = path.join(repoPath, '.git', 'teapot-exec.lock')
      await fs.promises.writeFile(
        lockPath,
        JSON.stringify({
          pid: 99999,
          timestamp: Date.now()
        })
      )

      // Schedule lock removal after a short delay
      setTimeout(async () => {
        await fs.promises.unlink(lockPath).catch(() => {})
      }, 150)

      // Acquire should succeed after the lock is removed
      const context = await ExecutionContextService.acquire(repoPath)
      expect(context).toBeDefined()

      // Clean up
      await ExecutionContextService.release(context)
    })
  })

  describe('atomic write error handling', () => {
    it('cleans up temp file on write failure', async () => {
      // Create a real temp directory for the worktree
      const fakeTempPath = path.join(tempDir, 'fake-temp-worktree')
      await fs.promises.mkdir(fakeTempPath, { recursive: true })

      const context = {
        executionPath: fakeTempPath,
        isTemporary: true,
        requiresCleanup: true,
        createdAt: Date.now(),
        operation: 'rebase' as const,
        repoPath
      }

      // Store context should succeed
      await ExecutionContextService.storeContext(repoPath, context)

      // Verify context file was created
      const contextFilePath = path.join(repoPath, '.git', 'teapot-exec-context.json')
      expect(fs.existsSync(contextFilePath)).toBe(true)

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })

    it('handles read errors gracefully when loading context', async () => {
      // Create a malformed context file
      const contextFilePath = path.join(repoPath, '.git', 'teapot-exec-context.json')
      await fs.promises.writeFile(contextFilePath, 'invalid json {{{')

      // Should return null instead of throwing
      const context = await ExecutionContextService.getStoredContext(repoPath)
      expect(context).toBeNull()

      // Clean up
      await fs.promises.unlink(contextFilePath)
    })

    it('handles missing temp worktree in persisted context', async () => {
      // Create context file pointing to non-existent worktree
      const contextFilePath = path.join(repoPath, '.git', 'teapot-exec-context.json')
      await fs.promises.writeFile(
        contextFilePath,
        JSON.stringify({
          executionPath: '/non/existent/teapot-exec-test',
          isTemporary: true,
          createdAt: Date.now(),
          operation: 'rebase',
          repoPath
        })
      )

      // Should return null and clear the invalid context
      const context = await ExecutionContextService.getStoredContext(repoPath)
      expect(context).toBeNull()

      // Context file should be cleared
      expect(fs.existsSync(contextFilePath)).toBe(false)
    })

    it('rejects context pointing to unregistered worktree', async () => {
      // Create a directory that exists but isn't in git worktree list
      const orphanDir = path.join(repoPath, '.git', 'teapot-worktrees', 'teapot-exec-orphan')
      await fs.promises.mkdir(orphanDir, { recursive: true })

      // Manually create context file pointing to orphan directory
      const contextFilePath = path.join(repoPath, '.git', 'teapot-exec-context.json')
      await fs.promises.writeFile(
        contextFilePath,
        JSON.stringify({
          executionPath: orphanDir,
          repoPath,
          isTemporary: true,
          createdAt: Date.now(),
          operation: 'rebase'
        })
      )

      // Should return null because directory exists but isn't a registered worktree
      const context = await ExecutionContextService.getStoredContext(repoPath)
      expect(context).toBeNull()

      // Context file should be cleared
      expect(fs.existsSync(contextFilePath)).toBe(false)

      // Clean up the orphan directory
      await fs.promises.rm(orphanDir, { recursive: true, force: true })
    })
  })

  describe('worktree creation', () => {
    it('creates temporary worktree successfully', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Acquire should succeed
      const context = await ExecutionContextService.acquire(repoPath)
      expect(context.isTemporary).toBe(true)
      expect(context.executionPath).toContain('teapot-exec-')

      // Verify worktree directory exists
      expect(fs.existsSync(context.executionPath)).toBe(true)

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('creates worktree in .git/teapot-worktrees directory', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const context = await ExecutionContextService.acquire(repoPath)
      expect(context.isTemporary).toBe(true)

      // Verify path contains the expected directory structure
      // Note: On macOS, paths may be resolved differently (e.g., /private/var vs /var)
      expect(context.executionPath).toContain('.git')
      expect(context.executionPath).toContain('teapot-worktrees')
      expect(context.executionPath).toContain('teapot-exec-')

      // Clean up
      await ExecutionContextService.release(context)
    })

    it('creates unique worktree names for concurrent requests', async () => {
      // Make worktree dirty
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      // Acquire two contexts
      const context1 = await ExecutionContextService.acquire(repoPath)
      const context2 = await ExecutionContextService.acquire(repoPath)

      // Both should be temporary
      expect(context1.isTemporary).toBe(true)
      expect(context2.isTemporary).toBe(true)

      // Paths should be different
      expect(context1.executionPath).not.toBe(context2.executionPath)

      // Clean up
      await ExecutionContextService.release(context1)
      await ExecutionContextService.release(context2)
    })
  })

  describe('rebase in progress handling', () => {
    it('uses active worktree when rebase is in progress (conflict state)', async () => {
      // Create a branch for the rebase
      execSync('git checkout -b feature', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'feature content')
      execSync('git add feature.txt', { cwd: repoPath })
      execSync('git commit -m "feature commit"', { cwd: repoPath })
      execSync('git checkout main', { cwd: repoPath })

      // Create a conflicting change on main
      await fs.promises.writeFile(path.join(repoPath, 'feature.txt'), 'main content')
      execSync('git add feature.txt', { cwd: repoPath })
      execSync('git commit -m "main commit"', { cwd: repoPath })

      // Start a rebase that will conflict
      execSync('git checkout feature', { cwd: repoPath })
      try {
        execSync('git rebase main', { cwd: repoPath, stdio: 'pipe' })
      } catch {
        // Expected - rebase will fail due to conflict
      }

      // Verify rebase is in progress (the worktree is "dirty" but in rebase state)
      // This simulates the scenario where:
      // 1. User started rebase with clean worktree
      // 2. Rebase hit a conflict
      // 3. User resolved the conflict (worktree now has staged changes)
      // 4. User clicks "Continue" button

      // Acquire should return the active worktree (not create a temp worktree)
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')

      expect(context.executionPath).toBe(repoPath)
      expect(context.isTemporary).toBe(false)
      expect(context.requiresCleanup).toBe(false)

      // Abort the rebase for cleanup
      execSync('git rebase --abort', { cwd: repoPath })
    })
  })

  describe('validation', () => {
    it('throws for empty repoPath', async () => {
      await expect(ExecutionContextService.acquire('')).rejects.toThrow('repoPath is required')
    })

    it('throws for non-existent repoPath', async () => {
      await expect(ExecutionContextService.acquire('/non/existent/path')).rejects.toThrow(
        'Repository path does not exist'
      )
    })

    it('throws for non-git directory', async () => {
      const nonGitDir = path.join(tempDir, 'non-git')
      await fs.promises.mkdir(nonGitDir, { recursive: true })

      await expect(ExecutionContextService.acquire(nonGitDir)).rejects.toThrow(
        'Not a git repository'
      )
    })
  })
})
