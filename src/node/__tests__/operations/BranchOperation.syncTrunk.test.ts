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
    setActiveWorktree: vi.fn(),
    getUseParallelWorktree: vi.fn().mockReturnValue(true)
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
      const result = await BranchOperation.syncTrunk(repoPath)

      // Should succeed, not return an error about uncommitted changes
      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')
      expect(result.message).not.toContain('uncommitted changes')

      // Verify feature branch is still checked out (no detached HEAD)
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(currentBranch).toBe('feature')
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

  describe('strategy selection', () => {
    it('should use direct ref update when trunk is not checked out anywhere', async () => {
      // Switch to feature branch so main is not checked out
      execSync('git checkout -b feature', { cwd: repoPath })

      // Add a commit to remote
      const tempClone = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-clone-'))
      try {
        execSync(`git clone "${remoteRepoPath}" .`, { cwd: tempClone })
        execSync('git config user.name "Remote User"', { cwd: tempClone })
        execSync('git config user.email "remote@example.com"', { cwd: tempClone })
        await fs.promises.writeFile(path.join(tempClone, 'remote-file.txt'), 'new content')
        execSync('git add remote-file.txt', { cwd: tempClone })
        execSync('git commit -m "remote commit"', { cwd: tempClone })
        execSync('git push origin main', { cwd: tempClone })
      } finally {
        await fs.promises.rm(tempClone, { recursive: true, force: true })
      }

      // Sync should succeed using direct ref update (git fetch origin main:main)
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')

      // Verify main was updated
      const mainSha = execSync('git rev-parse main', { cwd: repoPath, encoding: 'utf-8' }).trim()
      const remoteSha = execSync('git rev-parse origin/main', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(mainSha).toBe(remoteSha)

      // Verify feature branch is still checked out (not affected)
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(currentBranch).toBe('feature')
    })

    it('should use merge when trunk is checked out and clean', async () => {
      // User is on main (trunk checked out and clean)
      // Add a commit to remote
      const tempClone = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-clone-'))
      try {
        execSync(`git clone "${remoteRepoPath}" .`, { cwd: tempClone })
        execSync('git config user.name "Remote User"', { cwd: tempClone })
        execSync('git config user.email "remote@example.com"', { cwd: tempClone })
        await fs.promises.writeFile(path.join(tempClone, 'remote-file.txt'), 'new content')
        execSync('git add remote-file.txt', { cwd: tempClone })
        execSync('git commit -m "remote commit"', { cwd: tempClone })
        execSync('git push origin main', { cwd: tempClone })
      } finally {
        await fs.promises.rm(tempClone, { recursive: true, force: true })
      }

      // Sync should succeed using merge --ff-only in the worktree
      const result = await BranchOperation.syncTrunk(repoPath)

      expect(result.status).toBe('success')
      expect(result.trunkName).toBe('main')

      // Verify main was updated and we're still on main (not detached HEAD)
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(currentBranch).toBe('main')

      // Verify the remote file exists locally
      const hasRemoteFile = fs.existsSync(path.join(repoPath, 'remote-file.txt'))
      expect(hasRemoteFile).toBe(true)
    })

    it('should not leave user in detached HEAD after sync on trunk', async () => {
      // User is on main (trunk)
      // Add a commit to remote
      const tempClone = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-clone-'))
      try {
        execSync(`git clone "${remoteRepoPath}" .`, { cwd: tempClone })
        execSync('git config user.name "Remote User"', { cwd: tempClone })
        execSync('git config user.email "remote@example.com"', { cwd: tempClone })
        await fs.promises.writeFile(path.join(tempClone, 'remote-file.txt'), 'new content')
        execSync('git add remote-file.txt', { cwd: tempClone })
        execSync('git commit -m "remote commit"', { cwd: tempClone })
        execSync('git push origin main', { cwd: tempClone })
      } finally {
        await fs.promises.rm(tempClone, { recursive: true, force: true })
      }

      // Sync trunk
      const result = await BranchOperation.syncTrunk(repoPath)
      expect(result.status).toBe('success')

      // CRITICAL: Verify we're still on main, not in detached HEAD
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(currentBranch).toBe('main')
      expect(currentBranch).not.toBe('HEAD') // HEAD means detached
    })

    it('should block when trunk is checked out with uncommitted changes in different worktree', async () => {
      // Create a linked worktree on a feature branch
      const linkedWorktreePath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-linked-')
      )

      try {
        // Create linked worktree on feature branch
        execSync(`git worktree add "${linkedWorktreePath}" -b feature`, { cwd: repoPath })

        // Now main is checked out in the main repo (repoPath)
        // Make it dirty
        const dirtyFile = path.join(repoPath, 'dirty.txt')
        await fs.promises.writeFile(dirtyFile, 'dirty content')

        // Try to sync from the linked worktree - should be blocked because main is dirty
        const result = await BranchOperation.syncTrunk(linkedWorktreePath)

        expect(result.status).toBe('error')
        expect(result.message).toContain('Cannot sync main')
        expect(result.message).toContain('uncommitted changes')
      } finally {
        // Cleanup
        execSync(`git worktree remove "${linkedWorktreePath}" --force`, { cwd: repoPath })
        await fs.promises.rm(linkedWorktreePath, { recursive: true, force: true }).catch(() => {})
      }
    })

    it('should sync when trunk is checked out clean in different worktree', async () => {
      // Create a linked worktree on a feature branch
      const linkedWorktreePath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-linked-')
      )

      try {
        // Create linked worktree on feature branch
        execSync(`git worktree add "${linkedWorktreePath}" -b feature`, { cwd: repoPath })

        // Now main is checked out (clean) in the main repo (repoPath)
        // Add a commit to remote
        const tempClone = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-clone-'))
        try {
          execSync(`git clone "${remoteRepoPath}" .`, { cwd: tempClone })
          execSync('git config user.name "Remote User"', { cwd: tempClone })
          execSync('git config user.email "remote@example.com"', { cwd: tempClone })
          await fs.promises.writeFile(path.join(tempClone, 'remote-file.txt'), 'new content')
          execSync('git add remote-file.txt', { cwd: tempClone })
          execSync('git commit -m "remote commit"', { cwd: tempClone })
          execSync('git push origin main', { cwd: tempClone })
        } finally {
          await fs.promises.rm(tempClone, { recursive: true, force: true })
        }

        // Sync from the linked worktree - should succeed and merge in main repo
        const result = await BranchOperation.syncTrunk(linkedWorktreePath)

        expect(result.status).toBe('success')
        expect(result.trunkName).toBe('main')

        // Verify main was updated in the main repo worktree
        const hasRemoteFile = fs.existsSync(path.join(repoPath, 'remote-file.txt'))
        expect(hasRemoteFile).toBe(true)

        // Verify the linked worktree is still on feature (not affected)
        const linkedBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: linkedWorktreePath,
          encoding: 'utf-8'
        }).trim()
        expect(linkedBranch).toBe('feature')
      } finally {
        // Cleanup
        execSync(`git worktree remove "${linkedWorktreePath}" --force`, { cwd: repoPath })
        await fs.promises.rm(linkedWorktreePath, { recursive: true, force: true }).catch(() => {})
      }
    })
  })

  describe('stale worktree handling', () => {
    it('should skip stale worktrees when analyzing trunk state', async () => {
      // Create a linked worktree for main
      const linkedWorktreePath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-stale-')
      )

      try {
        // Switch main repo to feature branch so we can create a worktree for main
        execSync('git checkout -b feature', { cwd: repoPath })

        // Create linked worktree on main
        execSync(`git worktree add "${linkedWorktreePath}" main`, { cwd: repoPath })

        // Manually delete the worktree directory (simulating stale state)
        await fs.promises.rm(linkedWorktreePath, { recursive: true, force: true })

        // Add a commit to remote
        const tempClone = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-clone-'))
        try {
          execSync(`git clone "${remoteRepoPath}" .`, { cwd: tempClone })
          execSync('git config user.name "Remote User"', { cwd: tempClone })
          execSync('git config user.email "remote@example.com"', { cwd: tempClone })
          await fs.promises.writeFile(path.join(tempClone, 'remote-file.txt'), 'new content')
          execSync('git add remote-file.txt', { cwd: tempClone })
          execSync('git commit -m "remote commit"', { cwd: tempClone })
          execSync('git push origin main', { cwd: tempClone })
        } finally {
          await fs.promises.rm(tempClone, { recursive: true, force: true })
        }

        // Sync should succeed - the stale worktree should be skipped
        // Since main is only "checked out" in a stale worktree, it should use direct ref update
        const result = await BranchOperation.syncTrunk(repoPath)

        expect(result.status).toBe('success')
        expect(result.trunkName).toBe('main')

        // Verify main was updated
        const mainSha = execSync('git rev-parse main', { cwd: repoPath, encoding: 'utf-8' }).trim()
        const remoteSha = execSync('git rev-parse origin/main', {
          cwd: repoPath,
          encoding: 'utf-8'
        }).trim()
        expect(mainSha).toBe(remoteSha)
      } finally {
        // Cleanup - prune the stale worktree reference
        execSync('git worktree prune', { cwd: repoPath })
        await fs.promises.rm(linkedWorktreePath, { recursive: true, force: true }).catch(() => {})
      }
    })
  })

  describe('error handling', () => {
    it('should return error when remote ref does not exist', async () => {
      // Create a repo without pushing main to remote (remote has no refs)
      const isolatedRepo = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-isolated-')
      )
      const isolatedRemote = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'teapot-test-isolated-remote-')
      )

      try {
        // Create bare remote with no refs
        execSync('git init --bare', { cwd: isolatedRemote })

        // Create local repo with main branch
        execSync('git init -b main', { cwd: isolatedRepo })
        execSync('git config user.name "Test User"', { cwd: isolatedRepo })
        execSync('git config user.email "test@example.com"', { cwd: isolatedRepo })
        await fs.promises.writeFile(path.join(isolatedRepo, 'file.txt'), 'content')
        execSync('git add file.txt', { cwd: isolatedRepo })
        execSync('git commit -m "initial"', { cwd: isolatedRepo })

        // Add remote but don't push
        execSync(`git remote add origin "${isolatedRemote}"`, { cwd: isolatedRepo })

        // Try to sync - should fail because origin/main doesn't exist
        const result = await BranchOperation.syncTrunk(isolatedRepo)

        expect(result.status).toBe('error')
        expect(result.message).toContain('origin/main')
        expect(result.message).toContain('not found')
        expect(result.trunkName).toBe('main')
      } finally {
        await fs.promises.rm(isolatedRepo, { recursive: true, force: true })
        await fs.promises.rm(isolatedRemote, { recursive: true, force: true })
      }
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
