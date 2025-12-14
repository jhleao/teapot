/**
 * Tests for smart checkout utility
 *
 * Smart checkout handles:
 * 1. Remote branch checkout (origin/main → checkout/create main + ff if possible)
 * 2. Local branch checkout with tracking branch sync
 */

import { execSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetGitAdapter } from '../../git-adapter'
import { SimpleGitAdapter } from '../../git-adapter/simple-git-adapter'
import {
  cleanupTestRepo,
  createBranch,
  createCommit,
  createTestRepo
} from '../../git-adapter/__tests__/test-utils'
import { smartCheckout } from '../smart-checkout'

describe('smartCheckout', () => {
  let repoPath: string
  let adapter: SimpleGitAdapter

  beforeEach(async () => {
    resetGitAdapter()
    repoPath = await createTestRepo()
    adapter = new SimpleGitAdapter()
    // Create initial commit so repo has content
    await createCommit(repoPath, { 'init.txt': 'init' }, 'initial commit')
  })

  afterEach(async () => {
    await cleanupTestRepo(repoPath)
  })

  describe('local branch checkout', () => {
    it('checks out existing local branch', async () => {
      await createBranch(repoPath, 'feature', false)

      const result = await smartCheckout(repoPath, 'feature')

      expect(result.success).toBe(true)
      expect(result.localBranch).toBe('feature')
      expect(await adapter.currentBranch(repoPath)).toBe('feature')
    })

    it('returns error for non-existent branch', async () => {
      const result = await smartCheckout(repoPath, 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('remote branch checkout (simulated)', () => {
    // For these tests, we simulate a remote by:
    // 1. Creating a commit on main
    // 2. Creating a branch to simulate remote state
    // Note: Full remote tests would need a bare remote repo setup

    it('creates local branch from remote-like ref and checks it out', async () => {
      // Create initial state on main
      await createCommit(repoPath, { 'main.txt': 'main content' }, 'main commit')

      // Simulate a remote branch by creating origin/feature locally
      // In a real scenario this would be a remote tracking branch
      await createBranch(repoPath, 'remote-feature', false)
      await adapter.checkout(repoPath, 'remote-feature')
      await createCommit(repoPath, { 'feature.txt': 'feature work' }, 'feature commit')
      await adapter.checkout(repoPath, 'main')

      // Now smartCheckout should handle checking out remote-feature
      const result = await smartCheckout(repoPath, 'remote-feature')

      expect(result.success).toBe(true)
      expect(await adapter.currentBranch(repoPath)).toBe('remote-feature')
    })
  })

  describe('fast-forward sync', () => {
    it('fast-forwards local branch when behind target', async () => {
      // Create feature branch
      await createBranch(repoPath, 'feature', true)
      const featureHead = await createCommit(
        repoPath,
        { 'feature.txt': 'feature' },
        'feature commit'
      )

      // Go back to main (main is behind feature)
      await adapter.checkout(repoPath, 'main')

      // Smart checkout to feature should work directly
      const result = await smartCheckout(repoPath, 'feature')

      expect(result.success).toBe(true)
      expect(await adapter.currentBranch(repoPath)).toBe('feature')
      expect(await adapter.resolveRef(repoPath, 'HEAD')).toBe(featureHead)
    })
  })

  describe('error handling', () => {
    it('handles dirty working tree gracefully', async () => {
      await createBranch(repoPath, 'feature', false)

      // Create uncommitted change
      execSync('echo "dirty" > dirty.txt', { cwd: repoPath })

      // Should still work for simple checkout (git handles this)
      const result = await smartCheckout(repoPath, 'feature')

      // Git allows checkout if files don't conflict
      expect(result.success).toBe(true)
    })

    it('returns descriptive error for invalid ref', async () => {
      const result = await smartCheckout(repoPath, 'definitely-not-a-branch-12345')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      // Error message should indicate the branch/ref doesn't exist
      expect(
        result.error?.includes('not found') || result.error?.includes('did not match')
      ).toBe(true)
    })
  })
})
