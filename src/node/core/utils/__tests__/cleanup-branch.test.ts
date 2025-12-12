import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupBranch } from '../cleanup-branch'

// Mock the forge service
vi.mock('../../forge/service', () => ({
  gitForgeService: {
    deleteRemoteBranch: vi.fn()
  }
}))

import { gitForgeService } from '../../forge/service'

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
    await cleanupBranch(repoPath, 'feature')

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
    await expect(cleanupBranch(repoPath, 'feature')).rejects.toThrow(
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
    await cleanupBranch(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
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
    await cleanupBranch(repoPath, 'feature')

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
    await cleanupBranch(repoPath, 'feature')

    // Local branch should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')
  })
})
