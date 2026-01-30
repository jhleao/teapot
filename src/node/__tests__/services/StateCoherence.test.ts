import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store
let mockActiveWorktree: string | null = null
let mockParallelWorktreeEnabled: boolean = true
vi.mock('../../store', () => ({
  configStore: {
    getActiveWorktree: () => mockActiveWorktree,
    getParallelWorktreeEnabled: () => mockParallelWorktreeEnabled
  }
}))

// Mock SessionService
let mockSession: any = null
vi.mock('../../services/SessionService', () => ({
  getSession: () => mockSession,
  clearSession: vi.fn(),
  hasSession: () => mockSession !== null
}))

import { ExecutionContextService } from '../../services/ExecutionContextService'
import type { StateCoherenceResult } from '../../services/ExecutionContextService'

describe('StateCoherence', () => {
  let repoPath: string
  let tempDir: string

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-coherence-test-'))

    // Create a git repo
    repoPath = path.join(tempDir, 'repo')
    await fs.promises.mkdir(repoPath)
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    execSync('git config commit.gpgsign false', { cwd: repoPath })
    await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'content')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Reset mock state
    mockActiveWorktree = null
    mockParallelWorktreeEnabled = true
    mockSession = null
  })

  afterEach(async () => {
    // Clear any stored contexts
    await ExecutionContextService.clearStoredContext(repoPath)

    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  describe('checkStateCoherence', () => {
    it('returns coherent when no session and no context exist', async () => {
      const result = await ExecutionContextService.checkStateCoherence(repoPath)

      expect(result.isCoherent).toBe(true)
      expect(result.issues).toHaveLength(0)
    })

    it('returns coherent when session and context are both present and consistent', async () => {
      // Create a temp worktree and context
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      await ExecutionContextService.storeContext(repoPath, context)

      // Mock a session with status 'awaiting-user' (conflict state) which is consistent
      // with having a context but not actively rebasing
      mockSession = {
        state: {
          session: { status: 'awaiting-user' },
          queue: { activeJobId: 'job-1', pendingJobIds: [] },
          jobsById: { 'job-1': { id: 'job-1', branch: 'feature', status: 'active' } }
        }
      }

      const result = await ExecutionContextService.checkStateCoherence(repoPath)

      expect(result.isCoherent).toBe(true)
      expect(result.issues).toHaveLength(0)

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })

    it('detects orphaned context when session does not exist', async () => {
      // Create a temp worktree and context
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      await ExecutionContextService.storeContext(repoPath, context)

      // No session (mockSession is null)
      mockSession = null

      const result = await ExecutionContextService.checkStateCoherence(repoPath)

      expect(result.isCoherent).toBe(false)
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'orphaned_context',
          message: expect.stringContaining('context exists but no session')
        })
      )

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })

    it('detects orphaned session when context is missing but session has active job', async () => {
      // Mock a session with an active job
      mockSession = {
        state: {
          session: { status: 'running' },
          queue: { activeJobId: 'job-1', pendingJobIds: [] },
          jobsById: { 'job-1': { id: 'job-1', branch: 'feature', status: 'active' } }
        }
      }

      // No context stored
      // Git is not rebasing (clean state)

      const result = await ExecutionContextService.checkStateCoherence(repoPath)

      expect(result.isCoherent).toBe(false)
      // Should detect orphaned session (session with active job but no context)
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'orphaned_session'
        })
      )
    })

    it('detects invalid context pointing to non-existent worktree', async () => {
      // Manually create a context file pointing to a non-existent path
      const contextFilePath = path.join(repoPath, '.git', 'teapot-exec-context.json')
      await fs.promises.writeFile(
        contextFilePath,
        JSON.stringify({
          executionPath: '/non/existent/path',
          isTemporary: true,
          createdAt: Date.now(),
          operation: 'rebase',
          repoPath
        })
      )

      // Mock a session
      mockSession = {
        state: {
          session: { status: 'running' },
          queue: { activeJobId: 'job-1', pendingJobIds: [] },
          jobsById: { 'job-1': { id: 'job-1', branch: 'feature', status: 'active' } }
        }
      }

      const result = await ExecutionContextService.checkStateCoherence(repoPath)

      expect(result.isCoherent).toBe(false)
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'invalid_context',
          message: expect.stringContaining('does not exist')
        })
      )

      // Clean up
      await fs.promises.unlink(contextFilePath).catch(() => {})
    })

    it('detects session stuck in running state when git is not rebasing', async () => {
      // Mock a session with status 'running' but git is not rebasing
      mockSession = {
        state: {
          session: { status: 'running' },
          queue: { activeJobId: 'job-1', pendingJobIds: [] },
          jobsById: { 'job-1': { id: 'job-1', branch: 'feature', status: 'active' } }
        }
      }

      // Create a valid context (but git is not rebasing)
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      await ExecutionContextService.storeContext(repoPath, context)

      const result = await ExecutionContextService.checkStateCoherence(repoPath)

      expect(result.isCoherent).toBe(false)
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'session_state_mismatch',
          message: expect.stringContaining('running')
        })
      )

      // Clean up
      await ExecutionContextService.clearStoredContext(repoPath)
    })
  })

  describe('repairStateCoherence', () => {
    it('clears orphaned context when session does not exist', async () => {
      // Create a temp worktree and context
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')
      const context = await ExecutionContextService.acquire(repoPath, 'rebase')
      await ExecutionContextService.storeContext(repoPath, context)

      const tempPath = context.executionPath

      // No session
      mockSession = null

      // Verify context exists
      expect(await ExecutionContextService.hasStoredContext(repoPath)).toBe(true)

      // Repair
      const result = await ExecutionContextService.repairStateCoherence(repoPath)

      expect(result.repaired).toBe(true)
      expect(result.actions).toContainEqual(
        expect.objectContaining({
          action: 'cleared_orphaned_context'
        })
      )

      // Verify context was cleared
      expect(await ExecutionContextService.hasStoredContext(repoPath)).toBe(false)
      // Verify temp worktree was removed
      expect(fs.existsSync(tempPath)).toBe(false)
    })

    it('returns no actions when state is already coherent', async () => {
      const result = await ExecutionContextService.repairStateCoherence(repoPath)

      expect(result.repaired).toBe(true)
      expect(result.actions).toHaveLength(0)
    })
  })
})
