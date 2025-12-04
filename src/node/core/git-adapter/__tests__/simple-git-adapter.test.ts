/**
 * SimpleGitAdapter Tests
 *
 * Tests for the simple-git adapter implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SimpleGitAdapter } from '../simple-git-adapter'
import { cleanupTestRepo, createBranch, createCommit, createTestRepo } from './test-utils'

describe('SimpleGitAdapter', () => {
  let repoPath: string
  let adapter: SimpleGitAdapter

  beforeEach(async () => {
    repoPath = await createTestRepo()
    adapter = new SimpleGitAdapter()
  })

  afterEach(async () => {
    await cleanupTestRepo(repoPath)
  })

  describe('listBranches', () => {
    it('should list all branches', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature')
      await createBranch(repoPath, 'bugfix')

      const branches = await adapter.listBranches(repoPath)

      expect(branches).toContain('main')
      expect(branches).toContain('feature')
      expect(branches).toContain('bugfix')
    })
  })

  describe('currentBranch', () => {
    it('should return current branch', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      const branch = await adapter.currentBranch(repoPath)

      expect(branch).toBe('main')
    })

    it('should switch branches correctly', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature', true)

      const branch = await adapter.currentBranch(repoPath)

      expect(branch).toBe('feature')
    })
  })

  describe('resolveRef', () => {
    it('should resolve HEAD to commit SHA', async () => {
      const sha = await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      const resolvedSha = await adapter.resolveRef(repoPath, 'HEAD')

      expect(resolvedSha).toBe(sha)
    })

    it('should resolve branch names to commit SHA', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature', true)
      const sha = await createCommit(repoPath, { 'file2.txt': 'content2' }, 'feature commit')

      const resolvedSha = await adapter.resolveRef(repoPath, 'feature')

      expect(resolvedSha).toBe(sha)
    })
  })

  describe('log', () => {
    it('should return commit history', async () => {
      await createCommit(repoPath, { 'file1.txt': 'content1' }, 'commit 1')
      await createCommit(repoPath, { 'file2.txt': 'content2' }, 'commit 2')
      await createCommit(repoPath, { 'file3.txt': 'content3' }, 'commit 3')

      const commits = await adapter.log(repoPath, 'HEAD')

      expect(commits.length).toBe(3)
      expect(commits[0]?.message).toBe('commit 3')
      expect(commits[1]?.message).toBe('commit 2')
      expect(commits[2]?.message).toBe('commit 1')
    })

    it('should respect depth limits', async () => {
      for (let i = 0; i < 10; i++) {
        await createCommit(repoPath, { [`file${i}.txt`]: `content${i}` }, `commit ${i}`)
      }

      const commits = await adapter.log(repoPath, 'HEAD', { depth: 5 })

      expect(commits.length).toBe(5)
    })
  })

  describe('getWorkingTreeStatus', () => {
    it('should return clean status for clean repo', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      const status = await adapter.getWorkingTreeStatus(repoPath)

      expect(status.currentBranch).toBe('main')
      expect(status.staged).toEqual([])
      expect(status.modified).toEqual([])
      expect(status.allChangedFiles).toEqual([])
    })

    it('should detect modified files', async () => {
      const fs = await import('fs')
      const path = await import('path')

      await createCommit(repoPath, { 'file.txt': 'original' }, 'initial commit')
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'modified')

      const status = await adapter.getWorkingTreeStatus(repoPath)

      expect(status.modified).toContain('file.txt')
    })

    it('should detect staged files', async () => {
      const fs = await import('fs')
      const path = await import('path')

      await createCommit(repoPath, { 'file1.txt': 'content1' }, 'initial commit')
      await fs.promises.writeFile(path.join(repoPath, 'file2.txt'), 'new file')
      await adapter.add(repoPath, 'file2.txt')

      const status = await adapter.getWorkingTreeStatus(repoPath)

      expect(status.staged).toContain('file2.txt')
      expect(status.created).toContain('file2.txt')
    })
  })

  describe('add / resetIndex', () => {
    it('should stage and unstage files', async () => {
      const fs = await import('fs')
      const path = await import('path')

      await createCommit(repoPath, { 'file1.txt': 'initial' }, 'initial commit')
      await fs.promises.writeFile(path.join(repoPath, 'file1.txt'), 'modified')

      // Stage
      await adapter.add(repoPath, 'file1.txt')
      let status = await adapter.getWorkingTreeStatus(repoPath)
      expect(status.staged).toContain('file1.txt')

      // Unstage
      await adapter.resetIndex(repoPath, 'file1.txt')
      status = await adapter.getWorkingTreeStatus(repoPath)
      expect(status.staged).not.toContain('file1.txt')
    })
  })

  describe('commit', () => {
    it('should create commits', async () => {
      const fs = await import('fs')
      const path = await import('path')

      await createCommit(repoPath, { 'file1.txt': 'initial' }, 'initial commit')
      await fs.promises.writeFile(path.join(repoPath, 'file2.txt'), 'new file')
      await adapter.add(repoPath, 'file2.txt')

      const sha = await adapter.commit(repoPath, {
        message: 'Add file2',
        author: { name: 'Test User', email: 'test@example.com' }
      })

      expect(sha).toBeTruthy()
      expect(sha.length).toBe(40) // Full SHA

      const commit = await adapter.readCommit(repoPath, sha)
      expect(commit.message).toBe('Add file2')
      expect(commit.author.name).toBe('Test User')
    })
  })

  describe('branch / deleteBranch', () => {
    it('should create and delete branches', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      // Create branch
      await adapter.branch(repoPath, 'test-branch')
      let branches = await adapter.listBranches(repoPath)
      expect(branches).toContain('test-branch')

      // Delete branch
      await adapter.deleteBranch(repoPath, 'test-branch')
      branches = await adapter.listBranches(repoPath)
      expect(branches).not.toContain('test-branch')
    })
  })

  describe('checkout', () => {
    it('should checkout branches', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature')

      // Checkout feature
      await adapter.checkout(repoPath, 'feature')
      let branch = await adapter.currentBranch(repoPath)
      expect(branch).toBe('feature')

      // Checkout main
      await adapter.checkout(repoPath, 'main')
      branch = await adapter.currentBranch(repoPath)
      expect(branch).toBe('main')
    })
  })

  describe('reset', () => {
    it('should perform soft reset', async () => {
      const sha1 = await createCommit(repoPath, { 'file1.txt': 'content1' }, 'commit 1')
      await createCommit(repoPath, { 'file2.txt': 'content2' }, 'commit 2')

      // Reset to sha1
      await adapter.reset(repoPath, { mode: 'soft', ref: sha1 })

      // Verify HEAD moved
      const headSha = await adapter.resolveRef(repoPath, 'HEAD')
      expect(headSha).toBe(sha1)

      // Verify working tree status shows changes are staged
      const status = await adapter.getWorkingTreeStatus(repoPath)
      expect(status.staged).toContain('file2.txt')
    })
  })

  describe('mergeBase', () => {
    it('should find merge base between branches', async () => {
      // Create initial commit
      const base = await createCommit(repoPath, { 'file1.txt': 'base' }, 'base commit')

      // Create feature branch
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'file2.txt': 'feature' }, 'feature commit')

      // Go back to main and add commit
      await adapter.checkout(repoPath, 'main')
      await createCommit(repoPath, { 'file3.txt': 'main' }, 'main commit')

      // Find merge base
      const mergeBase = await adapter.mergeBase!(repoPath, 'main', 'feature')

      expect(mergeBase).toBe(base)
    })
  })
})
