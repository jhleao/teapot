/**
 * Tests for finding a valid PR target branch
 *
 * When a PR's target branch is merged, we need to find the next valid target.
 * This walks up the stack until we find an unmerged branch or trunk.
 */

import type { Branch, Commit, Repo } from '@shared/types'
import type { ForgePullRequest } from '@shared/types/git-forge'
import { describe, expect, it } from 'vitest'
import { PrTargetResolver } from '../../domain'

const findValidPrTarget = PrTargetResolver.findValidPrTarget.bind(PrTargetResolver)
const findBaseBranch = PrTargetResolver.findBaseBranch.bind(PrTargetResolver)

// Counter for generating unique timestamps (newer commits = higher value)
let commitTimeCounter = 1000

function createCommit(sha: string, parentSha: string | null): Commit {
  // Each commit gets a unique, increasing timestamp
  // This ensures TrunkResolver.getTrunkHeadSha can distinguish commits by time
  const timeMs = commitTimeCounter++
  return {
    sha,
    message: sha,
    timeMs,
    parentSha: parentSha ?? '',
    childrenSha: []
  }
}

function createRepo(commits: Commit[], branches: Branch[]): Repo {
  return {
    path: '/tmp/repo',
    activeWorktreePath: null,
    commits,
    branches,
    workingTreeStatus: {
      currentBranch: 'main',
      currentCommitSha: commits[0]?.sha ?? '',
      tracking: null,
      detached: false,
      isRebasing: false,
      staged: [],
      modified: [],
      created: [],
      deleted: [],
      renamed: [],
      not_added: [],
      conflicted: [],
      allChangedFiles: []
    },
    worktrees: []
  }
}

// Helper to create mock PRs
function createPr(
  headRefName: string,
  baseRefName: string,
  state: 'open' | 'closed' | 'merged' | 'draft' = 'open'
): ForgePullRequest {
  return {
    number: Math.floor(Math.random() * 1000),
    title: `PR for ${headRefName}`,
    url: `https://github.com/test/repo/pull/${headRefName}`,
    state,
    headRefName,
    headSha: 'abc123',
    baseRefName,
    createdAt: new Date().toISOString(),
    isMergeable: true
  }
}

describe('findValidPrTarget', () => {
  it('returns trunk when targeting trunk directly', () => {
    const prs: ForgePullRequest[] = []
    const mergedBranches = new Set<string>()

    const result = findValidPrTarget('feature-1', 'main', prs, mergedBranches)

    expect(result).toBe('main')
  })

  it('returns target unchanged when target is not merged', () => {
    const prs = [createPr('feature-2', 'feature-1', 'open'), createPr('feature-1', 'main', 'open')]
    const mergedBranches = new Set<string>()

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    expect(result).toBe('feature-1')
  })

  it('walks up stack when target is merged', () => {
    // Stack: main <- feature-1 <- feature-2 <- feature-3
    // feature-1 is merged, so feature-2's target should become main
    const prs = [
      createPr('feature-3', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'open'),
      createPr('feature-1', 'main', 'merged')
    ]
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    expect(result).toBe('main')
  })

  it('walks up multiple levels if needed', () => {
    // Stack: main <- f1 <- f2 <- f3 <- f4
    // f1 and f2 are merged, so f3's target should become main
    const prs = [
      createPr('feature-4', 'feature-3', 'open'),
      createPr('feature-3', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'merged'),
      createPr('feature-1', 'main', 'merged')
    ]
    const mergedBranches = new Set(['feature-1', 'feature-2'])

    const result = findValidPrTarget('feature-3', 'feature-2', prs, mergedBranches)

    expect(result).toBe('main')
  })

  it('stops at first unmerged branch in stack', () => {
    // Stack: main <- f1 <- f2 <- f3
    // f1 is merged, f2 is not, so f3 stays targeting f2
    const prs = [
      createPr('feature-3', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'open'),
      createPr('feature-1', 'main', 'merged')
    ]
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-3', 'feature-2', prs, mergedBranches)

    // f2 is not merged, so it's still a valid target
    expect(result).toBe('feature-2')
  })

  it('handles master as trunk', () => {
    const prs = [createPr('feature-1', 'master', 'merged')]
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    expect(result).toBe('master')
  })

  it('throws when target is merged and no PR chain found', () => {
    const prs: ForgePullRequest[] = []
    const mergedBranches = new Set(['feature-1'])

    expect(() => findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)).toThrow(
      'Cannot determine PR base'
    )
  })

  it('falls back to trunk when target is merged and no PR chain found', () => {
    const prs: ForgePullRequest[] = []
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches, 'main')

    expect(result).toBe('main')
  })

  it('handles circular references gracefully', () => {
    // Edge case: malformed PR chain with cycle
    const prs = [
      createPr('feature-1', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'open') // cycle!
    ]
    const mergedBranches = new Set(['feature-1', 'feature-2'])

    // Should not infinite loop - returns last valid target or falls back
    const result = findValidPrTarget('feature-1', 'feature-2', prs, mergedBranches)

    expect(result).toBeDefined()
  })
})

describe('findBaseBranch', () => {
  it('returns trunk when sibling branch exists at trunk commit', () => {
    // Scenario: trunk at 'a', sibling also at 'a', my-feature at 'b' (parent 'a')
    // Siblings at trunk commit should be ignored
    const commits = [createCommit('b', 'a'), createCommit('a', null)]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'a' },
      { ref: 'sibling', isTrunk: false, isRemote: false, headSha: 'a' }
    ]
    const repo = createRepo(commits, branches)

    const result = findBaseBranch(repo, 'b', new Set())

    expect(result).toBe('main')
  })

  it('returns trunk when trunk moved forward and sibling at old position', () => {
    // Scenario: trunk was at 'a', moved to 'c', sibling still at 'a'
    // my-feature at 'b' (parent 'a')
    //
    //     c ← main (trunk moved here)
    //    /
    //   a ← sibling (stale branch)
    //    \
    //     b ← my-feature
    //
    // Expected: target trunk, not sibling
    const commits = [
      createCommit('c', 'a'), // trunk moved forward
      createCommit('b', 'a'), // my-feature
      createCommit('a', null)
    ]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'c' },
      { ref: 'sibling', isTrunk: false, isRemote: false, headSha: 'a' }
    ]
    const repo = createRepo(commits, branches)

    // The sibling is NOT merged, but it should still be ignored
    const result = findBaseBranch(repo, 'b', new Set())

    expect(result).toBe('main')
  })

  it('selects stack parent when branch is not on trunk lineage', () => {
    // Scenario: main at 'a', parent at 'b', child at 'c'
    // 'b' is NOT an ancestor of trunk, so 'parent' is a valid stack parent
    const commits = [createCommit('c', 'b'), createCommit('b', 'a'), createCommit('a', null)]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'a' },
      { ref: 'parent', isTrunk: false, isRemote: false, headSha: 'b' },
      { ref: 'child', isTrunk: false, isRemote: false, headSha: 'c' }
    ]
    const repo = createRepo(commits, branches)

    const result = findBaseBranch(repo, 'c', new Set())

    expect(result).toBe('parent')
  })

  it('skips merged branches and continues walking', () => {
    // Scenario: main at 'a', parent at 'b' (merged), child at 'c'
    // parent is merged, so we should target main
    const commits = [createCommit('c', 'b'), createCommit('b', 'a'), createCommit('a', null)]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'a' },
      { ref: 'parent', isTrunk: false, isRemote: false, headSha: 'b' },
      { ref: 'child', isTrunk: false, isRemote: false, headSha: 'c' }
    ]
    const repo = createRepo(commits, branches)

    const result = findBaseBranch(repo, 'c', new Set(['parent']))

    expect(result).toBe('main')
  })

  it('throws when multiple unmerged branches at same non-trunk commit', () => {
    // Scenario: main at 'a', two branches at 'b', child at 'c'
    // 'b' is NOT on trunk lineage, and has multiple unmerged branches → ambiguous
    const commits = [createCommit('c', 'b'), createCommit('b', 'a'), createCommit('a', null)]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'a' },
      { ref: 'parent1', isTrunk: false, isRemote: false, headSha: 'b' },
      { ref: 'parent2', isTrunk: false, isRemote: false, headSha: 'b' },
      { ref: 'child', isTrunk: false, isRemote: false, headSha: 'c' }
    ]
    const repo = createRepo(commits, branches)

    expect(() => findBaseBranch(repo, 'c', new Set())).toThrow(
      /Cannot determine PR base: multiple parent branches found \(parent1, parent2\)/
    )
  })

  it('ignores multiple siblings at trunk commit (not ambiguous)', () => {
    // Scenario: main at 'a', multiple siblings also at 'a', my-feature at 'b'
    // All branches at trunk commit are siblings, so we just return trunk
    const commits = [createCommit('b', 'a'), createCommit('a', null)]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'a' },
      { ref: 'sibling1', isTrunk: false, isRemote: false, headSha: 'a' },
      { ref: 'sibling2', isTrunk: false, isRemote: false, headSha: 'a' }
    ]
    const repo = createRepo(commits, branches)

    // Should NOT throw - siblings at trunk are ignored
    const result = findBaseBranch(repo, 'b', new Set())

    expect(result).toBe('main')
  })

  it('handles deep stack correctly', () => {
    // Stack: main ← p1 ← p2 ← p3 ← child
    const commits = [
      createCommit('d', 'c'), // child
      createCommit('c', 'b'), // p3
      createCommit('b', 'a'), // p2
      createCommit('a', 'root'), // p1
      createCommit('root', null) // main
    ]
    const branches: Branch[] = [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'root' },
      { ref: 'p1', isTrunk: false, isRemote: false, headSha: 'a' },
      { ref: 'p2', isTrunk: false, isRemote: false, headSha: 'b' },
      { ref: 'p3', isTrunk: false, isRemote: false, headSha: 'c' },
      { ref: 'child', isTrunk: false, isRemote: false, headSha: 'd' }
    ]
    const repo = createRepo(commits, branches)

    const result = findBaseBranch(repo, 'd', new Set())

    expect(result).toBe('p3')
  })
})
