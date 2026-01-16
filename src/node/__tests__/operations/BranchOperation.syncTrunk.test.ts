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

describe('syncTrunk', () => {
  let repoPath: string
  let remoteRepoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()

    // Create a "remote" repo to act as origin
    remoteRepoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-remote-'))
    execSync('git init -b main --bare', { cwd: remoteRepoPath })

    // Create local repo
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-sync-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })

    // Initial commit
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Add remote
    execSync(`git remote add origin "${remoteRepoPath}"`, { cwd: repoPath })
    execSync('git push -u origin main', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
    await fs.promises.rm(remoteRepoPath, { recursive: true, force: true })
  })

  describe('dirty tree blocking', () => {
    it('should block syncTrunk when user is on trunk with staged changes', async () => {
      // Make staged changes on main
      const file2 = path.join(repoPath, 'file2.txt')
      await fs.promises.writeFile(file2, 'new file')
      execSync('git add file2.txt', { cwd: repoPath })

      // Simulate remote having new commits
      execSync('git config user.name "Remote User"', { cwd: remoteRepoPath })
      execSync('git config user.email "remote@example.com"', { cwd: remoteRepoPath })

      // Try to sync trunk - should fail with helpful message
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Cannot sync main')
      expect(result.message).toContain('uncommitted changes')
      expect(result.trunkName).toBe('main')
    })

    it('should block syncTrunk when user is on trunk with modified (unstaged) changes', async () => {
      // Modify existing file without staging
      const file1 = path.join(repoPath, 'file1.txt')
      await fs.promises.writeFile(file1, 'modified content')

      // Try to sync trunk - should fail
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Cannot sync main')
      expect(result.message).toContain('uncommitted changes')
      expect(result.trunkName).toBe('main')
    })

    it('should block syncTrunk when user is on trunk with deleted files', async () => {
      // Delete a tracked file
      const file1 = path.join(repoPath, 'file1.txt')
      await fs.promises.unlink(file1)

      // Try to sync trunk - should fail
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Cannot sync main')
      expect(result.message).toContain('uncommitted changes')
    })

    it('should succeed when user is on trunk with clean tree', async () => {
      // Sync trunk with clean tree (no remote changes needed) - should succeed
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')
    })

    it('should NOT block when user is on feature branch with dirty tree', async () => {
      // Create and checkout feature branch
      execSync('git checkout -b feature', { cwd: repoPath })

      // Make dirty changes on feature branch
      const file2 = path.join(repoPath, 'file2.txt')
      await fs.promises.writeFile(file2, 'dirty changes')
      execSync('git add file2.txt', { cwd: repoPath })

      // Sync trunk - should NOT block (dirty tree is on feature, not trunk)
      // Note: Due to a separate bug, this may leave us in detached HEAD, but
      // the key thing we're testing is that the dirty-tree-on-trunk block doesn't
      // incorrectly trigger when we're on a different branch.
      const result = await BranchOperation.syncTrunk(repoPath)

      // Should succeed, not return an error about uncommitted changes
      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')
      expect(result.message).not.toContain('uncommitted changes')
    })

    it('should NOT block when user is in detached HEAD state with dirty tree', async () => {
      // Detach HEAD
      const headSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()
      execSync(`git checkout ${headSha}`, { cwd: repoPath })

      // Make dirty changes in detached state
      const file2 = path.join(repoPath, 'file2.txt')
      await fs.promises.writeFile(file2, 'dirty in detached')

      // Sync trunk - should NOT block (detached HEAD is not "on trunk")
      const result = await BranchOperation.syncTrunk(repoPath)

      // Should succeed, not return an error about uncommitted changes
      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')
      expect(result.message).not.toContain('uncommitted changes')
    })
  })

  describe('basic functionality', () => {
    it('should return success when already up to date', async () => {
      // No new commits on remote, should succeed with "Synced" message
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')
    })

    it('should return conflict when local main has diverged from origin', async () => {
      // First, push to remote so we have a common base
      execSync('git push origin main', { cwd: repoPath })

      // Add local commit to main
      const localFile = path.join(repoPath, 'local-file.txt')
      await fs.promises.writeFile(localFile, 'local only')
      execSync('git add local-file.txt', { cwd: repoPath })
      execSync('git commit -m "local commit"', { cwd: repoPath })

      // Add different commit to remote main (create divergence)
      const tempClone = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-clone-'))
      try {
        // Clone from remote (before local commit)
        execSync(`git clone "${remoteRepoPath}" .`, { cwd: tempClone })
        execSync('git config user.name "Remote User"', { cwd: tempClone })
        execSync('git config user.email "remote@example.com"', { cwd: tempClone })
        await fs.promises.writeFile(path.join(tempClone, 'remote-file.txt'), 'remote only')
        execSync('git add remote-file.txt', { cwd: tempClone })
        execSync('git commit -m "remote commit"', { cwd: tempClone })
        execSync('git push origin main', { cwd: tempClone })
      } finally {
        await fs.promises.rm(tempClone, { recursive: true, force: true })
      }

      // Try to sync - should return conflict
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('conflict')
      expect(result.message).toContain('diverged')
      expect(result.trunkName).toBe('main')
    })

    it('should allow sync when on non-trunk branch even if local trunk has new commits', async () => {
      // Add a commit to local main
      const localFile = path.join(repoPath, 'local-file.txt')
      await fs.promises.writeFile(localFile, 'local commit')
      execSync('git add local-file.txt', { cwd: repoPath })
      execSync('git commit -m "local commit"', { cwd: repoPath })

      // Push to remote so we're up to date
      execSync('git push origin main', { cwd: repoPath })

      // Switch to feature branch with dirty tree
      execSync('git checkout -b feature', { cwd: repoPath })
      const dirtyFile = path.join(repoPath, 'dirty.txt')
      await fs.promises.writeFile(dirtyFile, 'dirty')

      // Sync should succeed (we're not on trunk, dirty tree shouldn't block)
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')
    })
  })

  describe('trunk detection', () => {
    it('should detect master as trunk when main does not exist', async () => {
      // Create a new repo with master as default branch
      const masterRepoPath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-master-')
      )
      const masterRemotePath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-master-remote-')
      )

      try {
        // Create bare remote with master
        execSync('git init -b master --bare', { cwd: masterRemotePath })

        // Create local repo
        execSync('git init -b master', { cwd: masterRepoPath })
        execSync('git config user.name "Test User"', { cwd: masterRepoPath })
        execSync('git config user.email "test@example.com"', { cwd: masterRepoPath })

        const file1 = path.join(masterRepoPath, 'file1.txt')
        await fs.promises.writeFile(file1, 'initial')
        execSync('git add file1.txt', { cwd: masterRepoPath })
        execSync('git commit -m "initial"', { cwd: masterRepoPath })

        execSync(`git remote add origin "${masterRemotePath}"`, { cwd: masterRepoPath })
        execSync('git push -u origin master', { cwd: masterRepoPath })

        // Make dirty tree and test blocking
        await fs.promises.writeFile(file1, 'dirty')

        const result = await BranchOperation.syncTrunk(masterRepoPath)

        expect(result.status).toBe('error')
        expect(result.message).toContain('Cannot sync master')
        expect(result.trunkName).toBe('master')
      } finally {
        await fs.promises.rm(masterRepoPath, { recursive: true, force: true })
        await fs.promises.rm(masterRemotePath, { recursive: true, force: true })
      }
    })
  })
})
