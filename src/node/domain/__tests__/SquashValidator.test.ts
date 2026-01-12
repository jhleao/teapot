import type { Branch, Commit, Repo, WorkingTreeStatus, Worktree } from '@shared/types'
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
    const branches = [createBranch('main', 'A', { isTrunk: true }), createBranch('feature', 'B')]
    const repo = createRepo({ commits, branches })

    const result = SquashValidator.validate(repo, 'feature', createForgeState())

    expect(result.canSquash).toBe(false)
    expect(result.error).toBe('parent_is_trunk')
    expect(result.parentIsTrunk).toBe(true)
    expect(result.parentBranch).toBe('main')
  })
})

describe('SquashValidator.validateNoWorktreeConflicts', () => {
  it('returns valid when no worktrees have affected branches', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false), // active worktree
      createWorktree('/worktree-1', 'unrelated', false)
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      ['child'],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(true)
  })

  it('returns valid when no other worktrees exist', () => {
    const worktrees: Worktree[] = [createWorktree('/repo', 'main', false)]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      [],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(true)
  })

  it('returns conflicts for target branch in dirty worktree', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false),
      createWorktree('/worktree-1', 'target', true) // dirty worktree with target branch
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      [],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].branch).toBe('target')
      expect(result.conflicts[0].isDirty).toBe(true)
    }
  })

  it('returns conflicts for target branch in clean worktree (can be auto-detached)', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false),
      createWorktree('/worktree-1', 'target', false) // clean worktree with target branch
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      [],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].branch).toBe('target')
      expect(result.conflicts[0].isDirty).toBe(false)
    }
  })

  it('returns conflicts for parent branch in dirty worktree', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false),
      createWorktree('/worktree-1', 'parent', true) // dirty worktree with parent branch
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      [],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].branch).toBe('parent')
      expect(result.conflicts[0].isDirty).toBe(true)
    }
  })

  it('returns conflicts for descendant branch in dirty worktree', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false),
      createWorktree('/worktree-1', 'child', true) // dirty worktree with child branch
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      ['child'],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].branch).toBe('child')
      expect(result.conflicts[0].isDirty).toBe(true)
    }
  })

  it('ignores affected branches in active worktree', () => {
    // Active worktree has target branch - should be ignored
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'target', true) // active worktree with target (even dirty)
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      [],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(true)
  })

  it('detects multiple conflicting worktrees', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false),
      createWorktree('/worktree-1', 'target', true),
      createWorktree('/worktree-2', 'child', false)
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      ['child'],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.conflicts).toHaveLength(2)
      const branches = result.conflicts.map((c) => c.branch)
      expect(branches).toContain('target')
      expect(branches).toContain('child')
    }
  })

  it('ignores worktrees with detached HEAD (null branch)', () => {
    const worktrees: Worktree[] = [
      createWorktree('/repo', 'main', false),
      createWorktree('/worktree-1', null, false) // detached HEAD
    ]

    const result = SquashValidator.validateNoWorktreeConflicts(
      'target',
      'parent',
      [],
      worktrees,
      '/repo'
    )

    expect(result.valid).toBe(true)
  })
})

describe('SquashValidator.partitionWorktreeConflicts', () => {
  it('separates clean and dirty worktree conflicts', () => {
    const conflicts = [
      { branch: 'clean-1', worktreePath: '/wt1', isDirty: false },
      { branch: 'dirty-1', worktreePath: '/wt2', isDirty: true },
      { branch: 'clean-2', worktreePath: '/wt3', isDirty: false },
      { branch: 'dirty-2', worktreePath: '/wt4', isDirty: true }
    ]

    const result = SquashValidator.partitionWorktreeConflicts(conflicts)

    expect(result.clean).toHaveLength(2)
    expect(result.dirty).toHaveLength(2)
    expect(result.clean.map((c) => c.branch)).toEqual(['clean-1', 'clean-2'])
    expect(result.dirty.map((c) => c.branch)).toEqual(['dirty-1', 'dirty-2'])
  })

  it('returns empty arrays when no conflicts', () => {
    const result = SquashValidator.partitionWorktreeConflicts([])

    expect(result.clean).toEqual([])
    expect(result.dirty).toEqual([])
  })
})

describe('SquashValidator.formatWorktreeConflictMessage', () => {
  it('returns empty string for no conflicts', () => {
    const result = SquashValidator.formatWorktreeConflictMessage([])
    expect(result).toBe('')
  })

  it('formats message for dirty worktree conflicts', () => {
    const conflicts = [
      { branch: 'feature-1', worktreePath: '/wt1', isDirty: true },
      { branch: 'feature-2', worktreePath: '/wt2', isDirty: true }
    ]

    const result = SquashValidator.formatWorktreeConflictMessage(conflicts)

    expect(result).toContain('feature-1')
    expect(result).toContain('feature-2')
    expect(result).toContain('uncommitted changes')
  })

  it('formats message for clean worktree conflicts', () => {
    const conflicts = [
      { branch: 'feature-1', worktreePath: '/wt1', isDirty: false },
      { branch: 'feature-2', worktreePath: '/wt2', isDirty: false }
    ]

    const result = SquashValidator.formatWorktreeConflictMessage(conflicts)

    expect(result).toContain('feature-1')
    expect(result).toContain('feature-2')
    expect(result).toContain('will be detached')
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

function createWorktree(path: string, branch: string | null, isDirty: boolean): Worktree {
  return {
    path,
    headSha: 'abc123',
    branch,
    isMain: path === '/repo',
    isStale: false,
    isDirty
  }
}
