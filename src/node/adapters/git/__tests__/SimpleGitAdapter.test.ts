/**
 * SimpleGitAdapter Tests
 *
 * Tests for the simple-git adapter implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SimpleGitAdapter } from '../SimpleGitAdapter'
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

  describe('patch operations', () => {
    it('formats and applies patch successfully', async () => {
      await createCommit(repoPath, { 'file.txt': 'base' }, 'initial commit')
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'file.txt': 'feature change' }, 'feature commit')

      await adapter.checkout(repoPath, 'main')

      const patch = await adapter.formatPatch(repoPath, 'main..feature')
      expect(await adapter.isDiffEmpty(repoPath, 'HEAD')).toBe(true)

      const applyResult = await adapter.applyPatch(repoPath, patch)
      expect(applyResult.success).toBe(true)

      const status = await adapter.getWorkingTreeStatus(repoPath)
      expect(status.modified).toContain('file.txt')
      expect(await adapter.isDiffEmpty(repoPath, 'HEAD')).toBe(false)
    })

    it('returns conflicts when patch cannot be applied cleanly', async () => {
      await createCommit(repoPath, { 'file.txt': 'base' }, 'base commit')

      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'file.txt': 'feature change' }, 'feature commit')

      await adapter.checkout(repoPath, 'main')
      await createCommit(repoPath, { 'file.txt': 'main change' }, 'main commit')

      const patch = await adapter.formatPatch(repoPath, 'main..feature')
      const applyResult = await adapter.applyPatch(repoPath, patch)

      expect(applyResult.success).toBe(false)
      expect(applyResult.conflicts?.some((c) => c.includes('file.txt'))).toBe(true)
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

  describe('isAncestor', () => {
    it('returns true when commit is a strict ancestor of ref', async () => {
      // Create linear history: A -> B -> C
      const commitA = await createCommit(repoPath, { 'a.txt': 'a' }, 'commit A')
      const commitB = await createCommit(repoPath, { 'b.txt': 'b' }, 'commit B')
      const commitC = await createCommit(repoPath, { 'c.txt': 'c' }, 'commit C')

      // A is ancestor of C
      expect(await adapter.isAncestor(repoPath, commitA, commitC)).toBe(true)
      // A is ancestor of B
      expect(await adapter.isAncestor(repoPath, commitA, commitB)).toBe(true)
      // B is ancestor of C
      expect(await adapter.isAncestor(repoPath, commitB, commitC)).toBe(true)
    })

    it('returns true when commit equals ref (same commit is considered ancestor of itself)', async () => {
      const commitA = await createCommit(repoPath, { 'a.txt': 'a' }, 'commit A')

      // Git considers a commit to be an ancestor of itself
      expect(await adapter.isAncestor(repoPath, commitA, commitA)).toBe(true)
    })

    it('returns false when commit is not an ancestor of ref', async () => {
      // Create base commit
      const base = await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

      // Create feature branch with its own commit
      await createBranch(repoPath, 'feature', true)
      const featureCommit = await createCommit(
        repoPath,
        { 'feature.txt': 'feature' },
        'feature commit'
      )

      // Go back to main and add commit
      await adapter.checkout(repoPath, 'main')
      const mainCommit = await createCommit(repoPath, { 'main.txt': 'main' }, 'main commit')

      // featureCommit is NOT an ancestor of mainCommit (they diverged)
      expect(await adapter.isAncestor(repoPath, featureCommit, mainCommit)).toBe(false)
      // mainCommit is NOT an ancestor of featureCommit
      expect(await adapter.isAncestor(repoPath, mainCommit, featureCommit)).toBe(false)
      // But base is ancestor of both
      expect(await adapter.isAncestor(repoPath, base, mainCommit)).toBe(true)
      expect(await adapter.isAncestor(repoPath, base, featureCommit)).toBe(true)
    })

    it('returns false when descendant ref is checked against ancestor (wrong direction)', async () => {
      const commitA = await createCommit(repoPath, { 'a.txt': 'a' }, 'commit A')
      const commitB = await createCommit(repoPath, { 'b.txt': 'b' }, 'commit B')

      // B is NOT an ancestor of A (B came after A)
      expect(await adapter.isAncestor(repoPath, commitB, commitA)).toBe(false)
    })

    it('handles branch refs correctly', async () => {
      // Create main with one commit
      const mainBase = await createCommit(repoPath, { 'main.txt': 'main' }, 'main commit')

      // Create feature branch from main
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature commit')

      // mainBase should be ancestor of feature branch
      expect(await adapter.isAncestor(repoPath, mainBase, 'feature')).toBe(true)
      // main branch should be ancestor of feature (since feature branched from main)
      expect(await adapter.isAncestor(repoPath, 'main', 'feature')).toBe(true)
    })

    it('returns false for non-existent refs without throwing', async () => {
      await createCommit(repoPath, { 'a.txt': 'a' }, 'commit A')

      // Non-existent commit should return false, not throw
      expect(await adapter.isAncestor(repoPath, 'nonexistent123', 'HEAD')).toBe(false)
      expect(await adapter.isAncestor(repoPath, 'HEAD', 'nonexistent456')).toBe(false)
    })

    it('works with HEAD ref', async () => {
      const commitA = await createCommit(repoPath, { 'a.txt': 'a' }, 'commit A')
      await createCommit(repoPath, { 'b.txt': 'b' }, 'commit B')

      // A should be ancestor of HEAD (which points to B)
      expect(await adapter.isAncestor(repoPath, commitA, 'HEAD')).toBe(true)
      // HEAD should NOT be ancestor of A
      expect(await adapter.isAncestor(repoPath, 'HEAD', commitA)).toBe(false)
    })

    it('detects merged branch scenario correctly', async () => {
      // Simulate: feature branch was merged into main via fast-forward
      // This is the core use case for detecting merged branches

      // Create feature branch
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')
      await createBranch(repoPath, 'feature', true)
      const featureTip = await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // "Merge" by fast-forwarding main to feature tip
      await adapter.checkout(repoPath, 'main')
      await adapter.reset(repoPath, { mode: 'hard', ref: featureTip })

      // Now main and feature point to the same commit
      // feature's tip should be ancestor of (or equal to) main
      expect(await adapter.isAncestor(repoPath, 'feature', 'main')).toBe(true)
      expect(await adapter.isAncestor(repoPath, featureTip, 'main')).toBe(true)
    })

    it('detects non-merged branch scenario correctly', async () => {
      // Feature branch has commits that are NOT on main
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

      // Create feature branch with work
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // Go back to main (which is behind feature)
      await adapter.checkout(repoPath, 'main')

      // feature is NOT an ancestor of main (feature is ahead)
      expect(await adapter.isAncestor(repoPath, 'feature', 'main')).toBe(false)
      // But main IS an ancestor of feature
      expect(await adapter.isAncestor(repoPath, 'main', 'feature')).toBe(true)
    })
  })

  describe('merge', () => {
    it('performs fast-forward merge when possible', async () => {
      // Create initial commit on main
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

      // Create feature branch with additional commit
      await createBranch(repoPath, 'feature', true)
      const featureTip = await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // Go back to main (behind feature)
      await adapter.checkout(repoPath, 'main')

      // Merge feature into main
      const result = await adapter.merge(repoPath, 'feature', { ffOnly: true })

      expect(result.success).toBe(true)
      expect(result.fastForward).toBe(true)
      expect(result.error).toBeUndefined()

      // Verify main is now at feature tip
      const mainHead = await adapter.resolveRef(repoPath, 'main')
      expect(mainHead).toBe(featureTip)
    })

    it('returns already up to date when no merge needed', async () => {
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

      // Create feature branch at same commit as main
      await createBranch(repoPath, 'feature')

      // Try to merge feature (which is at same commit)
      const result = await adapter.merge(repoPath, 'feature', { ffOnly: true })

      expect(result.success).toBe(true)
      expect(result.alreadyUpToDate).toBe(true)
    })

    it('fails with ffOnly when branches have diverged', async () => {
      // Create base commit
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

      // Create feature branch with its own commit
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // Go back to main and add a different commit
      await adapter.checkout(repoPath, 'main')
      await createCommit(repoPath, { 'main.txt': 'main' }, 'main work')

      // Try to ff-only merge (should fail)
      const result = await adapter.merge(repoPath, 'feature', { ffOnly: true })

      expect(result.success).toBe(false)
      expect(result.fastForward).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('fast-forward')
    })

    it('merges without ffOnly option (regular merge)', async () => {
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

      // Create feature branch with additional commit
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // Go back to main
      await adapter.checkout(repoPath, 'main')

      // Merge without ffOnly (still does ff when possible)
      const result = await adapter.merge(repoPath, 'feature')

      expect(result.success).toBe(true)
    })
  })
})
