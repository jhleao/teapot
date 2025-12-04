import type { Branch, Commit, StackNodeState } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  buildBranchHeadIndex,
  computeStackDepth,
  countCommitsInRange,
  countStackNodes,
  findDirectChildBranches,
  findNodeByBranch,
  findNodeInTree,
  flattenStack,
  getCommitsInRange,
  getStackBranches,
  walkCommitHistory,
  walkStackNodes
} from '../stack-traversal'

describe('stack-traversal', () => {
  describe('walkStackNodes', () => {
    it('visits all nodes in depth-first order', () => {
      const root = createStackNode('root', [
        createStackNode('child1', [createStackNode('grandchild1', [])]),
        createStackNode('child2', [])
      ])

      const visited: string[] = []
      walkStackNodes(root, (node) => {
        visited.push(node.branch)
      })

      expect(visited).toEqual(['root', 'child1', 'grandchild1', 'child2'])
    })

    it('passes depth to visitor', () => {
      const root = createStackNode('root', [
        createStackNode('child1', [createStackNode('grandchild1', [])])
      ])

      const depths: number[] = []
      walkStackNodes(root, (_node, depth) => {
        depths.push(depth)
      })

      expect(depths).toEqual([0, 1, 2])
    })

    it('handles single node', () => {
      const root = createStackNode('alone', [])

      const visited: string[] = []
      walkStackNodes(root, (node) => {
        visited.push(node.branch)
      })

      expect(visited).toEqual(['alone'])
    })
  })

  describe('findNodeByBranch', () => {
    it('finds node in intent targets', () => {
      const node = createStackNode('feature-1', [createStackNode('feature-2', [])])
      const intent = createIntent([{ node, targetBaseSha: 'base' }])

      const found = findNodeByBranch(intent, 'feature-2')
      expect(found?.branch).toBe('feature-2')
    })

    it('returns null when branch not found', () => {
      const node = createStackNode('feature-1', [])
      const intent = createIntent([{ node, targetBaseSha: 'base' }])

      const found = findNodeByBranch(intent, 'not-exists')
      expect(found).toBeNull()
    })

    it('searches across multiple targets', () => {
      const node1 = createStackNode('feature-1', [])
      const node2 = createStackNode('feature-2', [createStackNode('feature-3', [])])
      const intent = createIntent([
        { node: node1, targetBaseSha: 'base1' },
        { node: node2, targetBaseSha: 'base2' }
      ])

      expect(findNodeByBranch(intent, 'feature-3')?.branch).toBe('feature-3')
    })
  })

  describe('findNodeInTree', () => {
    it('finds root node', () => {
      const root = createStackNode('root', [])
      expect(findNodeInTree(root, 'root')?.branch).toBe('root')
    })

    it('finds nested node', () => {
      const root = createStackNode('root', [
        createStackNode('child', [createStackNode('grandchild', [])])
      ])
      expect(findNodeInTree(root, 'grandchild')?.branch).toBe('grandchild')
    })

    it('returns null for missing branch', () => {
      const root = createStackNode('root', [])
      expect(findNodeInTree(root, 'missing')).toBeNull()
    })
  })

  describe('flattenStack', () => {
    it('returns all nodes in depth-first order', () => {
      const root = createStackNode('root', [
        createStackNode('child1', []),
        createStackNode('child2', [createStackNode('grandchild', [])])
      ])

      const flat = flattenStack(root)
      expect(flat.map((n) => n.branch)).toEqual(['root', 'child1', 'child2', 'grandchild'])
    })
  })

  describe('computeStackDepth', () => {
    it('returns 1 for single node', () => {
      const root = createStackNode('root', [])
      expect(computeStackDepth(root)).toBe(1)
    })

    it('returns correct depth for nested tree', () => {
      const root = createStackNode('root', [
        createStackNode('child1', [createStackNode('grandchild', [createStackNode('great', [])])]),
        createStackNode('child2', [])
      ])
      expect(computeStackDepth(root)).toBe(4)
    })
  })

  describe('countStackNodes', () => {
    it('counts all nodes', () => {
      const root = createStackNode('root', [
        createStackNode('child1', [createStackNode('grandchild', [])]),
        createStackNode('child2', [])
      ])
      expect(countStackNodes(root)).toBe(4)
    })
  })

  describe('getStackBranches', () => {
    it('returns all branch names', () => {
      const root = createStackNode('feature-1', [
        createStackNode('feature-2', []),
        createStackNode('feature-3', [])
      ])

      const branches = getStackBranches(root)
      expect(branches).toEqual(['feature-1', 'feature-2', 'feature-3'])
    })
  })

  describe('buildBranchHeadIndex', () => {
    it('maps SHAs to branch names', () => {
      const branches: Branch[] = [
        createBranch('main', 'sha1'),
        createBranch('feature', 'sha2'),
        createBranch('origin/main', 'sha1')
      ]

      const index = buildBranchHeadIndex(branches)

      expect(index.get('sha1')).toEqual(['main', 'origin/main'])
      expect(index.get('sha2')).toEqual(['feature'])
      expect(index.get('sha3')).toBeUndefined()
    })

    it('handles branches with empty headSha', () => {
      const branches: Branch[] = [createBranch('broken', '')]

      const index = buildBranchHeadIndex(branches)
      expect(index.size).toBe(0)
    })
  })

  describe('findDirectChildBranches', () => {
    it('finds branches whose head parent is the given SHA', () => {
      const commits: Commit[] = [
        createCommit('parent', ''),
        createCommit('child1', 'parent'),
        createCommit('child2', 'parent'),
        createCommit('grandchild', 'child1')
      ]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const branches: Branch[] = [
        createBranch('main', 'parent'),
        createBranch('feature-1', 'child1'),
        createBranch('feature-2', 'child2'),
        createBranch('feature-3', 'grandchild')
      ]

      const children = findDirectChildBranches(branches, commitMap, 'parent')

      expect(children.map((b) => b.ref)).toEqual(['feature-1', 'feature-2'])
    })

    it('excludes remote branches by default', () => {
      const commits: Commit[] = [createCommit('parent', ''), createCommit('child', 'parent')]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const branches: Branch[] = [
        createBranch('main', 'parent'),
        createBranch('origin/feature', 'child', { isRemote: true })
      ]

      const children = findDirectChildBranches(branches, commitMap, 'parent')
      expect(children.length).toBe(0)
    })

    it('excludes trunk branches by default', () => {
      const commits: Commit[] = [createCommit('parent', ''), createCommit('main-next', 'parent')]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const branches: Branch[] = [createBranch('main', 'main-next', { isTrunk: true })]

      const children = findDirectChildBranches(branches, commitMap, 'parent')
      expect(children.length).toBe(0)
    })
  })

  describe('walkCommitHistory', () => {
    it('walks backwards through commit history', () => {
      const commits: Commit[] = [
        createCommit('c3', 'c2'),
        createCommit('c2', 'c1'),
        createCommit('c1', '')
      ]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const visited = walkCommitHistory('c3', commitMap, () => false)

      expect(visited).toEqual(['c3', 'c2', 'c1'])
    })

    it('stops when condition is met', () => {
      const commits: Commit[] = [
        createCommit('c3', 'c2'),
        createCommit('c2', 'c1'),
        createCommit('c1', '')
      ]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const visited = walkCommitHistory('c3', commitMap, (_commit, sha) => sha === 'c2')

      expect(visited).toEqual(['c3', 'c2'])
    })

    it('respects maxDepth', () => {
      const commits: Commit[] = [
        createCommit('c5', 'c4'),
        createCommit('c4', 'c3'),
        createCommit('c3', 'c2'),
        createCommit('c2', 'c1'),
        createCommit('c1', '')
      ]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const visited = walkCommitHistory('c5', commitMap, () => false, { maxDepth: 3 })

      expect(visited).toEqual(['c5', 'c4', 'c3'])
    })
  })

  describe('countCommitsInRange', () => {
    it('counts commits between base and head', () => {
      const commits: Commit[] = [
        createCommit('c4', 'c3'),
        createCommit('c3', 'c2'),
        createCommit('c2', 'c1'),
        createCommit('c1', '')
      ]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      // Range c1 (exclusive) to c4 (inclusive) = c2, c3, c4 = 3 commits
      expect(countCommitsInRange('c1', 'c4', commitMap)).toBe(3)
    })

    it('returns 0 when base equals head', () => {
      const commits: Commit[] = [createCommit('c1', '')]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      expect(countCommitsInRange('c1', 'c1', commitMap)).toBe(0)
    })
  })

  describe('getCommitsInRange', () => {
    it('returns commits in topological order (oldest to newest)', () => {
      const commits: Commit[] = [
        createCommit('c4', 'c3'),
        createCommit('c3', 'c2'),
        createCommit('c2', 'c1'),
        createCommit('c1', '')
      ]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      const range = getCommitsInRange('c1', 'c4', commitMap)

      expect(range.map((c) => c.sha)).toEqual(['c2', 'c3', 'c4'])
    })

    it('returns empty array when base equals head', () => {
      const commits: Commit[] = [createCommit('c1', '')]
      const commitMap = new Map(commits.map((c) => [c.sha, c]))

      expect(getCommitsInRange('c1', 'c1', commitMap)).toEqual([])
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createStackNode(branch: string, children: StackNodeState[]): StackNodeState {
  return {
    branch,
    headSha: `sha-${branch}`,
    baseSha: `base-${branch}`,
    children
  }
}

function createIntent(
  targets: Array<{ node: StackNodeState; targetBaseSha: string }>
): { id: string; createdAtMs: number; targets: typeof targets } {
  return {
    id: 'test-intent',
    createdAtMs: Date.now(),
    targets
  }
}

function createBranch(
  ref: string,
  headSha: string,
  options: { isTrunk?: boolean; isRemote?: boolean } = {}
): Branch {
  return {
    ref,
    headSha,
    isTrunk: options.isTrunk ?? false,
    isRemote: options.isRemote ?? false
  }
}

function createCommit(sha: string, parentSha: string): Commit {
  return {
    sha,
    parentSha,
    childrenSha: [],
    message: `Commit ${sha}`,
    timeMs: Date.now()
  }
}
