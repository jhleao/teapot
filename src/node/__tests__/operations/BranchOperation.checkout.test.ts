/**
 * Tests for branch checkout
 *
 * Checkout is now a simple operation that just calls git checkout.
 * No smart routing, no fetching, no fast-forwarding.
 */

import { execSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetGitAdapter, SimpleGitAdapter } from '../../adapters/git'
import {
  cleanupTestRepo,
  createBranch,
  createCommit,
  createTestRepo
} from '../../adapters/git/__tests__/test-utils'
import { BranchOperation } from '../../operations/BranchOperation'

// Mock the store to avoid electron-store initialization
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null)
  }
}))

describe('BranchOperation.checkout', () => {
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

      const result = await BranchOperation.checkout(repoPath, 'feature')

      expect(result.success).toBe(true)
      expect(await adapter.currentBranch(repoPath)).toBe('feature')
    })

    it('returns error for non-existent branch', async () => {
      const result = await BranchOperation.checkout(repoPath, 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('checks out branch with commits', async () => {
      await createBranch(repoPath, 'feature', true)
      const featureHead = await createCommit(
        repoPath,
        { 'feature.txt': 'feature' },
        'feature commit'
      )

      await adapter.checkout(repoPath, 'main')

      const result = await BranchOperation.checkout(repoPath, 'feature')

      expect(result.success).toBe(true)
      expect(await adapter.currentBranch(repoPath)).toBe('feature')
      expect(await adapter.resolveRef(repoPath, 'HEAD')).toBe(featureHead)
    })
  })

  describe('error handling', () => {
    it('handles dirty working tree gracefully when no conflicts', async () => {
      await createBranch(repoPath, 'feature', false)

      // Create uncommitted change
      execSync('echo "dirty" > dirty.txt', { cwd: repoPath })

      // Should still work for simple checkout (git handles this)
      const result = await BranchOperation.checkout(repoPath, 'feature')

      // Git allows checkout if files don't conflict
      expect(result.success).toBe(true)
    })

    it('returns descriptive error for invalid ref', async () => {
      const result = await BranchOperation.checkout(repoPath, 'definitely-not-a-branch-12345')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
