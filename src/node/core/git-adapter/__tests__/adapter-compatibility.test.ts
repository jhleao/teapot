/**
 * Adapter Compatibility Tests
 *
 * These tests ensure that both isomorphic-git and simple-git adapters
 * produce identical results for all Git operations.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IsomorphicGitAdapter } from '../isomorphic-git-adapter'
import { SimpleGitAdapter } from '../simple-git-adapter'
import { cleanupTestRepo, createBranch, createCommit, createTestRepo } from './test-utils'

describe('Adapter Compatibility', () => {
  let repoPath: string
  let isoAdapter: IsomorphicGitAdapter
  let simpleAdapter: SimpleGitAdapter

  beforeEach(async () => {
    repoPath = await createTestRepo()
    isoAdapter = new IsomorphicGitAdapter()
    simpleAdapter = new SimpleGitAdapter()
  })

  afterEach(async () => {
    await cleanupTestRepo(repoPath)
  })

  describe('listBranches', () => {
    it('should return identical branch lists', async () => {
      // Create branches
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature')
      await createBranch(repoPath, 'bugfix')

      const isoBranches = await isoAdapter.listBranches(repoPath)
      const simpleBranches = await simpleAdapter.listBranches(repoPath)

      expect(isoBranches.sort()).toEqual(simpleBranches.sort())
    })
  })

  describe('currentBranch', () => {
    it('should return identical current branch', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      const isoBranch = await isoAdapter.currentBranch(repoPath)
      const simpleBranch = await simpleAdapter.currentBranch(repoPath)

      expect(isoBranch).toBe('main')
      expect(simpleBranch).toBe('main')
      expect(isoBranch).toEqual(simpleBranch)
    })
  })

  describe('resolveRef', () => {
    it('should resolve HEAD to same SHA', async () => {
      const sha = await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      const isoSha = await isoAdapter.resolveRef(repoPath, 'HEAD')
      const simpleSha = await simpleAdapter.resolveRef(repoPath, 'HEAD')

      expect(isoSha).toBe(sha)
      expect(simpleSha).toBe(sha)
      expect(isoSha).toEqual(simpleSha)
    })

    it('should resolve branch names to same SHA', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature', true)
      const sha = await createCommit(repoPath, { 'file2.txt': 'content2' }, 'feature commit')

      const isoSha = await isoAdapter.resolveRef(repoPath, 'feature')
      const simpleSha = await simpleAdapter.resolveRef(repoPath, 'feature')

      expect(isoSha).toBe(sha)
      expect(simpleSha).toBe(sha)
      expect(isoSha).toEqual(simpleSha)
    })
  })

  describe('log', () => {
    it('should return identical commit logs', async () => {
      await createCommit(repoPath, { 'file1.txt': 'content1' }, 'commit 1')
      await createCommit(repoPath, { 'file2.txt': 'content2' }, 'commit 2')
      await createCommit(repoPath, { 'file3.txt': 'content3' }, 'commit 3')

      const isoLog = await isoAdapter.log(repoPath, 'HEAD')
      const simpleLog = await simpleAdapter.log(repoPath, 'HEAD')

      expect(isoLog.length).toBe(3)
      expect(simpleLog.length).toBe(3)

      // Compare SHAs (order should be same - newest first)
      expect(isoLog.map((c) => c.sha)).toEqual(simpleLog.map((c) => c.sha))

      // Compare messages
      expect(isoLog.map((c) => c.message)).toEqual(simpleLog.map((c) => c.message))

      // Compare timestamps (allow small difference due to execution time)
      for (let i = 0; i < isoLog.length; i++) {
        const timeDiff = Math.abs(isoLog[i]!.timeMs - simpleLog[i]!.timeMs)
        expect(timeDiff).toBeLessThan(1000) // Within 1 second
      }
    })

    it('should respect depth limits identically', async () => {
      // Create 10 commits
      for (let i = 0; i < 10; i++) {
        await createCommit(repoPath, { [`file${i}.txt`]: `content${i}` }, `commit ${i}`)
      }

      const isoLog = await isoAdapter.log(repoPath, 'HEAD', { depth: 5 })
      const simpleLog = await simpleAdapter.log(repoPath, 'HEAD', { depth: 5 })

      expect(isoLog.length).toBe(5)
      expect(simpleLog.length).toBe(5)
      expect(isoLog.map((c) => c.sha)).toEqual(simpleLog.map((c) => c.sha))
    })
  })

  describe('getWorkingTreeStatus', () => {
    it('should return identical status for clean repo', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      const isoStatus = await isoAdapter.getWorkingTreeStatus(repoPath)
      const simpleStatus = await simpleAdapter.getWorkingTreeStatus(repoPath)

      expect(isoStatus.currentBranch).toBe('main')
      expect(simpleStatus.currentBranch).toBe('main')
      expect(isoStatus.staged).toEqual([])
      expect(simpleStatus.staged).toEqual([])
      expect(isoStatus.modified).toEqual([])
      expect(simpleStatus.modified).toEqual([])
      expect(isoStatus.allChangedFiles).toEqual([])
      expect(simpleStatus.allChangedFiles).toEqual([])
    })

    it('should detect staged files identically', async () => {
      await createCommit(repoPath, { 'file1.txt': 'content1' }, 'initial commit')

      // Create and stage a new file
      await createCommit(repoPath, { 'file2.txt': 'content2' }, 'add file2')

      // Modify and stage a file
      await isoAdapter.add(repoPath, 'file2.txt')

      const isoStatus = await isoAdapter.getWorkingTreeStatus(repoPath)
      const simpleStatus = await simpleAdapter.getWorkingTreeStatus(repoPath)

      // Both should show no changes (everything is committed)
      expect(isoStatus.staged).toEqual(simpleStatus.staged)
      expect(isoStatus.modified).toEqual(simpleStatus.modified)
    })
  })

  describe('add / resetIndex', () => {
    it('should stage and unstage files identically', async () => {
      await createCommit(repoPath, { 'file1.txt': 'initial' }, 'initial commit')

      // Modify file with isomorphic-git adapter
      const fs = await import('fs')
      const path = await import('path')
      await fs.promises.writeFile(path.join(repoPath, 'file1.txt'), 'modified')

      // Stage with iso adapter
      await isoAdapter.add(repoPath, 'file1.txt')

      // Check status with both
      const isoStatusStaged = await isoAdapter.getWorkingTreeStatus(repoPath)
      const simpleStatusStaged = await simpleAdapter.getWorkingTreeStatus(repoPath)

      expect(isoStatusStaged.staged).toContain('file1.txt')
      expect(simpleStatusStaged.staged).toContain('file1.txt')

      // Unstage with simple adapter
      await simpleAdapter.resetIndex(repoPath, 'file1.txt')

      // Check status again
      const isoStatusUnstaged = await isoAdapter.getWorkingTreeStatus(repoPath)
      const simpleStatusUnstaged = await simpleAdapter.getWorkingTreeStatus(repoPath)

      expect(isoStatusUnstaged.staged).not.toContain('file1.txt')
      expect(simpleStatusUnstaged.staged).not.toContain('file1.txt')
    })
  })

  describe('commit', () => {
    it('should create commits with same content', async () => {
      await createCommit(repoPath, { 'file1.txt': 'initial' }, 'initial commit')

      // Modify and stage with isomorphic
      const fs = await import('fs')
      const path = await import('path')
      await fs.promises.writeFile(path.join(repoPath, 'file2.txt'), 'new file')
      await isoAdapter.add(repoPath, 'file2.txt')

      // Commit with simple-git
      const sha = await simpleAdapter.commit(repoPath, {
        message: 'Add file2',
        author: { name: 'Test User', email: 'test@example.com' }
      })

      // Read commit with both adapters
      const isoCommit = await isoAdapter.readCommit(repoPath, sha)
      const simpleCommit = await simpleAdapter.readCommit(repoPath, sha)

      expect(isoCommit.message).toBe('Add file2')
      expect(simpleCommit.message).toBe('Add file2')
      expect(isoCommit.author.name).toBe('Test User')
      expect(simpleCommit.author.name).toBe('Test User')
    })
  })

  describe('branch / deleteBranch', () => {
    it('should create and delete branches identically', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')

      // Create branch with isomorphic
      await isoAdapter.branch(repoPath, 'test-branch')

      // List with simple
      const branches1 = await simpleAdapter.listBranches(repoPath)
      expect(branches1).toContain('test-branch')

      // Delete with simple
      await simpleAdapter.deleteBranch(repoPath, 'test-branch')

      // List with isomorphic
      const branches2 = await isoAdapter.listBranches(repoPath)
      expect(branches2).not.toContain('test-branch')
    })
  })

  describe('checkout', () => {
    it('should checkout branches identically', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial commit')
      await createBranch(repoPath, 'feature')

      // Checkout with isomorphic
      await isoAdapter.checkout(repoPath, 'feature')

      // Verify with simple
      const branch1 = await simpleAdapter.currentBranch(repoPath)
      expect(branch1).toBe('feature')

      // Checkout back with simple
      await simpleAdapter.checkout(repoPath, 'main')

      // Verify with isomorphic
      const branch2 = await isoAdapter.currentBranch(repoPath)
      expect(branch2).toBe('main')
    })
  })

  describe('reset', () => {
    it('should perform soft reset identically', async () => {
      const sha1 = await createCommit(repoPath, { 'file1.txt': 'content1' }, 'commit 1')
      await createCommit(repoPath, { 'file2.txt': 'content2' }, 'commit 2')

      // Reset to sha1 with simple-git
      await simpleAdapter.reset(repoPath, { mode: 'soft', ref: sha1 })

      // Verify HEAD moved
      const headSha = await isoAdapter.resolveRef(repoPath, 'HEAD')
      expect(headSha).toBe(sha1)

      // Verify working tree status shows changes are staged
      const status = await isoAdapter.getWorkingTreeStatus(repoPath)
      expect(status.staged).toContain('file2.txt')
    })
  })
})
