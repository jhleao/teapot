import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { GitForgeState } from '../../../shared/types/git-forge'
import { SquashValidator } from '../SquashValidator'

describe('SquashValidator', () => {
  it('allows squashing a commit into its parent', () => {
    const commits = [
      createCommit('A', '', []),
      createCommit('B', 'A', ['C']),
      createCommit('C', 'B', [])
    ]
    // Wire up childrenSha relationships
    commits[0].childrenSha = ['B']
    commits[1].childrenSha = ['C']

    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'C')
    ]
    const repo = createRepo({ commits, branches })
    const forgeState = createForgeState()

    // Validate squashing commit C into commit B
    const result = SquashValidator.validate(repo, 'C', forgeState)

    expect(result.canSquash).toBe(true)
    expect(result.targetCommitSha).toBe('C')
    expect(result.parentCommitSha).toBe('B')
    expect(result.targetBranch).toBe('feature-2')
    expect(result.parentBranch).toBe('feature-1')
    expect(result.descendantBranches).toEqual([])
  })

  it('blocks squashing trunk commits', () => {
    const commits = [createCommit('A', '', [])]
    const branches = [createBranch('main', 'A', { isTrunk: true })]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'A', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('no_parent')
  })

  it('blocks squashing into trunk', () => {
    const commits = [createCommit('A', '', ['B']), createCommit('B', 'A', [])]
    commits[0].childrenSha = ['B']

    const branches = [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'B')]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'B', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('parent_is_trunk')
  })

  it('blocks dirty working trees on current branch', () => {
    const commits = [createCommit('A', '', ['B']), createCommit('B', 'A', [])]
    commits[0].childrenSha = ['B']

    const branches = [createBranch('feature', 'A'), createBranch('feature-2', 'B')]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: createWorkingTreeStatus(['file.txt'], 'B')
    })

    const result = SquashValidator.validate(repo, 'B', createForgeState(), {
      isCurrentBranch: true
    })

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('dirty_tree')
  })

  it('allows dirty working trees on other branch', () => {
    const commits = [createCommit('A', '', ['B']), createCommit('B', 'A', [])]
    commits[0].childrenSha = ['B']

    const branches = [createBranch('feature', 'A'), createBranch('feature-2', 'B')]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: createWorkingTreeStatus(['file.txt'], 'X')
    })

    // isCurrentBranch: false means dirty worktree is allowed
    const result = SquashValidator.validate(repo, 'B', createForgeState(), {
      isCurrentBranch: false
    })

    expect(result.canSquash).toBe(true)
  })

  it('blocks when a rebase is already in progress', () => {
    const commits = [createCommit('A', '', ['B']), createCommit('B', 'A', [])]
    commits[0].childrenSha = ['B']

    const branches = [createBranch('feature', 'A'), createBranch('feature-2', 'B')]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: { ...createWorkingTreeStatus(), isRebasing: true }
    })

    const result = SquashValidator.validate(repo, 'B', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('rebase_in_progress')
  })

  it('blocks non-linear descendants (multiple children)', () => {
    // Commit A has two children B and C
    const commits = [
      createCommit('A', '', ['B', 'C']),
      createCommit('B', 'A', []),
      createCommit('C', 'A', [])
    ]

    const branches = [
      createBranch('feature', 'A'),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'C')
    ]
    const repo = createRepo({ commits, branches })

    // Try to squash A - it has multiple children so blocked
    const result = SquashValidator.validate(repo, 'A', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('no_parent')
  })

  it('blocks when commit has no parent', () => {
    const commits = [createCommit('A', '', [])]
    const branches = [createBranch('feature', 'A')]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'A', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('no_parent')
    expect(result.errorDetail).toBe('Commit has no parent')
  })

  it('collects descendant branches for rebasing', () => {
    const commits = [
      createCommit('A', '', ['B']),
      createCommit('B', 'A', ['C']),
      createCommit('C', 'B', ['D']),
      createCommit('D', 'C', [])
    ]
    commits[0].childrenSha = ['B']
    commits[1].childrenSha = ['C']
    commits[2].childrenSha = ['D']

    const branches = [
      createBranch('base', 'A'),
      createBranch('feature', 'B'),
      createBranch('child-1', 'C'),
      createBranch('child-2', 'D')
    ]
    const repo = createRepo({ commits, branches })

    // Squash B into A - C and D are descendants
    const result = SquashValidator.validate(repo, 'B', createForgeState())

    expect(result.canSquash).toBe(true)
    expect(result.descendantBranches).toEqual(['child-1', 'child-2'])
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

function createCommit(sha: string, parentSha: string, childrenSha: string[]): Commit {
  return {
    sha,
    parentSha,
    childrenSha,
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

function createWorkingTreeStatus(
  allChangedFiles: string[] = [],
  currentCommitSha = ''
): WorkingTreeStatus {
  return {
    currentBranch: 'main',
    currentCommitSha,
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
    allChangedFiles
  }
}

function createForgeState(
  prs: Array<Partial<GitForgeState['pullRequests'][number]>> = []
): GitForgeState {
  return {
    pullRequests: prs.map((pr, index) => ({
      number: pr.number ?? index,
      title: pr.title ?? `PR ${index}`,
      url: pr.url ?? '',
      state: pr.state ?? 'open',
      headRefName: pr.headRefName ?? '',
      headSha: pr.headSha ?? '',
      baseRefName: pr.baseRefName ?? '',
      createdAt: pr.createdAt ?? new Date().toISOString(),
      isMergeable: pr.isMergeable ?? false
    }))
  }
}
