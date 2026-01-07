import type { Commit } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildTrunkShaSet, calculateCommitOwnership } from '../CommitOwnership'

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
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')],
        ['B', createCommit('B', 'A')],
        ['C', createCommit('C', 'B')],
        ['D', createCommit('D', 'B')]
      ])
      const branchHeadIndex = new Map([
        ['A', ['main']],
        ['C', ['branch-1']]
      ])
      const trunkShas = new Set(['A'])

      // branch-2 forks from B (branchless), should own D only, base at A (trunk)
      const result = calculateCommitOwnership({
        headSha: 'D',
        branchRef: 'branch-2',
        commitMap,
        branchHeadIndex,
        trunkShas
      })

      // D's parent is B, which is branchless, so D owns B too
      expect(result.ownedShas).toEqual(['D', 'B'])
      expect(result.baseSha).toBe('A')
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
      const commitMap = new Map<string, Commit>([
        ['A', createCommit('A', '')]
      ])

      const result = buildTrunkShaSet('nonexistent', commitMap)

      // Trunk head doesn't exist in map, return empty set
      expect(result).toEqual(new Set())
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createCommit(sha: string, parentSha: string): Commit {
  return {
    sha,
    parentSha,
    childrenSha: [],
    message: `Commit ${sha}`,
    timeMs: Date.now()
  }
}
