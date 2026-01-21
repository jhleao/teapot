import type { Commit } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildTrunkShaSet, calculateCommitOwnership, isForkPoint } from '../CommitOwnership'

describe('CommitOwnership', () => {
  describe('calculateCommitOwnership', () => {
    it('returns single commit when branch head is directly on trunk', () => {
      // Graph: A (trunk) → B (feature)
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')]
      ])
      const branchHeadIndex = new Map([['A', ['main']]])
      const trunkShas = new Set(['A'])

      const result = calculateCommitOwnership({
        headSha: 'B',
        branchRef: 'feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      expect(result.ownedShas).toEqual(['B'])
      expect(result.baseSha).toBe('A')
    })

    it('includes all branchless commits between branch head and trunk', () => {
      // Graph: A (trunk) → B (no branch) → C (no branch) → D (feature)
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')],
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'C')]
      ])
      const branchHeadIndex = new Map([['A', ['main']]])
      const trunkShas = new Set(['A'])

      const result = calculateCommitOwnership({
        headSha: 'D',
        branchRef: 'feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      expect(result.ownedShas).toEqual(['D', 'C', 'B'])
      expect(result.baseSha).toBe('A')
    })

    it('stops at another branch head (sibling branch scenario)', () => {
      // Graph: A (trunk) → B (branch-1) → C (branch-2)
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')],
        ['C', createCommit('C', 'B')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['B', ['branch-1']]
      ])
      const trunkShas = new Set(['A'])

      const result = calculateCommitOwnership({
        headSha: 'C',
        branchRef: 'branch-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      expect(result.ownedShas).toEqual(['C'])
      expect(result.baseSha).toBe('B')
    })

    it('handles multiple branches at same commit (excludes current branch)', () => {
      // Graph: A (trunk) → B (branch-1, branch-2)
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['B', ['branch-1', 'branch-2']]
      ])
      const trunkShas = new Set(['A'])

      // When calculating for branch-1, it should own B (doesn't stop at itself)
      const result = calculateCommitOwnership({
        headSha: 'B',
        branchRef: 'branch-1',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      expect(result.ownedShas).toEqual(['B'])
      expect(result.baseSha).toBe('A')
    })

    it('handles stacked branches with intermediate branchless commits', () => {
      // Graph: A (trunk) → B → C (stack-1) → D → E (stack-2)
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')],
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'C')],
        ['E', createCommit('E', 'D')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['C', ['stack-1']]
      ])
      const trunkShas = new Set(['A'])

      // stack-2 should own E and D, stopping at stack-1's head (C)
      const result = calculateCommitOwnership({
        headSha: 'E',
        branchRef: 'stack-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      expect(result.ownedShas).toEqual(['E', 'D'])
      expect(result.baseSha).toBe('C')
    })

    it('handles root commit (branch with no parent)', () => {
      // Graph: A (only commit, trunk + feature)
      const commitMap = new Map<string, Commit>([['A', createCommit('A', '')]])
      const branchHeadIndex = new Map([['A', ['main', 'feature']]])
      const trunkShas = new Set(['A'])

      const result = calculateCommitOwnership({
        headSha: 'A',
        branchRef: 'feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // When branch is at root, it owns the root commit
      expect(result.ownedShas).toEqual(['A'])
      expect(result.baseSha).toBe('A')
    })

    it('handles branch forking from middle of another branch', () => {
      // Graph: A (trunk) → B → C (branch-1)
      //                    └→ D (branch-2)
      // B has two non-trunk children (C and D), so it's a fork point
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '', ['B'])],
        ['B', createCommit('B', 'A', ['C', 'D'])], // Fork point: 2 non-trunk children
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'B')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['C', ['branch-1']]
      ])
      const trunkShas = new Set(['A'])

      // branch-2 forks from B (fork point), should own D only, base at B
      const result = calculateCommitOwnership({
        headSha: 'D',
        branchRef: 'branch-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // B is a fork point (has 2 non-trunk children), so D stops there
      // D owns only itself, base is B (the fork point)
      expect(result.ownedShas).toEqual(['D'])
      expect(result.baseSha).toBe('B')
    })

    it('stops at fork point - commit with multiple non-trunk children', () => {
      // Graph: A (trunk) → B (branchless, fork point)
      //                   ↙ ↘
      //                  C    D
      //                  │    │
      //              feature-1  feature-2
      // B has two children (C and D), making it a fork point that no branch owns
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '', ['B'])],
        ['B', createCommit('B', 'A', ['C', 'D'])], // Fork point: 2 non-trunk children
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'B')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['C', ['feature-1']],
        ['D', ['feature-2']]
      ])
      const trunkShas = new Set(['A'])

      // feature-1 should own only C, base at B (fork point)
      const result1 = calculateCommitOwnership({
        headSha: 'C',
        branchRef: 'feature-1',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result1.ownedShas).toEqual(['C'])
      expect(result1.baseSha).toBe('B')

      // feature-2 should own only D, base at B (fork point)
      const result2 = calculateCommitOwnership({
        headSha: 'D',
        branchRef: 'feature-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result2.ownedShas).toEqual(['D'])
      expect(result2.baseSha).toBe('B')
    })

    it('fork point with branchless commits above it - both siblings stop at fork', () => {
      // Graph: A (trunk)
      //        │
      //        B (branchless)
      //        │
      //        C (branchless, fork point)
      //       ↙ ↘
      //      D    E
      //      │    │
      //      F    G
      //      │    │
      //  feature-1  feature-2
      //
      // C is a fork point. Neither branch should own B or C.
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '', ['B'])],
        ['B', createCommit('B', 'A', ['C'])],
        ['C', createCommit('C', 'B', ['D', 'E'])], // Fork point
        ['D', createCommit('D', 'C', ['F'])],
        ['E', createCommit('E', 'C', ['G'])],
        ['F', createCommit('F', 'D')],
        ['G', createCommit('G', 'E')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['F', ['feature-1']],
        ['G', ['feature-2']]
      ])
      const trunkShas = new Set(['A'])

      // feature-1 should own F and D, stopping at C (fork point)
      const result1 = calculateCommitOwnership({
        headSha: 'F',
        branchRef: 'feature-1',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result1.ownedShas).toEqual(['F', 'D'])
      expect(result1.baseSha).toBe('C')

      // feature-2 should own G and E, stopping at C (fork point)
      const result2 = calculateCommitOwnership({
        headSha: 'G',
        branchRef: 'feature-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result2.ownedShas).toEqual(['G', 'E'])
      expect(result2.baseSha).toBe('C')
    })

    it('does not treat as fork point when one child is on trunk', () => {
      // Graph: A (trunk) → B (trunk) → C (trunk)
      //                      ↘
      //                       D (feature)
      // B has two children (C and D) but C is on trunk, so only D is non-trunk.
      // B has only 1 non-trunk child, so it's NOT a fork point.
      // However, B is on trunk itself, so the walk stops at the trunk check first.
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '', ['B'])],
        ['B', createCommit('B', 'A', ['C', 'D'])],
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'B')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['C', ['main']] // C is trunk continuation
      ])
      const trunkShas = new Set(['A', 'B', 'C']) // B and C are on trunk

      const result = calculateCommitOwnership({
        headSha: 'D',
        branchRef: 'feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // D's parent B is on trunk, so walk stops at trunk check (not fork point check)
      expect(result.ownedShas).toEqual(['D'])
      expect(result.baseSha).toBe('B')
    })

    it('handles fork point with 3+ children', () => {
      // Graph: A (trunk) → B (fork point with 3 children)
      //                   ↙ ↓ ↘
      //                  C  D  E
      //                  │  │  │
      //              feat-1 feat-2 feat-3
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '', ['B'])],
        ['B', createCommit('B', 'A', ['C', 'D', 'E'])], // Fork point: 3 non-trunk children
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'B')],
        ['E', createCommit('E', 'B')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['C', ['feat-1']],
        ['D', ['feat-2']],
        ['E', ['feat-3']]
      ])
      const trunkShas = new Set(['A'])

      // All three branches should stop at B (fork point) and only own their single commit
      const result1 = calculateCommitOwnership({
        headSha: 'C',
        branchRef: 'feat-1',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result1.ownedShas).toEqual(['C'])
      expect(result1.baseSha).toBe('B')

      const result2 = calculateCommitOwnership({
        headSha: 'D',
        branchRef: 'feat-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result2.ownedShas).toEqual(['D'])
      expect(result2.baseSha).toBe('B')

      const result3 = calculateCommitOwnership({
        headSha: 'E',
        branchRef: 'feat-3',
        commitMap,
        branchHeadIndex,
        trunkShas
      })
      expect(result3.ownedShas).toEqual(['E'])
      expect(result3.baseSha).toBe('B')
    })

    it('handles missing head commit gracefully', () => {
      const commitMap = new Map<string, Commit>([['A', createCommit('A', '')]])
      const branchHeadIndex = new Map<string, string[]>()
      const trunkShas = new Set<string>()

      const result = calculateCommitOwnership({
        headSha: 'nonexistent',
        branchRef: 'feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // Missing head commit should result in empty owned list
      // baseSha defaults to headSha when nothing is found
      expect(result.ownedShas).toEqual([])
      expect(result.baseSha).toBe('nonexistent')
    })

    it('handles missing commit in middle of chain gracefully', () => {
      // Graph: A -> B -> C (feature), but B is missing from map
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['C', createCommit('C', 'B')] // B is missing
      ])
      const branchHeadIndex = new Map<string, string[]>()
      const trunkShas = new Set(['A'])

      const result = calculateCommitOwnership({
        headSha: 'C',
        branchRef: 'feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // Should own C, stop at missing B, use B (last known parent) as base
      expect(result.ownedShas).toEqual(['C'])
      expect(result.baseSha).toBe('B')
    })

    it('handles detached HEAD scenario (no branch at current commit)', () => {
      // Graph: A (trunk) → B → C (detached HEAD, no branch name)
      // In detached HEAD state, we're at a commit with no branch pointing to it
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')],
        ['C', createCommit('C', 'B')]
      ])
      // branchHeadIndex only has trunk at A, nothing at B or C
      const branchHeadIndex = new Map([['A', ['main']]])
      const trunkShas = new Set(['A'])

      // Even in detached HEAD, we can calculate ownership from the SHA
      // using a synthetic ref name (could be the SHA itself or 'HEAD')
      const result = calculateCommitOwnership({
        headSha: 'C',
        branchRef: 'HEAD', // Detached HEAD uses 'HEAD' as ref
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // Should own B and C (all commits from C back to trunk)
      expect(result.ownedShas).toEqual(['C', 'B'])
      expect(result.baseSha).toBe('A')
    })

    it('handles orphan branch (no common ancestor with trunk)', () => {
      // Orphan branch created with git checkout --orphan
      // Has no parent commits at all
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')], // trunk root
        ['X', createCommit('X', '')], // orphan branch root (no parent)
        ['Y', createCommit('Y', 'X')] // orphan branch commit
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['Y', ['orphan-feature']]
      ])
      const trunkShas = new Set(['A'])

      const result = calculateCommitOwnership({
        headSha: 'Y',
        branchRef: 'orphan-feature',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // Should own Y and X (walks back to root of orphan branch)
      // Base is X (the root commit itself since it has no parent)
      expect(result.ownedShas).toEqual(['Y', 'X'])
      expect(result.baseSha).toBe('X')
    })
  })

  describe('isForkPoint', () => {
    it('returns true when commit has 2+ non-trunk children', () => {
      const commit = createCommit('B', 'A', ['C', 'D'])
      const trunkShas = new Set(['A'])

      expect(isForkPoint(commit, trunkShas)).toBe(true)
    })

    it('returns false when commit has only 1 non-trunk child', () => {
      const commit = createCommit('B', 'A', ['C'])
      const trunkShas = new Set(['A'])

      expect(isForkPoint(commit, trunkShas)).toBe(false)
    })

    it('returns false when commit has no children', () => {
      const commit = createCommit('B', 'A', [])
      const trunkShas = new Set(['A'])

      expect(isForkPoint(commit, trunkShas)).toBe(false)
    })

    it('excludes trunk children from fork point calculation', () => {
      // B has 2 children but one (C) is on trunk
      const commit = createCommit('B', 'A', ['C', 'D'])
      const trunkShas = new Set(['A', 'C']) // C is on trunk

      // Only D is non-trunk, so B is NOT a fork point
      expect(isForkPoint(commit, trunkShas)).toBe(false)
    })

    it('returns true for 3+ non-trunk children', () => {
      const commit = createCommit('B', 'A', ['C', 'D', 'E'])
      const trunkShas = new Set(['A'])

      expect(isForkPoint(commit, trunkShas)).toBe(true)
    })
  })

  describe('buildTrunkShaSet', () => {
    it('builds set of all trunk commits', () => {
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')],
        ['C', createCommit('C', 'B')]
      ])

      const result = buildTrunkShaSet('C', commitMap)

      expect(result).toEqual(new Set(['A', 'B', 'C']))
    })

    it('returns empty set for undefined trunk head', () => {
      const commitMap = new Map<string, Commit>()

      const result = buildTrunkShaSet(undefined, commitMap)

      expect(result).toEqual(new Set())
    })

    it('handles missing commits in chain gracefully', () => {
      const commitMap = new Map<string, Commit>([
        ['C', createCommit('C', 'B')] // B is missing from map
      ])

      const result = buildTrunkShaSet('C', commitMap)

      // Only includes C - stops when B is not found (handles shallow clones)
      expect(result).toEqual(new Set(['C']))
    })

    it('returns empty set when trunk head is missing from map', () => {
      const commitMap = new Map<string, Commit>([['A', createCommit('A', '')]])

      const result = buildTrunkShaSet('nonexistent', commitMap)

      // Trunk head doesn't exist in map, return empty set
      expect(result).toEqual(new Set())
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createCommit(sha: string, parentSha: string, childrenSha: string[] = []): Commit {
  return {
    sha,
    parentSha,
    childrenSha,
    message: `Commit ${sha}`,
    timeMs: Date.now()
  }
}
