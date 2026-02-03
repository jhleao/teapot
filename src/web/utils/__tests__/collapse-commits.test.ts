import type { UiBranch, UiCommit } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { canHideCommit, computeCollapsibleBranches } from '../collapse-commits.js'

// Helper to create a minimal UiCommit for testing
function createCommit(
  sha: string,
  branches: UiBranch[] = [],
  spinoffs: UiCommit['spinoffs'] = []
): UiCommit {
  return {
    sha,
    name: `Commit ${sha}`,
    timestampMs: Date.now(),
    spinoffs,
    rebaseStatus: null,
    isCurrent: false,
    branches
  }
}

// Helper to create a minimal UiBranch for testing
function createBranch(name: string, ownedCommitShas?: string[]): UiBranch {
  return {
    name,
    isCurrent: false,
    isRemote: false,
    isTrunk: false,
    ownedCommitShas,
    canRename: true,
    canDelete: true,
    canSquash: true,
    canCreateWorktree: true
  }
}

describe('canHideCommit', () => {
  it('returns true for a commit with no spinoffs', () => {
    const commit = createCommit('abc123')
    const commitBySha = new Map([['abc123', commit]])

    expect(canHideCommit('abc123', commitBySha)).toBe(true)
  })

  it('returns false for a commit with spinoffs (fork point)', () => {
    const spinoffCommit = createCommit('spinoff1')
    const forkPointCommit = createCommit(
      'fork123',
      [],
      [
        {
          commits: [spinoffCommit],
          isTrunk: false,
          canRebaseToTrunk: false,
          isDirectlyOffTrunk: false
        }
      ]
    )
    const commitBySha = new Map([['fork123', forkPointCommit]])

    expect(canHideCommit('fork123', commitBySha)).toBe(false)
  })

  it('returns false when commit is not in the map (fail-safe)', () => {
    const commitBySha = new Map<string, UiCommit>()

    expect(canHideCommit('nonexistent', commitBySha)).toBe(false)
  })

  it('returns true for commit with empty spinoffs array', () => {
    const commit = createCommit('abc123', [], [])
    const commitBySha = new Map([['abc123', commit]])

    expect(canHideCommit('abc123', commitBySha)).toBe(true)
  })
})

describe('computeCollapsibleBranches', () => {
  it('returns empty map when no branches have multiple owned commits', () => {
    const commit = createCommit('head', [createBranch('feature', ['head'])])
    const commitBySha = new Map([['head', commit]])

    const result = computeCollapsibleBranches([commit], commitBySha)

    expect(result.size).toBe(0)
  })

  it('returns branch info when branch owns multiple hideable commits', () => {
    const commit1 = createCommit('commit1')
    const commit2 = createCommit('commit2')
    const headCommit = createCommit('head', [
      createBranch('feature', ['head', 'commit1', 'commit2'])
    ])

    const commitBySha = new Map([
      ['head', headCommit],
      ['commit1', commit1],
      ['commit2', commit2]
    ])

    const result = computeCollapsibleBranches([headCommit, commit1, commit2], commitBySha)

    expect(result.size).toBe(1)
    expect(result.get('feature')?.hideableCount).toBe(2) // commit1 and commit2
  })

  it('excludes fork points from hideable count', () => {
    // Stack structure:
    //   head (feature branch)
    //     |
    //   forkPoint (has spinoff) <- should NOT be counted as hideable
    //     |
    //   commit1 <- should be counted as hideable

    const spinoffCommit = createCommit('spinoff1')
    const commit1 = createCommit('commit1')
    const forkPoint = createCommit(
      'forkPoint',
      [],
      [
        {
          commits: [spinoffCommit],
          isTrunk: false,
          canRebaseToTrunk: false,
          isDirectlyOffTrunk: false
        }
      ]
    )
    const headCommit = createCommit('head', [
      createBranch('feature', ['head', 'forkPoint', 'commit1'])
    ])

    const commitBySha = new Map([
      ['head', headCommit],
      ['forkPoint', forkPoint],
      ['commit1', commit1]
    ])

    const result = computeCollapsibleBranches([headCommit, forkPoint, commit1], commitBySha)

    expect(result.size).toBe(1)
    expect(result.get('feature')?.hideableCount).toBe(1) // Only commit1, not forkPoint
  })

  it('returns empty map when all owned commits are fork points', () => {
    // Stack where ALL owned commits (except head) have spinoffs
    const spinoff1 = createCommit('spinoff1')
    const spinoff2 = createCommit('spinoff2')
    const fork1 = createCommit(
      'fork1',
      [],
      [{ commits: [spinoff1], isTrunk: false, canRebaseToTrunk: false, isDirectlyOffTrunk: false }]
    )
    const fork2 = createCommit(
      'fork2',
      [],
      [{ commits: [spinoff2], isTrunk: false, canRebaseToTrunk: false, isDirectlyOffTrunk: false }]
    )
    const headCommit = createCommit('head', [createBranch('feature', ['head', 'fork1', 'fork2'])])

    const commitBySha = new Map([
      ['head', headCommit],
      ['fork1', fork1],
      ['fork2', fork2]
    ])

    const result = computeCollapsibleBranches([headCommit, fork1, fork2], commitBySha)

    // No hideable commits = branch is not collapsible
    expect(result.size).toBe(0)
  })

  it('excludes commits not found in map from hideable count (fail-safe)', () => {
    // ownedCommitShas references a commit that doesn't exist in commitBySha
    const headCommit = createCommit('head', [
      createBranch('feature', ['head', 'missing1', 'commit1'])
    ])
    const commit1 = createCommit('commit1')

    const commitBySha = new Map([
      ['head', headCommit],
      ['commit1', commit1]
      // 'missing1' is NOT in the map
    ])

    const result = computeCollapsibleBranches([headCommit, commit1], commitBySha)

    expect(result.size).toBe(1)
    // Only commit1 is hideable; missing1 is not hideable (fail-safe)
    expect(result.get('feature')?.hideableCount).toBe(1)
  })
})

describe('integration: collapse with complex stack structures', () => {
  it('preserves visibility of fork points in a complex stack', () => {
    // Stack structure:
    //   head [feature]
    //     |
    //   forkPoint ─── X ─── Y [other-feature]
    //     |
    //   commit1
    //
    // Expected: forkPoint should NOT be hideable because it has spinoffs

    const commitY = createCommit('Y', [createBranch('other-feature', ['Y', 'X'])])
    const commitX = createCommit('X')
    const commit1 = createCommit('commit1')
    const forkPoint = createCommit(
      'forkPoint',
      [],
      [
        {
          commits: [commitY, commitX],
          isTrunk: false,
          canRebaseToTrunk: false,
          isDirectlyOffTrunk: false
        }
      ]
    )
    const head = createCommit('head', [createBranch('feature', ['head', 'forkPoint', 'commit1'])])

    const commitBySha = new Map([
      ['head', head],
      ['forkPoint', forkPoint],
      ['commit1', commit1],
      ['X', commitX],
      ['Y', commitY]
    ])

    const collapsibleBranches = computeCollapsibleBranches([head, forkPoint, commit1], commitBySha)

    // Only commit1 should be hideable (forkPoint has spinoffs)
    expect(collapsibleBranches.get('feature')?.hideableCount).toBe(1)
  })

  it('handles multiple fork points in a single branch', () => {
    // Stack with multiple fork points:
    //   head [feature]
    //     |
    //   fork1 ─── spinoff1
    //     |
    //   commit1
    //     |
    //   fork2 ─── spinoff2
    //     |
    //   commit2

    const spinoff1 = createCommit('spinoff1')
    const spinoff2 = createCommit('spinoff2')
    const commit1 = createCommit('commit1')
    const commit2 = createCommit('commit2')
    const fork1 = createCommit(
      'fork1',
      [],
      [{ commits: [spinoff1], isTrunk: false, canRebaseToTrunk: false, isDirectlyOffTrunk: false }]
    )
    const fork2 = createCommit(
      'fork2',
      [],
      [{ commits: [spinoff2], isTrunk: false, canRebaseToTrunk: false, isDirectlyOffTrunk: false }]
    )
    const head = createCommit('head', [
      createBranch('feature', ['head', 'fork1', 'commit1', 'fork2', 'commit2'])
    ])

    const commitBySha = new Map([
      ['head', head],
      ['fork1', fork1],
      ['commit1', commit1],
      ['fork2', fork2],
      ['commit2', commit2]
    ])

    const collapsibleBranches = computeCollapsibleBranches(
      [head, fork1, commit1, fork2, commit2],
      commitBySha
    )

    // Only commit1 and commit2 are hideable
    expect(collapsibleBranches.get('feature')?.hideableCount).toBe(2)
  })
})
