import type { Branch, Commit, Repo, WorkingTreeStatus } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { UiStateBuilder } from '../../domain'

const buildUiStack = UiStateBuilder.buildUiStack

/**
 * Tests for branch permission computations in UiStateBuilder.
 *
 * These tests verify that canDelete, canRename, canSquash, canCreateWorktree
 * and their associated disabled reasons are computed correctly.
 */

describe('UiStateBuilder branch permissions', () => {
  describe('canDelete and deleteDisabledReason', () => {
    it('allows deletion for non-trunk, non-current branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'feature',
        isTrunk: false,
        isCurrent: false
      })

      const branch = findBranch(repo, 'feature')
      expect(branch.canDelete).toBe(true)
      expect(branch.deleteDisabledReason).toBeUndefined()
    })

    it('disallows deletion for trunk branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'main',
        isTrunk: true,
        isCurrent: false
      })

      const branch = findBranch(repo, 'main')
      expect(branch.canDelete).toBe(false)
      expect(branch.deleteDisabledReason).toBe('Cannot delete trunk')
    })

    it('disallows deletion for current branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'feature',
        isTrunk: false,
        isCurrent: true
      })

      const branch = findBranch(repo, 'feature')
      expect(branch.canDelete).toBe(false)
      expect(branch.deleteDisabledReason).toBe('Cannot delete the checked out branch')
    })

    it('prioritizes trunk reason over current branch reason', () => {
      // If a branch is both trunk AND current, trunk reason should take precedence
      const repo = createRepoWithBranch({
        branchName: 'main',
        isTrunk: true,
        isCurrent: true
      })

      const branch = findBranch(repo, 'main')
      expect(branch.canDelete).toBe(false)
      expect(branch.deleteDisabledReason).toBe('Cannot delete trunk')
    })
  })

  describe('canRename', () => {
    it('allows renaming for local non-trunk branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'feature',
        isTrunk: false,
        isRemote: false
      })

      const branch = findBranch(repo, 'feature')
      expect(branch.canRename).toBe(true)
    })

    it('disallows renaming for trunk branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'main',
        isTrunk: true,
        isRemote: false
      })

      const branch = findBranch(repo, 'main')
      expect(branch.canRename).toBe(false)
    })

    it('disallows renaming for remote branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'origin/feature',
        isTrunk: false,
        isRemote: true
      })

      const branch = findBranch(repo, 'origin/feature')
      expect(branch.canRename).toBe(false)
    })
  })

  describe('canSquash and squashDisabledReason', () => {
    it('allows squash for local non-trunk branch with non-trunk parent', () => {
      // Create a stack: trunk -> parent-branch -> child-branch
      const root = createCommit({ sha: 'root', parentSha: '', childrenSha: ['parent-sha'] })
      const parentCommit = createCommit({
        sha: 'parent-sha',
        parentSha: 'root',
        childrenSha: ['child-sha']
      })
      const childCommit = createCommit({
        sha: 'child-sha',
        parentSha: 'parent-sha',
        childrenSha: []
      })

      const repo = createRepo({
        commits: [root, parentCommit, childCommit],
        branches: [
          createBranch({ ref: 'main', headSha: 'root', isTrunk: true }),
          createBranch({ ref: 'parent-branch', headSha: 'parent-sha', isTrunk: false }),
          createBranch({ ref: 'child-branch', headSha: 'child-sha', isTrunk: false })
        ],
        workingTreeStatus: createWorkingTreeStatus({ currentBranch: 'child-branch' })
      })

      const branch = findBranch(repo, 'child-branch')
      expect(branch.canSquash).toBe(true)
      expect(branch.squashDisabledReason).toBeUndefined()
    })

    it('disallows squash for remote branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'origin/feature',
        isTrunk: false,
        isRemote: true
      })

      const branch = findBranch(repo, 'origin/feature')
      expect(branch.canSquash).toBe(false)
      expect(branch.squashDisabledReason).toBe('Cannot squash remote branches')
    })

    it('disallows squash for trunk branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'main',
        isTrunk: true,
        isRemote: false
      })

      const branch = findBranch(repo, 'main')
      expect(branch.canSquash).toBe(false)
      expect(branch.squashDisabledReason).toBe('Cannot squash trunk branches')
    })

    it('disallows squash when parent commit is on trunk', () => {
      // Branch directly off trunk - parent commit is trunk commit
      const root = createCommit({ sha: 'root', parentSha: '', childrenSha: ['feature-sha'] })
      const featureCommit = createCommit({
        sha: 'feature-sha',
        parentSha: 'root',
        childrenSha: []
      })

      const repo = createRepo({
        commits: [root, featureCommit],
        branches: [
          createBranch({ ref: 'main', headSha: 'root', isTrunk: true }),
          createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false })
        ],
        workingTreeStatus: createWorkingTreeStatus({ currentBranch: 'feature' })
      })

      const branch = findBranch(repo, 'feature')
      expect(branch.canSquash).toBe(false)
      expect(branch.squashDisabledReason).toBe('Cannot squash: parent commit is on trunk')
    })
  })

  describe('canCreateWorktree', () => {
    it('allows worktree creation for local non-trunk branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'feature',
        isTrunk: false,
        isRemote: false
      })

      const branch = findBranch(repo, 'feature')
      expect(branch.canCreateWorktree).toBe(true)
    })

    it('disallows worktree creation for trunk branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'main',
        isTrunk: true,
        isRemote: false
      })

      const branch = findBranch(repo, 'main')
      expect(branch.canCreateWorktree).toBe(false)
    })

    it('disallows worktree creation for remote branch', () => {
      const repo = createRepoWithBranch({
        branchName: 'origin/feature',
        isTrunk: false,
        isRemote: true
      })

      const branch = findBranch(repo, 'origin/feature')
      expect(branch.canCreateWorktree).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface BranchScenario {
  branchName: string
  isTrunk?: boolean
  isRemote?: boolean
  isCurrent?: boolean
}

/**
 * Creates a minimal repo with a single branch for testing permissions.
 */
function createRepoWithBranch(scenario: BranchScenario): Repo {
  const { branchName, isTrunk = false, isRemote = false, isCurrent = false } = scenario

  const commit = createCommit({
    sha: 'commit-sha',
    parentSha: '',
    childrenSha: []
  })

  const branch = createBranch({
    ref: branchName,
    headSha: commit.sha,
    isTrunk,
    isRemote
  })

  // If this isn't trunk, we need a trunk branch for the repo to be valid
  const branches = isTrunk
    ? [branch]
    : [
        createBranch({ ref: 'main', headSha: commit.sha, isTrunk: true }),
        branch
      ]

  return createRepo({
    commits: [commit],
    branches,
    workingTreeStatus: createWorkingTreeStatus({
      currentBranch: isCurrent ? branchName : 'main',
      currentCommitSha: commit.sha
    })
  })
}

/**
 * Finds a branch by name in the built UI state.
 */
function findBranch(repo: Repo, branchName: string) {
  const stack = buildUiStack(repo)
  if (!stack) throw new Error('expected stack to be built')

  // Search all commits in all stacks for the branch
  const allBranches = collectAllBranches(stack)
  const branch = allBranches.find((b) => b.name === branchName)
  if (!branch) {
    throw new Error(`branch '${branchName}' not found in UI state`)
  }
  return branch
}

/**
 * Recursively collects all branches from all commits in all stacks.
 */
function collectAllBranches(stack: ReturnType<typeof buildUiStack>): Array<{
  name: string
  canDelete: boolean
  deleteDisabledReason?: string
  canRename: boolean
  canSquash: boolean
  squashDisabledReason?: string
  canCreateWorktree: boolean
}> {
  if (!stack) return []

  const branches: Array<{
    name: string
    canDelete: boolean
    deleteDisabledReason?: string
    canRename: boolean
    canSquash: boolean
    squashDisabledReason?: string
    canCreateWorktree: boolean
  }> = []

  for (const commit of stack.commits) {
    branches.push(...commit.branches)
    for (const spinoff of commit.spinoffs) {
      branches.push(...collectAllBranches(spinoff))
    }
  }

  return branches
}

function createRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    path: '/tmp/repo',
    activeWorktreePath: null,
    commits: [],
    branches: [],
    workingTreeStatus: createWorkingTreeStatus(),
    worktrees: [],
    ...overrides
  }
}

function createCommit(overrides: Partial<Commit> & { sha: string }): Commit {
  const { sha, ...rest } = overrides
  return {
    sha,
    message: '(no message)',
    timeMs: 0,
    parentSha: '',
    childrenSha: [],
    ...rest
  }
}

function createBranch(overrides: Partial<Branch> & { ref: string; headSha: string }): Branch {
  const { ref, headSha, ...rest } = overrides
  return {
    ref,
    headSha,
    isTrunk: false,
    isRemote: false,
    ...rest
  }
}

function createWorkingTreeStatus(overrides: Partial<WorkingTreeStatus> = {}): WorkingTreeStatus {
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
    allChangedFiles: [],
    ...overrides
  }
}
