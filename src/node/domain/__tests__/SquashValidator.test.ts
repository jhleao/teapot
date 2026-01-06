import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { GitForgeState } from '../../../shared/types/git-forge'
import { SquashValidator } from '../SquashValidator'

describe('SquashValidator', () => {
  it('allows squashing linear single-commit branch', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'C')
    ]
    const repo = createRepo({ commits, branches })
    const forgeState = createForgeState()

    const result = SquashValidator.validate(repo, 'feature-1', forgeState)

    expect(result.canSquash).toBe(true)
    expect(result.parentBranch).toBe('main')
    expect(result.descendantBranches).toEqual(['feature-2'])
    expect(result.commitDistance).toBe(1)
    expect(result.parentHeadSha).toBe('A')
    expect(result.targetHeadSha).toBe('B')
  })

  it('blocks trunk branches', () => {
    const commits = [createCommit('A', '')]
    const branches = [createBranch('main', 'A', { isTrunk: true })]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'main', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('is_trunk')
  })

  it('blocks dirty working trees', () => {
    const commits = [createCommit('A', '')]
    const branches = [createBranch('feature', 'A')]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: createWorkingTreeStatus(['file.txt'])
    })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('dirty_tree')
  })

  it('blocks when a rebase is already in progress', () => {
    const commits = [createCommit('A', '')]
    const branches = [createBranch('feature', 'A')]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: { ...createWorkingTreeStatus(), isRebasing: true }
    })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('dirty_tree')
  })

  it('blocks non-linear stacks', () => {
    // Two children of main -> not linear when folding feature-1
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'A')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'C')
    ]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'feature-1', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('not_linear')
  })

  it('blocks multi-commit branches', () => {
    // feature has two commits on top of main
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
    const branches = [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'C')]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('multi_commit')
  })

  it('blocks when a descendant has an open PR', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature-1', 'B'),
      createBranch('feature-2', 'C')
    ]
    const repo = createRepo({ commits, branches })
    const forgeState = createForgeState([{ number: 1, headRefName: 'feature-2', state: 'open' }])

    const result = SquashValidator.validate(repo, 'feature-1', forgeState)

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('descendant_has_pr')
    expect(result.errorDetail).toBe('feature-2')
  })

  it('blocks when no parent branch exists', () => {
    const commits = [createCommit('A', '')]
    const branches = [createBranch('lonely', 'A')]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'lonely', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('no_parent')
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

function createWorkingTreeStatus(allChangedFiles: string[] = []): WorkingTreeStatus {
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
