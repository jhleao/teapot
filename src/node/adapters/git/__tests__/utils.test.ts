/**
 * Tests for Git Adapter utility functions
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetGitAdapter, SimpleGitAdapter } from '../index'
import { branchExists, canFastForward, findLocalTrunk } from '../utils'
import { cleanupTestRepo, createBranch, createCommit, createTestRepo } from './test-utils'

// Reset git adapter cache between tests to ensure fresh state
beforeEach(() => {
  resetGitAdapter()
})

describe('Git Adapter Utils', () => {
  describe('branchExists', () => {
    let repoPath: string

    beforeEach(async () => {
      repoPath = await createTestRepo()
    })

    afterEach(async () => {
      await cleanupTestRepo(repoPath)
    })

    it('returns true for existing branch', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial')
      await createBranch(repoPath, 'feature')

      expect(await branchExists(repoPath, 'main')).toBe(true)
      expect(await branchExists(repoPath, 'feature')).toBe(true)
    })

    it('returns false for non-existent branch', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial')

      expect(await branchExists(repoPath, 'nonexistent')).toBe(false)
    })
  })

  describe('canFastForward', () => {
    let repoPath: string
    let adapter: SimpleGitAdapter

    beforeEach(async () => {
      repoPath = await createTestRepo()
      adapter = new SimpleGitAdapter()
    })

    afterEach(async () => {
      await cleanupTestRepo(repoPath)
    })

    it('returns true when local is behind remote (can ff)', async () => {
      // Create initial commit
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base')

      // Create feature branch with more commits
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // Go back to main (which is behind feature)
      await adapter.checkout(repoPath, 'main')

      // main can fast-forward to feature
      expect(await canFastForward(repoPath, 'main', 'feature')).toBe(true)
    })

    it('returns true when branches are at same commit', async () => {
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base')
      await createBranch(repoPath, 'feature')

      // Both at same commit - can "ff" (no-op)
      expect(await canFastForward(repoPath, 'main', 'feature')).toBe(true)
    })

    it('returns false when local is ahead of remote (cannot ff)', async () => {
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base')
      await createBranch(repoPath, 'feature')
      await createCommit(repoPath, { 'main.txt': 'main work' }, 'main ahead')

      // main is ahead of feature - cannot ff
      expect(await canFastForward(repoPath, 'main', 'feature')).toBe(false)
    })

    it('returns false when branches have diverged', async () => {
      await createCommit(repoPath, { 'base.txt': 'base' }, 'base')

      // Create feature with its own commit
      await createBranch(repoPath, 'feature', true)
      await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

      // Go back to main and add different commit
      await adapter.checkout(repoPath, 'main')
      await createCommit(repoPath, { 'main.txt': 'main' }, 'main work')

      // Diverged - cannot ff either direction
      expect(await canFastForward(repoPath, 'main', 'feature')).toBe(false)
      expect(await canFastForward(repoPath, 'feature', 'main')).toBe(false)
    })
  })

  describe('findLocalTrunk', () => {
    let repoPath: string

    beforeEach(async () => {
      repoPath = await createTestRepo()
    })

    afterEach(async () => {
      await cleanupTestRepo(repoPath)
    })

    it('returns main when main exists', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial')
      // Test repo uses main as default

      expect(await findLocalTrunk(repoPath)).toBe('main')
    })

    it('returns develop when main/master do not exist but develop does', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial')

      // Rename main to develop - develop is now a recognized trunk branch
      const adapter = new SimpleGitAdapter()
      await adapter.branch(repoPath, 'develop', { checkout: true })
      await adapter.deleteBranch(repoPath, 'main')

      expect(await findLocalTrunk(repoPath)).toBe('develop')
    })

    it('returns null when no trunk branches exist', async () => {
      await createCommit(repoPath, { 'file.txt': 'content' }, 'initial')

      // Rename main to a non-trunk branch
      const adapter = new SimpleGitAdapter()
      await adapter.branch(repoPath, 'feature-branch', { checkout: true })
      await adapter.deleteBranch(repoPath, 'main')

      expect(await findLocalTrunk(repoPath)).toBeNull()
    })
  })
})
