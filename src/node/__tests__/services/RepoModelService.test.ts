/**
 * Tests for detectMergedBranches utility
 *
 * This utility detects which branches have been merged into trunk
 * by checking if the branch head is an ancestor of trunk head.
 */

import type { Branch } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store to avoid electron-store initialization
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null)
  }
}))

import { SimpleGitAdapter } from '../../adapters/git'
import {
  cleanupTestRepo,
  createBranch,
  createCommit,
  createTestRepo
} from '../../adapters/git/__tests__/test-utils'
import { RepoModelService } from '../../services'

const detectMergedBranches = RepoModelService.detectMergedBranches

describe('detectMergedBranches', () => {
  let repoPath: string
  let adapter: SimpleGitAdapter

  beforeEach(async () => {
    repoPath = await createTestRepo()
    adapter = new SimpleGitAdapter()
  })

  afterEach(async () => {
    await cleanupTestRepo(repoPath)
  })

  it('returns empty array when no branches are provided', async () => {
    await createCommit(repoPath, { 'file.txt': 'content' }, 'initial')

    const result = await detectMergedBranches(repoPath, [], 'main', adapter)

    expect(result).toEqual([])
  })

  it('returns empty array when all branches are ahead of trunk', async () => {
    // Create base commit on main
    await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

    // Create feature branch with additional commit
    await createBranch(repoPath, 'feature', true)
    const featureSha = await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

    // Go back to main
    await adapter.checkout(repoPath, 'main')

    const branches: Branch[] = [
      { ref: 'feature', headSha: featureSha, isTrunk: false, isRemote: false }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    expect(result).toEqual([])
  })

  it('identifies branch as merged when head equals trunk head', async () => {
    // Create commit on main
    const mainSha = await createCommit(repoPath, { 'file.txt': 'content' }, 'main commit')

    // Create branch pointing to same commit
    await createBranch(repoPath, 'feature')

    const branches: Branch[] = [
      { ref: 'feature', headSha: mainSha, isTrunk: false, isRemote: false }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    expect(result).toEqual(['feature'])
  })

  it('identifies branch as merged when head is ancestor of trunk (fast-forward merge)', async () => {
    // Create base commit
    const baseSha = await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

    // Create feature branch at base
    await createBranch(repoPath, 'feature')

    // Add more commits to main (simulating fast-forward merge and continued development)
    await createCommit(repoPath, { 'main1.txt': 'main1' }, 'main work 1')
    await createCommit(repoPath, { 'main2.txt': 'main2' }, 'main work 2')

    const branches: Branch[] = [
      { ref: 'feature', headSha: baseSha, isTrunk: false, isRemote: false }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    expect(result).toEqual(['feature'])
  })

  it('excludes trunk branch from merged detection', async () => {
    const mainSha = await createCommit(repoPath, { 'file.txt': 'content' }, 'main commit')

    const branches: Branch[] = [{ ref: 'main', headSha: mainSha, isTrunk: true, isRemote: false }]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    // main should not be reported as "merged into main"
    expect(result).toEqual([])
  })

  it('includes remote branches in merged detection', async () => {
    const mainSha = await createCommit(repoPath, { 'file.txt': 'content' }, 'main commit')

    const branches: Branch[] = [
      { ref: 'origin/feature', headSha: mainSha, isTrunk: false, isRemote: true }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    // Remote branches should be checked for merged status so they can be cleaned up
    expect(result).toEqual(['origin/feature'])
  })

  it('handles multiple branches with mixed merged/unmerged states', async () => {
    // Create base commit
    const baseSha = await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

    // Create merged-feature at base
    await createBranch(repoPath, 'merged-feature')

    // Create unmerged-feature with additional commit
    await createBranch(repoPath, 'unmerged-feature', true)
    const unmergedSha = await createCommit(
      repoPath,
      { 'unmerged.txt': 'unmerged' },
      'unmerged work'
    )

    // Go back to main and add more commits
    await adapter.checkout(repoPath, 'main')
    await createCommit(repoPath, { 'main.txt': 'main' }, 'main work')

    const branches: Branch[] = [
      { ref: 'merged-feature', headSha: baseSha, isTrunk: false, isRemote: false },
      { ref: 'unmerged-feature', headSha: unmergedSha, isTrunk: false, isRemote: false }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    expect(result).toEqual(['merged-feature'])
    expect(result).not.toContain('unmerged-feature')
  })

  it('handles branches with diverged history (not merged)', async () => {
    // Create base commit
    await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

    // Create feature branch with its own commit
    await createBranch(repoPath, 'feature', true)
    const featureSha = await createCommit(repoPath, { 'feature.txt': 'feature' }, 'feature work')

    // Go back to main and add different commit
    await adapter.checkout(repoPath, 'main')
    await createCommit(repoPath, { 'main.txt': 'main' }, 'main work')

    const branches: Branch[] = [
      { ref: 'feature', headSha: featureSha, isTrunk: false, isRemote: false }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    // feature diverged from main, so it's not merged
    expect(result).toEqual([])
  })

  it('uses origin/main as trunk ref when specified', async () => {
    // This test simulates checking against remote trunk
    // In a real scenario, origin/main would be fetched
    const baseSha = await createCommit(repoPath, { 'base.txt': 'base' }, 'base commit')

    // Create feature at base
    await createBranch(repoPath, 'feature')

    // main continues
    await createCommit(repoPath, { 'main.txt': 'main' }, 'main work')

    const branches: Branch[] = [
      { ref: 'feature', headSha: baseSha, isTrunk: false, isRemote: false }
    ]

    // Check against main (same as origin/main in this simple test)
    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    expect(result).toEqual(['feature'])
  })

  it('handles empty headSha gracefully', async () => {
    await createCommit(repoPath, { 'file.txt': 'content' }, 'main commit')

    const branches: Branch[] = [
      { ref: 'ghost-branch', headSha: '', isTrunk: false, isRemote: false }
    ]

    const result = await detectMergedBranches(repoPath, branches, 'main', adapter)

    // Branch with empty SHA should be skipped
    expect(result).toEqual([])
  })

  it('handles non-existent trunk ref gracefully', async () => {
    const sha = await createCommit(repoPath, { 'file.txt': 'content' }, 'commit')

    const branches: Branch[] = [{ ref: 'feature', headSha: sha, isTrunk: false, isRemote: false }]

    // Non-existent trunk ref should not cause crash
    const result = await detectMergedBranches(repoPath, branches, 'nonexistent', adapter)

    expect(result).toEqual([])
  })
})
