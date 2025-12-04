import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildRebaseIntent } from '../build-rebase-intent'

describe('buildRebaseIntent', () => {
  it('returns null when headSha does not exist', () => {
    const repo = createRepo({
      commits: [createCommit('abc', '')],
      branches: [createBranch('main', 'abc', { isTrunk: true })]
    })

    const intent = buildRebaseIntent(repo, 'nonexistent', 'abc')
    expect(intent).toBeNull()
  })

  it('returns null when baseSha does not exist', () => {
    const repo = createRepo({
      commits: [createCommit('abc', '')],
      branches: [createBranch('main', 'abc', { isTrunk: true })]
    })

    const intent = buildRebaseIntent(repo, 'abc', 'nonexistent')
    expect(intent).toBeNull()
  })

  it('returns null when no branch points to headSha', () => {
    const repo = createRepo({
      commits: [createCommit('abc', ''), createCommit('orphan', 'abc')],
      branches: [createBranch('main', 'abc', { isTrunk: true })]
    })

    // orphan has no branch pointing to it
    const intent = buildRebaseIntent(repo, 'orphan', 'abc')
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

    const intent = buildRebaseIntent(repo, 'feature', 'trunk-tip')

    expect(intent).not.toBeNull()
    expect(intent?.targets).toHaveLength(1)
    expect(intent?.targets[0]?.targetBaseSha).toBe('trunk-tip')
    expect(intent?.targets[0]?.node.branch).toBe('feature-branch')
    expect(intent?.targets[0]?.node.headSha).toBe('feature')
    expect(intent?.targets[0]?.node.baseSha).toBe('trunk-base')
  })

  it('calculates correct baseSha for multi-commit branch', () => {
    // trunk: A -- B -- C (main)
    //              \
    // feature:      D -- E -- F (feature-branch)
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

    const intent = buildRebaseIntent(repo, 'F', 'C')

    expect(intent).not.toBeNull()
    expect(intent?.targets[0]?.node.branch).toBe('feature-branch')
    expect(intent?.targets[0]?.node.headSha).toBe('F')
    // baseSha should be B (the fork point, where trunk and feature diverged)
    expect(intent?.targets[0]?.node.baseSha).toBe('B')
  })

  it('includes child branches in the tree', () => {
    // trunk: A -- B (main)
    //              \
    // feature:      C -- D (feature-1)
    //                    \
    // child:              E -- F (feature-2)
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

    const intent = buildRebaseIntent(repo, 'D', 'B')

    expect(intent).not.toBeNull()
    const node = intent?.targets[0]?.node
    expect(node?.branch).toBe('feature-1')
    expect(node?.children).toHaveLength(1)
    expect(node?.children[0]?.branch).toBe('feature-2')
    expect(node?.children[0]?.baseSha).toBe('D') // Fork point is feature-1's head
  })

  it('handles stacked diffs (multiple levels of child branches)', () => {
    // trunk: A -- B (main)
    //              \
    //               C (stack-1)
    //                \
    //                 D (stack-2)
    //                  \
    //                   E (stack-3)
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

    const intent = buildRebaseIntent(repo, 'C', 'B')

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
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B')
    ]
    const branches = [
      createBranch('main', 'B', { isTrunk: true }),
      createBranch('origin/feature', 'C', { isRemote: true }),
      createBranch('feature', 'C')
    ]
    const repo = createRepo({ commits, branches })

    const intent = buildRebaseIntent(repo, 'C', 'B')

    expect(intent).not.toBeNull()
    // Should prefer local 'feature' over 'origin/feature'
    expect(intent?.targets[0]?.node.branch).toBe('feature')
  })

  it('handles branch at root commit', () => {
    const commits = [createCommit('root', '')]
    const branches = [createBranch('main', 'root', { isTrunk: true })]
    const repo = createRepo({ commits, branches })

    const intent = buildRebaseIntent(repo, 'root', 'root')

    // Same base and head - might be null or might work
    // The implementation should handle this gracefully
    expect(intent).not.toBeNull()
    expect(intent?.targets[0]?.node.baseSha).toBe('root')
  })

  it('generates intent ID with correct format', () => {
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature', 'B')
    ]
    const repo = createRepo({ commits, branches })

    const intent = buildRebaseIntent(repo, 'B', 'A')

    // ID should contain preview prefix and the headSha
    expect(intent?.id).toContain('preview-')
    expect(intent?.id).toContain('B')
    // ID should include timestamp
    expect(intent?.id).toMatch(/preview-B-\d+/)
  })

  it('sets createdAtMs timestamp', () => {
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature', 'B')
    ]
    const repo = createRepo({ commits, branches })

    const before = Date.now()
    const intent = buildRebaseIntent(repo, 'B', 'A')
    const after = Date.now()

    expect(intent?.createdAtMs).toBeGreaterThanOrEqual(before)
    expect(intent?.createdAtMs).toBeLessThanOrEqual(after)
  })

  it('handles multiple branches at same commit (selects first non-trunk non-remote)', () => {
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('origin/feature-1', 'B', { isRemote: true }),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'B')
    ]
    const repo = createRepo({ commits, branches })

    const intent = buildRebaseIntent(repo, 'B', 'A')

    // Should pick one of the local branches
    expect(['feature-1', 'feature-2']).toContain(intent?.targets[0]?.node.branch)
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
    commits: overrides.commits ?? [],
    branches: overrides.branches ?? [],
    workingTreeStatus: overrides.workingTreeStatus ?? createWorkingTreeStatus()
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
