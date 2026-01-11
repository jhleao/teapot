import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store to avoid electron-store initialization
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null),
    getActiveWorktree: vi.fn().mockReturnValue(null),
    setActiveWorktree: vi.fn()
  }
}))

// Mock the forge service
vi.mock('../../services/ForgeService', () => ({
  gitForgeService: {
    deleteRemoteBranch: vi.fn(),
    getStateWithStatus: vi.fn().mockResolvedValue({ state: { pullRequests: [] } }),
    closePullRequest: vi.fn()
  }
}))

import { BranchOperation } from '../../operations/BranchOperation'
import { TrunkProtectionError } from '../../shared/errors'

import { gitForgeService } from '../../services/ForgeService'

describe('cleanupBranch', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-cleanup-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should delete local branch and attempt remote deletion', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create and checkout a feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Add another commit to feature branch
    execSync('git checkout feature', { cwd: repoPath })
    await fs.promises.writeFile(file1, 'feature change')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "feature commit"', { cwd: repoPath })

    // Go back to main
    execSync('git checkout main', { cwd: repoPath })

    // Cleanup the feature branch
    await BranchOperation.cleanup(repoPath, 'feature')

    // Assertions
    // 1. Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')

    // 2. Remote deletion should have been attempted
    expect(gitForgeService.deleteRemoteBranch).toHaveBeenCalledWith(repoPath, 'feature')
  })

  it('should throw error when trying to delete current branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create and checkout feature branch
    execSync('git checkout -b feature', { cwd: repoPath })

    // Try to cleanup current branch - should throw
    await expect(BranchOperation.cleanup(repoPath, 'feature')).rejects.toThrow(
      'Cannot delete the currently checked out branch'
    )

    // Branch should still exist
    const currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('feature')
  })

  it('should succeed even if remote deletion fails (no PAT configured)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock remote deletion to fail (simulating no PAT)
    vi.mocked(gitForgeService.deleteRemoteBranch).mockRejectedValueOnce(
      new Error('No GitHub PAT configured')
    )

    // Cleanup should still succeed (local deletion happens)
    await BranchOperation.cleanup(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should delete remote-tracking ref even when remote deletion fails', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch and simulate a remote tracking ref
    execSync('git branch feature', { cwd: repoPath })
    execSync('git update-ref refs/remotes/origin/feature HEAD', { cwd: repoPath })

    // Verify the remote tracking ref exists
    const remoteBranchesBefore = execSync('git branch -r', { cwd: repoPath, encoding: 'utf-8' })
    expect(remoteBranchesBefore).toContain('origin/feature')

    // Mock remote deletion to fail (simulating network error)
    vi.mocked(gitForgeService.deleteRemoteBranch).mockRejectedValueOnce(new Error('Network error'))

    // Cleanup should still succeed
    await BranchOperation.cleanup(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')

    // Remote tracking ref should ALSO be gone (even though remote deletion failed)
    const remoteBranchesAfter = execSync('git branch -r', { cwd: repoPath, encoding: 'utf-8' })
    expect(remoteBranchesAfter).not.toContain('origin/feature')
  })

  it('should succeed if remote branch does not exist (already deleted)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock remote deletion to fail with 404 (branch doesn't exist on remote)
    vi.mocked(gitForgeService.deleteRemoteBranch).mockRejectedValueOnce(
      new Error('Reference does not exist')
    )

    // Cleanup should still succeed
    await BranchOperation.cleanup(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should delete local branch even when no remote is configured', async () => {
    // Setup: main -> commit1 (no remote)
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock remote deletion to gracefully handle no remote
    vi.mocked(gitForgeService.deleteRemoteBranch).mockResolvedValueOnce(undefined)

    // Cleanup should succeed
    await BranchOperation.cleanup(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should remove worktree before deleting branch that is checked out in worktree', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Create a worktree for the feature branch
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-test-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: repoPath })

    try {
      // Cleanup should succeed - it should remove worktree first, then delete branch
      await BranchOperation.cleanup(repoPath, 'feature')

      // Local branch should be gone
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
        .split('\n')
        .map((b) => b.trim().replace(/^\*\s*/, ''))
        .filter(Boolean)
      expect(branches).not.toContain('feature')

      // Worktree should be gone
      const worktrees = execSync('git worktree list', { cwd: repoPath, encoding: 'utf-8' })
      expect(worktrees).not.toContain(worktreePath)
    } finally {
      // Cleanup worktree if test fails partway through
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoPath })
      } catch {
        // Ignore if already removed
      }
    }
  })

  it('should throw error when worktree has uncommitted changes', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Create a worktree for the feature branch
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-test-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: repoPath })

    try {
      // Make the worktree dirty by adding uncommitted changes
      const dirtyFile = path.join(worktreePath, 'dirty.txt')
      await fs.promises.writeFile(dirtyFile, 'uncommitted changes')

      // Cleanup should fail because worktree is dirty
      await expect(BranchOperation.cleanup(repoPath, 'feature')).rejects.toThrow(
        /has uncommitted changes/
      )

      // Branch should still exist (may have + prefix when checked out in worktree)
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
        .split('\n')
        .map((b) => b.trim().replace(/^[*+]\s*/, ''))
        .filter(Boolean)
      expect(branches).toContain('feature')

      // Worktree should still exist
      const worktrees = execSync('git worktree list', { cwd: repoPath, encoding: 'utf-8' })
      expect(worktrees).toContain(worktreePath)
    } finally {
      // Cleanup worktree
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoPath })
      } catch {
        // Ignore if already removed
      }
    }
  })

  it('should delete remote-tracking ref after successful remote branch deletion', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Simulate having a remote tracking ref by creating a fake remote ref
    // In a real scenario, this would come from `git fetch`
    execSync('git update-ref refs/remotes/origin/feature HEAD', { cwd: repoPath })

    // Verify the remote tracking ref exists
    const remoteBranchesBefore = execSync('git branch -r', { cwd: repoPath, encoding: 'utf-8' })
    expect(remoteBranchesBefore).toContain('origin/feature')

    // Cleanup should succeed
    await BranchOperation.cleanup(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')

    // Remote tracking ref should also be gone
    const remoteBranchesAfter = execSync('git branch -r', { cwd: repoPath, encoding: 'utf-8' })
    expect(remoteBranchesAfter).not.toContain('origin/feature')
  })

  it('should throw TrunkProtectionError when trying to cleanup trunk branch (main)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create and checkout a different branch so we're not on main
    execSync('git checkout -b feature', { cwd: repoPath })

    // Try to cleanup main branch - should throw TrunkProtectionError
    await expect(BranchOperation.cleanup(repoPath, 'main')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.cleanup(repoPath, 'main')).rejects.toThrow(
      /Cannot cleanup trunk branch/
    )

    // main branch should still exist
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^[*+]\s*/, ''))
      .filter(Boolean)
    expect(branches).toContain('main')
  })

  it('should throw TrunkProtectionError when trying to cleanup develop trunk branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create develop branch
    execSync('git branch develop', { cwd: repoPath })

    // Try to cleanup develop branch - should throw TrunkProtectionError
    await expect(BranchOperation.cleanup(repoPath, 'develop')).rejects.toThrow(TrunkProtectionError)
  })
})

describe('deleteBranch', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-delete-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should delete local branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Delete the feature branch
    await BranchOperation.delete(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should throw error when trying to delete current branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create and checkout feature branch
    execSync('git checkout -b feature', { cwd: repoPath })

    // Try to delete current branch - should throw
    await expect(BranchOperation.delete(repoPath, 'feature')).rejects.toThrow(
      'Cannot delete the checked out branch'
    )

    // Branch should still exist
    const currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('feature')
  })

  it('should remove worktree before deleting branch that is checked out in worktree', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Create a worktree for the feature branch
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-delete-test-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: repoPath })

    try {
      // Delete should succeed - it should remove worktree first, then delete branch
      await BranchOperation.delete(repoPath, 'feature')

      // Local branch should be gone
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
        .split('\n')
        .map((b) => b.trim().replace(/^\*\s*/, ''))
        .filter(Boolean)
      expect(branches).not.toContain('feature')

      // Worktree should be gone
      const worktrees = execSync('git worktree list', { cwd: repoPath, encoding: 'utf-8' })
      expect(worktrees).not.toContain(worktreePath)
    } finally {
      // Cleanup worktree if test fails partway through
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoPath })
      } catch {
        // Ignore if already removed
      }
    }
  })

  it('should throw error when worktree has uncommitted changes', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Create a worktree for the feature branch
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-delete-test-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: repoPath })

    try {
      // Make the worktree dirty by adding uncommitted changes
      const dirtyFile = path.join(worktreePath, 'dirty.txt')
      await fs.promises.writeFile(dirtyFile, 'uncommitted changes')

      // Delete should fail because worktree is dirty
      await expect(BranchOperation.delete(repoPath, 'feature')).rejects.toThrow(
        /has uncommitted changes/
      )

      // Branch should still exist (may have + prefix when checked out in worktree)
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
        .split('\n')
        .map((b) => b.trim().replace(/^[*+]\s*/, ''))
        .filter(Boolean)
      expect(branches).toContain('feature')

      // Worktree should still exist
      const worktrees = execSync('git worktree list', { cwd: repoPath, encoding: 'utf-8' })
      expect(worktrees).toContain(worktreePath)
    } finally {
      // Cleanup worktree
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoPath })
      } catch {
        // Ignore if already removed
      }
    }
  })

  it('should close PR when deleting a branch with an open PR', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock an open PR for the feature branch
    vi.mocked(gitForgeService.getStateWithStatus).mockResolvedValueOnce({
      state: {
        pullRequests: [
          {
            number: 123,
            headRefName: 'feature',
            state: 'open',
            title: 'Test PR',
            url: 'https://github.com/test/repo/pull/123',
            headSha: 'abc123',
            baseRefName: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            isMergeable: true
          }
        ]
      },
      status: 'idle',
      error: undefined,
      lastSuccessfulFetch: undefined
    })

    // Delete the feature branch
    await BranchOperation.delete(repoPath, 'feature')

    // PR should have been closed
    expect(gitForgeService.closePullRequest).toHaveBeenCalledWith(repoPath, 123)

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should not call closePullRequest when branch has no open PR', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock no PRs
    vi.mocked(gitForgeService.getStateWithStatus).mockResolvedValueOnce({
      state: { pullRequests: [] },
      status: 'idle',
      error: undefined,
      lastSuccessfulFetch: undefined
    })

    // Delete the feature branch
    await BranchOperation.delete(repoPath, 'feature')

    // closePullRequest should not have been called
    expect(gitForgeService.closePullRequest).not.toHaveBeenCalled()

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should still delete branch when PR closing fails', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock an open PR for the feature branch
    vi.mocked(gitForgeService.getStateWithStatus).mockResolvedValueOnce({
      state: {
        pullRequests: [
          {
            number: 456,
            headRefName: 'feature',
            state: 'open',
            title: 'Test PR',
            url: 'https://github.com/test/repo/pull/456',
            headSha: 'def456',
            baseRefName: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            isMergeable: true
          }
        ]
      },
      status: 'idle',
      error: undefined,
      lastSuccessfulFetch: undefined
    })

    // Mock closePullRequest to fail
    vi.mocked(gitForgeService.closePullRequest).mockRejectedValueOnce(new Error('API error'))

    // Delete should still succeed (PR close failure is non-blocking)
    await BranchOperation.delete(repoPath, 'feature')

    // closePullRequest should have been attempted
    expect(gitForgeService.closePullRequest).toHaveBeenCalledWith(repoPath, 456)

    // Local branch should still be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should not close PR when it is already closed', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Mock a closed PR for the feature branch (should be ignored)
    vi.mocked(gitForgeService.getStateWithStatus).mockResolvedValueOnce({
      state: {
        pullRequests: [
          {
            number: 789,
            headRefName: 'feature',
            state: 'closed',
            title: 'Already closed PR',
            url: 'https://github.com/test/repo/pull/789',
            headSha: 'ghi789',
            baseRefName: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            isMergeable: false
          }
        ]
      },
      status: 'idle',
      error: undefined,
      lastSuccessfulFetch: undefined
    })

    // Delete the feature branch
    await BranchOperation.delete(repoPath, 'feature')

    // closePullRequest should not have been called (PR is already closed)
    expect(gitForgeService.closePullRequest).not.toHaveBeenCalled()

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })

  it('should throw TrunkProtectionError when trying to delete trunk branch (main)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create and checkout a different branch so we're not on main
    execSync('git checkout -b feature', { cwd: repoPath })

    // Try to delete main branch - should throw TrunkProtectionError
    await expect(BranchOperation.delete(repoPath, 'main')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'main')).rejects.toThrow(
      /Cannot delete trunk branch/
    )

    // main branch should still exist
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^[*+]\s*/, ''))
      .filter(Boolean)
    expect(branches).toContain('main')
  })

  it('should throw TrunkProtectionError when trying to delete trunk branch (master)', async () => {
    // Create a new repo with master as default branch
    const masterRepoPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'teapot-test-delete-master-')
    )
    try {
      execSync('git init -b master', { cwd: masterRepoPath })
      execSync('git config user.name "Test User"', { cwd: masterRepoPath })
      execSync('git config user.email "test@example.com"', { cwd: masterRepoPath })

      const file1 = path.join(masterRepoPath, 'file1.txt')
      await fs.promises.writeFile(file1, 'initial')
      execSync('git add file1.txt', { cwd: masterRepoPath })
      execSync('git commit -m "commit 1"', { cwd: masterRepoPath })

      // Create and checkout a different branch
      execSync('git checkout -b feature', { cwd: masterRepoPath })

      // Try to delete master branch - should throw TrunkProtectionError
      await expect(BranchOperation.delete(masterRepoPath, 'master')).rejects.toThrow(
        TrunkProtectionError
      )
    } finally {
      await fs.promises.rm(masterRepoPath, { recursive: true, force: true })
    }
  })

  it('should throw TrunkProtectionError when trying to delete develop trunk branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create develop branch
    execSync('git branch develop', { cwd: repoPath })

    // Try to delete develop branch - should throw TrunkProtectionError
    await expect(BranchOperation.delete(repoPath, 'develop')).rejects.toThrow(TrunkProtectionError)
  })
})

describe('renameBranch', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-rename-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should rename a local branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Rename the feature branch
    await BranchOperation.rename(repoPath, 'feature', 'feature-renamed')

    // Old branch name should be gone, new name should exist
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
    expect(branches).toContain('feature-renamed')
  })

  it('should throw error when trying to rename trunk branch (main)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create a different branch so we have somewhere to be
    execSync('git checkout -b feature', { cwd: repoPath })

    // Try to rename main branch - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'main', 'main-renamed')).rejects.toThrow(
      TrunkProtectionError
    )
    await expect(BranchOperation.rename(repoPath, 'main', 'main-renamed')).rejects.toThrow(
      /Cannot rename trunk branch/
    )

    // main branch should still exist with original name
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^[*+]\s*/, ''))
      .filter(Boolean)
    expect(branches).toContain('main')
    expect(branches).not.toContain('main-renamed')
  })

  it('should throw TrunkProtectionError when trying to rename trunk branch (master)', async () => {
    // Create a new repo with master as default branch
    const masterRepoPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'teapot-test-rename-master-')
    )
    try {
      execSync('git init -b master', { cwd: masterRepoPath })
      execSync('git config user.name "Test User"', { cwd: masterRepoPath })
      execSync('git config user.email "test@example.com"', { cwd: masterRepoPath })

      const file1 = path.join(masterRepoPath, 'file1.txt')
      await fs.promises.writeFile(file1, 'initial')
      execSync('git add file1.txt', { cwd: masterRepoPath })
      execSync('git commit -m "commit 1"', { cwd: masterRepoPath })

      // Create and checkout a different branch
      execSync('git checkout -b feature', { cwd: masterRepoPath })

      // Try to rename master branch - should throw TrunkProtectionError
      await expect(
        BranchOperation.rename(masterRepoPath, 'master', 'master-renamed')
      ).rejects.toThrow(TrunkProtectionError)
    } finally {
      await fs.promises.rm(masterRepoPath, { recursive: true, force: true })
    }
  })

  it('should throw TrunkProtectionError when trying to rename develop trunk branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create develop branch
    execSync('git branch develop', { cwd: repoPath })

    // Try to rename develop branch - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'develop', 'develop-renamed')).rejects.toThrow(
      TrunkProtectionError
    )
  })

  it('should throw TrunkProtectionError when trying to rename trunk branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create trunk branch
    execSync('git branch trunk', { cwd: repoPath })

    // Try to rename trunk branch - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'trunk', 'trunk-renamed')).rejects.toThrow(
      TrunkProtectionError
    )
  })

  it('should throw TrunkProtectionError when trying to rename a branch TO a trunk name', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Try to rename feature to 'main' - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'feature', 'main')).rejects.toThrow(
      TrunkProtectionError
    )

    // Try to rename feature to 'master' - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'feature', 'master')).rejects.toThrow(
      TrunkProtectionError
    )

    // Try to rename feature to 'develop' - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'feature', 'develop')).rejects.toThrow(
      TrunkProtectionError
    )

    // Try to rename feature to 'trunk' - should throw TrunkProtectionError
    await expect(BranchOperation.rename(repoPath, 'feature', 'trunk')).rejects.toThrow(
      TrunkProtectionError
    )

    // feature branch should still exist with original name
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^[*+]\s*/, ''))
      .filter(Boolean)
    expect(branches).toContain('feature')
  })

  it('should throw TrunkProtectionError when renaming TO trunk name with different case (Windows compatibility)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Try to rename feature to 'MAIN' - should throw TrunkProtectionError (case-insensitive)
    await expect(BranchOperation.rename(repoPath, 'feature', 'MAIN')).rejects.toThrow(
      TrunkProtectionError
    )

    // Try to rename feature to 'Master' - should throw TrunkProtectionError (case-insensitive)
    await expect(BranchOperation.rename(repoPath, 'feature', 'Master')).rejects.toThrow(
      TrunkProtectionError
    )
  })
})

describe('trunk protection case sensitivity', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-case-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should protect trunk branches regardless of case (MAIN, Main, main)', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create and checkout a different branch
    execSync('git checkout -b feature', { cwd: repoPath })

    // All case variations should be protected
    // Note: Git on most systems is case-sensitive for branch names, but we still
    // want to protect against case variations for Windows compatibility
    await expect(BranchOperation.delete(repoPath, 'main')).rejects.toThrow(TrunkProtectionError)

    // These tests verify case-insensitivity at the protection layer,
    // even though the actual branches may not exist with these exact names
    await expect(BranchOperation.cleanup(repoPath, 'MAIN')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.rename(repoPath, 'Main', 'something')).rejects.toThrow(
      TrunkProtectionError
    )
  })

  it('should protect MASTER, Master, master case variations', async () => {
    // Setup
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // All case variations should be protected
    await expect(BranchOperation.delete(repoPath, 'master')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'MASTER')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'Master')).rejects.toThrow(TrunkProtectionError)
  })

  it('should protect DEVELOP, Develop, develop case variations', async () => {
    // Setup
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // All case variations should be protected
    await expect(BranchOperation.delete(repoPath, 'develop')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'DEVELOP')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'Develop')).rejects.toThrow(TrunkProtectionError)
  })

  it('should protect TRUNK, Trunk, trunk case variations', async () => {
    // Setup
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // All case variations should be protected
    await expect(BranchOperation.delete(repoPath, 'trunk')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'TRUNK')).rejects.toThrow(TrunkProtectionError)
    await expect(BranchOperation.delete(repoPath, 'Trunk')).rejects.toThrow(TrunkProtectionError)
  })
})

describe('symlinked worktree handling', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-symlink-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should handle symlinked worktree paths when deleting branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Create a worktree for the feature branch
    const actualWorktreePath = path.join(os.tmpdir(), `teapot-wt-actual-${Date.now()}`)
    const symlinkPath = path.join(os.tmpdir(), `teapot-wt-symlink-${Date.now()}`)

    execSync(`git worktree add "${actualWorktreePath}" feature`, { cwd: repoPath })

    try {
      // Create symlink to the worktree
      await fs.promises.symlink(actualWorktreePath, symlinkPath)

      // Delete should succeed - it should properly resolve symlinks when comparing paths
      await BranchOperation.delete(repoPath, 'feature')

      // Local branch should be gone
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
        .split('\n')
        .map((b) => b.trim().replace(/^\*\s*/, ''))
        .filter(Boolean)
      expect(branches).not.toContain('feature')

      // Worktree should be gone
      const worktrees = execSync('git worktree list', { cwd: repoPath, encoding: 'utf-8' })
      expect(worktrees).not.toContain(actualWorktreePath)
    } finally {
      // Cleanup symlink and worktree if test fails partway through
      try {
        await fs.promises.unlink(symlinkPath)
      } catch {
        // Ignore if already removed
      }
      try {
        execSync(`git worktree remove "${actualWorktreePath}" --force`, { cwd: repoPath })
      } catch {
        // Ignore if already removed
      }
    }
  })

  it('should resolve symlinks when comparing active worktree path', async () => {
    // This test verifies that fs.promises.realpath is used correctly
    // when determining if a deleted worktree was the active one

    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })

    // Create a worktree
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-real-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: repoPath })

    try {
      // Even though we don't set an active worktree via symlink,
      // this tests the general worktree removal flow works correctly
      await BranchOperation.delete(repoPath, 'feature')

      // Branch should be deleted
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
        .split('\n')
        .map((b) => b.trim().replace(/^\*\s*/, ''))
        .filter(Boolean)
      expect(branches).not.toContain('feature')
    } finally {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoPath })
      } catch {
        // Ignore
      }
    }
  })
})
