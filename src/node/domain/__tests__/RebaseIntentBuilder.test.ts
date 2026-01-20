import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { RebaseIntentBuilder } from '../RebaseIntentBuilder'

describe('RebaseIntentBuilder', () => {
  it('returns null when headSha does not exist', () => {
    const repo = createRepo({
      commits: [createCommit('abc', '')],
      branches: [createBranch('main', 'abc', { isTrunk: true })]
    })

    const intent = RebaseIntentBuilder.build(repo, 'nonexistent', 'abc')
    expect(intent).toBeNull()
  })

  it('returns null when baseSha does not exist', () => {
    const repo = createRepo({
      commits: [createCommit('abc', '')],
      branches: [createBranch('main', 'abc', { isTrunk: true })]
    })

    const intent = RebaseIntentBuilder.build(repo, 'abc', 'nonexistent')
    expect(intent).toBeNull()
  })

  it('returns null when no branch points to headSha', () => {
    const repo = createRepo({
      commits: [createCommit('abc', ''), createCommit('orphan', 'abc')],
      branches: [createBranch('main', 'abc', { isTrunk: true })]
    })

    // orphan has no branch pointing to it
    const intent = RebaseIntentBuilder.build(repo, 'orphan', 'abc')
    expect(intent).toBeNull()
  })

  it('creates intent for single-commit branch', () => {
    const commits = [
      createCommit('trunk-base', ''),
      createCommit('trunk-tip', 'trunk-base'),
      createCommit('feature', 'trunk-base')
    ]
    const branches = [
      createBranch('main', 'trunk-tip', { isTrunk: true }),
      createBranch('feature-branch', 'feature')
    ]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'feature', 'trunk-tip')

    expect(intent).not.toBeNull()
    expect(intent?.targets).toHaveLength(1)
    expect(intent?.targets[0]?.targetBaseSha).toBe('trunk-tip')
    expect(intent?.targets[0]?.node.branch).toBe('feature-branch')
    expect(intent?.targets[0]?.node.headSha).toBe('feature')
    expect(intent?.targets[0]?.node.baseSha).toBe('trunk-base')
  })

  it('calculates correct baseSha including all owned commits (multi-commit branches)', () => {
    // Graph: A → B → D → E → F (feature-branch)
    //            ↘ C (main/trunk)
    // baseSha should be B (where trunk forks), NOT immediate parent E
    // All branchless commits D, E, F are "owned" by feature-branch and move together
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'B'),
      createCommit('E', 'D'),
      createCommit('F', 'E')
    ]
    const branches = [
      createBranch('main', 'C', { isTrunk: true }),
      createBranch('feature-branch', 'F')
    ]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'F', 'C')

    expect(intent).not.toBeNull()
    expect(intent?.targets[0]?.node.branch).toBe('feature-branch')
    expect(intent?.targets[0]?.node.headSha).toBe('F')
    // baseSha includes all owned commits - walks back to trunk fork point
    expect(intent?.targets[0]?.node.baseSha).toBe('B')
  })

  it('includes child branches in the tree', () => {
    // Graph: A → B (main) → C → D (feature-1) → E → F (feature-2)
    // feature-2's baseSha should be D (feature-1 head), since E and F are owned by feature-2
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C'),
      createCommit('E', 'D'),
      createCommit('F', 'E')
    ]
    const branches = [
      createBranch('main', 'B', { isTrunk: true }),
      createBranch('feature-1', 'D'),
      createBranch('feature-2', 'F')
    ]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'D', 'B')

    expect(intent).not.toBeNull()
    const node = intent?.targets[0]?.node
    expect(node?.branch).toBe('feature-1')
    expect(node?.children).toHaveLength(1)
    expect(node?.children[0]?.branch).toBe('feature-2')
    // baseSha walks back to parent branch head D (feature-1)
    expect(node?.children[0]?.baseSha).toBe('D')
  })

  it('handles stacked diffs (multiple levels of child branches)', () => {
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C'),
      createCommit('E', 'D')
    ]
    const branches = [
      createBranch('main', 'B', { isTrunk: true }),
      createBranch('stack-1', 'C'),
      createBranch('stack-2', 'D'),
      createBranch('stack-3', 'E')
    ]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'C', 'B')

    expect(intent).not.toBeNull()
    const stack1 = intent?.targets[0]?.node
    expect(stack1?.branch).toBe('stack-1')
    expect(stack1?.children).toHaveLength(1)

    const stack2 = stack1?.children[0]
    expect(stack2?.branch).toBe('stack-2')
    expect(stack2?.baseSha).toBe('C')
    expect(stack2?.children).toHaveLength(1)

    const stack3 = stack2?.children[0]
    expect(stack3?.branch).toBe('stack-3')
    expect(stack3?.baseSha).toBe('D')
  })

  it('prefers local branches over remote branches', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
    const branches = [
      createBranch('main', 'B', { isTrunk: true }),
      createBranch('origin/feature', 'C', { isRemote: true }),
      createBranch('feature', 'C')
    ]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'C', 'B')

    expect(intent).not.toBeNull()
    expect(intent?.targets[0]?.node.branch).toBe('feature')
  })

  it('handles branch at root commit', () => {
    // A branch at root commit rebased onto another commit
    const commits = [createCommit('root', ''), createCommit('B', 'root')]
    const branches = [createBranch('main', 'root', { isTrunk: true }), createBranch('feature', 'B')]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'B', 'root')

    expect(intent).not.toBeNull()
    expect(intent?.targets[0]?.node.baseSha).toBe('root')
  })

  it('returns null for no-op rebase (head equals base)', () => {
    const commits = [createCommit('root', '')]
    const branches = [createBranch('main', 'root', { isTrunk: true })]
    const repo = createRepo({ commits, branches })

    // Rebasing a commit onto itself is a no-op
    const intent = RebaseIntentBuilder.build(repo, 'root', 'root')

    expect(intent).toBeNull()
  })

  it('generates intent ID with correct format', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A')]
    const branches = [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'B')]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'B', 'A')

    expect(intent?.id).toContain('preview-')
    expect(intent?.id).toContain('B')
    expect(intent?.id).toMatch(/preview-B-\d+/)
  })

  it('sets createdAtMs timestamp', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A')]
    const branches = [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'B')]
    const repo = createRepo({ commits, branches })

    const before = Date.now()
    const intent = RebaseIntentBuilder.build(repo, 'B', 'A')
    const after = Date.now()

    expect(intent?.createdAtMs).toBeGreaterThanOrEqual(before)
    expect(intent?.createdAtMs).toBeLessThanOrEqual(after)
  })

  it('handles multiple branches at same commit (selects first non-trunk non-remote)', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('origin/feature-1', 'B', { isRemote: true }),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'B')
    ]
    const repo = createRepo({ commits, branches })

    const intent = RebaseIntentBuilder.build(repo, 'B', 'A')

    expect(['feature-1', 'feature-2']).toContain(intent?.targets[0]?.node.branch)
  })

  describe('sibling branch detection', () => {
    it('includes sibling branch at same commit as child', () => {
      const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
      const branches = [
        createBranch('main', 'B', { isTrunk: true }),
        createBranch('branch-1', 'C'),
        createBranch('branch-2', 'C')
      ]
      const repo = createRepo({ commits, branches })

      const intent = RebaseIntentBuilder.build(repo, 'C', 'B')

      expect(intent).not.toBeNull()
      const node = intent?.targets[0]?.node
      expect(node?.branch).toMatch(/branch-[12]/)
      expect(node?.children).toHaveLength(1)
      expect(node?.children[0]?.branch).toMatch(/branch-[12]/)
      expect(node?.children[0]?.branch).not.toBe(node?.branch)
    })

    it('includes branch forked from ancestor commit within rebase range', () => {
      const commits = [
        createCommit('A', ''),
        createCommit('B', 'A'),
        createCommit('C', 'B'),
        createCommit('D', 'C'),
        createCommit('E', 'D'),
        createCommit('F', 'C')
      ]
      const branches = [
        createBranch('main', 'B', { isTrunk: true }),
        createBranch('branch-1', 'E'),
        createBranch('branch-2', 'F')
      ]
      const repo = createRepo({ commits, branches })

      const intent = RebaseIntentBuilder.build(repo, 'E', 'B')

      expect(intent).not.toBeNull()
      const node = intent?.targets[0]?.node
      expect(node?.branch).toBe('branch-1')
      expect(node?.children.some((c) => c.branch === 'branch-2')).toBe(true)
    })

    it('does not include branches outside the rebase lineage', () => {
      const commits = [
        createCommit('A', ''),
        createCommit('B', 'A'),
        createCommit('C', 'B'),
        createCommit('D', 'C'),
        createCommit('E', 'B'),
        createCommit('F', 'E')
      ]
      const branches = [
        createBranch('main', 'B', { isTrunk: true }),
        createBranch('branch-1', 'D'),
        createBranch('branch-2', 'F')
      ]
      const repo = createRepo({ commits, branches })

      const intent = RebaseIntentBuilder.build(repo, 'D', 'B')

      expect(intent).not.toBeNull()
      const node = intent?.targets[0]?.node
      expect(node?.branch).toBe('branch-1')
      expect(node?.children).toHaveLength(0)
    })

    it('does not duplicate branches when multiple at same fork point', () => {
      const commits = [
        createCommit('A', ''),
        createCommit('B', 'A'),
        createCommit('C', 'B'),
        createCommit('D', 'C'),
        createCommit('E', 'C')
      ]
      const branches = [
        createBranch('main', 'B', { isTrunk: true }),
        createBranch('branch-1', 'C'),
        createBranch('branch-2', 'D'),
        createBranch('branch-3', 'E')
      ]
      const repo = createRepo({ commits, branches })

      const intent = RebaseIntentBuilder.build(repo, 'C', 'B')

      const node = intent?.targets[0]?.node
      expect(node?.branch).toBe('branch-1')
      expect(node?.children).toHaveLength(2)
      const childBranches = node?.children.map((c) => c.branch).sort()
      expect(childBranches).toEqual(['branch-2', 'branch-3'])
    })
  })

  describe('remote branch handling', () => {
    it('ignores remote branches when calculating ownership (includes branchless ancestors)', () => {
      // Graph: A (trunk) → B → C → D → E (feature)
      // where origin/feature is at B (local is ahead of remote)
      // Expected: all commits D, C, B should be owned by feature, NOT stopped at B due to remote branch
      const commits = [
        createCommit('A', ''),
        createCommit('B', 'A'),
        createCommit('C', 'B'),
        createCommit('D', 'C'),
        createCommit('E', 'D')
      ]
      const branches = [
        createBranch('main', 'A', { isTrunk: true }),
        createBranch('feature', 'E'),
        createBranch('origin/feature', 'B', { isRemote: true }) // Remote tracking branch at older commit
      ]
      const repo = createRepo({ commits, branches })

      const intent = RebaseIntentBuilder.build(repo, 'E', 'A')

      expect(intent).not.toBeNull()
      expect(intent?.targets[0]?.node.branch).toBe('feature')
      expect(intent?.targets[0]?.node.headSha).toBe('E')
      // baseSha should be A (trunk), NOT B (where remote branch is)
      // This ensures all branchless ancestors (B, C, D) are included in the rebase
      expect(intent?.targets[0]?.node.baseSha).toBe('A')
    })

    it('still stops at local branch heads (not affected by remote branch fix)', () => {
      // Graph: A (trunk) → B (local-base) → C → D (feature)
      // Expected: feature owns C and D, stops at B (local branch head)
      const commits = [
        createCommit('A', ''),
        createCommit('B', 'A'),
        createCommit('C', 'B'),
        createCommit('D', 'C')
      ]
      const branches = [
        createBranch('main', 'A', { isTrunk: true }),
        createBranch('local-base', 'B'),
        createBranch('feature', 'D')
      ]
      const repo = createRepo({ commits, branches })

      const intent = RebaseIntentBuilder.build(repo, 'D', 'A')

      expect(intent).not.toBeNull()
      expect(intent?.targets[0]?.node.branch).toBe('feature')
      // baseSha should be B (where local-base branch is), as expected
      expect(intent?.targets[0]?.node.baseSha).toBe('B')
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createRepo(
  overrides: Partial<{
    commits: Commit[]
    branches: Branch[]
    workingTreeStatus: WorkingTreeStatus
  }> = {}
): Repo {
  return {
    path: '/test/repo',
    activeWorktreePath: null,
    commits: overrides.commits ?? [],
    branches: overrides.branches ?? [],
    workingTreeStatus: overrides.workingTreeStatus ?? createWorkingTreeStatus(),
    worktrees: []
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

function createWorkingTreeStatus(): WorkingTreeStatus {
  return {
    currentBranch: 'main',
    currentCommitSha: '',
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
  }
}
