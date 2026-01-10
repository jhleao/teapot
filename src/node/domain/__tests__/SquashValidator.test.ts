import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { GitForgeState } from '../../../shared/types/git-forge'
import { SquashValidator } from '../SquashValidator'

describe('SquashValidator', () => {
  it('allows squashing linear single-commit branch', () => {
    // Stack: main -> parent -> target -> child (each 1 commit apart)
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('parent', 'B'),
      createBranch('target', 'C'),
      createBranch('child', 'D')
    ]
    const repo = createRepo({ commits, branches })
    const forgeState = createForgeState()

    const result = SquashValidator.validate(repo, 'target', forgeState)

    expect(result.canSquash).toBe(true)
    expect(result.parentBranch).toBe('parent')
    expect(result.descendantBranches).toEqual(['child'])
    expect(result.commitDistance).toBe(1)
    expect(result.parentHeadSha).toBe('B')
    expect(result.targetHeadSha).toBe('C')
  })

  it('blocks trunk branches', () => {
    const commits = [createCommit('A', '')]
    const branches = [createBranch('main', 'A', { isTrunk: true })]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'main', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('is_trunk')
  })

  it('blocks dirty working trees when squashing CURRENT branch', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('parent', 'B'),
      createBranch('feature', 'C')
    ]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: createWorkingTreeStatus(['file.txt'], 'feature')
    })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('dirty_tree')
    expect(result.isCurrentBranch).toBe(true)
  })

  it('allows dirty working trees when squashing OTHER branch', () => {
    // 4-branch stack: main -> grandparent -> parent -> target -> child
    // We squash 'target' into 'parent', while on 'child' with dirty worktree
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C'),
      createCommit('E', 'D')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('grandparent', 'B'),
      createBranch('parent', 'C'),
      createBranch('target', 'D'),
      createBranch('child', 'E')
    ]
    // Current branch is child, dirty worktree, but squashing target
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: createWorkingTreeStatus(['file.txt'], 'child')
    })

    const result = SquashValidator.validate(repo, 'target', createForgeState())

    expect(result.canSquash).toBe(true)
    expect(result.isCurrentBranch).toBe(false)
    expect(result.parentBranch).toBe('parent')
    expect(result.descendantBranches).toEqual(['child'])
  })

  it('blocks when a rebase is already in progress', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A'), createCommit('C', 'B')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('parent', 'B'),
      createBranch('feature', 'C')
    ]
    const repo = createRepo({
      commits,
      branches,
      workingTreeStatus: { ...createWorkingTreeStatus([], 'feature'), isRebasing: true }
    })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('rebase_in_progress')
  })

  it('blocks non-linear stacks', () => {
    // Stack: main -> grandparent -> parent -> [sibling-1, sibling-2] - not linear (siblings)
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C'),
      createCommit('E', 'C') // Also branches off C (sibling of D)
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('grandparent', 'B'),
      createBranch('parent', 'C'),
      createBranch('sibling-1', 'D'),
      createBranch('sibling-2', 'E')
    ]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'sibling-1', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('not_linear')
  })

  it('allows multi-commit branches', () => {
    // Stack: main -> grandparent -> parent -> (C -> D -> feature) - feature has 2 commits (distance=2)
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C'),
      createCommit('E', 'D')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('grandparent', 'B'),
      createBranch('parent', 'C'),
      createBranch('feature', 'E') // 2 commits above parent
    ]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(true)
    expect(result.parentBranch).toBe('parent')
    expect(result.commitDistance).toBe(2)
  })

  it('allows squashing when descendant has an open PR', () => {
    // Descendant PRs no longer block squash - we don't auto-push after squash
    // Stack: main -> grandparent -> parent -> target -> child (with PR)
    const commits = [
      createCommit('A', ''),
      createCommit('B', 'A'),
      createCommit('C', 'B'),
      createCommit('D', 'C'),
      createCommit('E', 'D')
    ]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('grandparent', 'B'),
      createBranch('parent', 'C'),
      createBranch('target', 'D'),
      createBranch('child', 'E')
    ]
    const repo = createRepo({ commits, branches })
    const forgeState = createForgeState([{ number: 1, headRefName: 'child', state: 'open' }])

    const result = SquashValidator.validate(repo, 'target', forgeState)

    expect(result.canSquash).toBe(true)
    expect(result.descendantBranches).toEqual(['child'])
  })

  it('blocks when no parent branch exists', () => {
    const commits = [createCommit('A', '')]
    const branches = [createBranch('lonely', 'A')]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'lonely', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('no_parent')
  })

  it('returns parent_is_trunk for branches stacked on trunk', () => {
    const commits = [createCommit('A', ''), createCommit('B', 'A')]
    const branches = [
      createBranch('main', 'A', { isTrunk: true }),
      createBranch('feature', 'B')
    ]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('parent_is_trunk')
    expect(result.parentIsTrunk).toBe(true)
    expect(result.parentBranch).toBe('main')
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

function createWorkingTreeStatus(
  allChangedFiles: string[] = [],
  currentBranch: string = 'main'
): WorkingTreeStatus {
  return {
    currentBranch,
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
