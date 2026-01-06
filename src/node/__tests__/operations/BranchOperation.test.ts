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
    deleteRemoteBranch: vi.fn()
  }
}))

import { BranchOperation } from '../../operations/BranchOperation'

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
    vi.mocked(gitForgeService.deleteRemoteBranch).mockRejectedValueOnce(
      new Error('Network error')
    )

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
      'Cannot delete the currently checked out branch'
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
})
