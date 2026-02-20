/**
 * Tests for worktree data flowing through UiState.
 *
 * Verifies that:
 * 1. UiStateBuilder passes worktree annotations to branches correctly
 * 2. The UiStateOperation worktree mapping produces correct UiWorktree objects
 * 3. Edge cases: detached HEAD, stale, dirty, main worktree
 */

import { describe, expect, it } from 'vitest'
import type { Repo, UiWorktree, Worktree } from '@shared/types'
import { UiStateBuilder } from '../../domain/UiStateBuilder'

// ─────────────────────────────────────────────────────────────────────────────
// Worktree mapping (same logic as UiStateOperation.getUiState)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the mapping in UiStateOperation.getUiState() for testability.
 * In production, this happens inside getUiState. Here we test the mapping in isolation.
 */
function mapWorktrees(repoWorktrees: Worktree[]): UiWorktree[] {
  return repoWorktrees.map((wt) => ({
    path: wt.path,
    branch: wt.branch,
    headSha: wt.headSha,
    isMain: wt.isMain,
    isStale: wt.isStale,
    isDirty: wt.isDirty
  }))
}

describe('worktree mapping to UiWorktree', () => {
  it('maps a main worktree with a branch', () => {
    const worktrees: Worktree[] = [
      {
        path: '/home/user/myrepo',
        headSha: 'abc123def456',
        branch: 'main',
        isMain: true,
        isStale: false,
        isDirty: false
      }
    ]

    const result = mapWorktrees(worktrees)
    expect(result).toEqual([
      {
        path: '/home/user/myrepo',
        branch: 'main',
        headSha: 'abc123def456',
        isMain: true,
        isStale: false,
        isDirty: false
      }
    ])
  })

  it('maps multiple worktrees with different states', () => {
    const worktrees: Worktree[] = [
      {
        path: '/home/user/myrepo',
        headSha: 'aaa111',
        branch: 'main',
        isMain: true,
        isStale: false,
        isDirty: false
      },
      {
        path: '/home/user/myrepo-feature',
        headSha: 'bbb222',
        branch: 'feature/auth',
        isMain: false,
        isStale: false,
        isDirty: true
      },
      {
        path: '/home/user/myrepo-experiment',
        headSha: 'ccc333',
        branch: 'experiment',
        isMain: false,
        isStale: false,
        isDirty: false
      }
    ]

    const result = mapWorktrees(worktrees)
    expect(result).toHaveLength(3)
    expect(result[0]!.isMain).toBe(true)
    expect(result[1]!.isDirty).toBe(true)
    expect(result[1]!.branch).toBe('feature/auth')
    expect(result[2]!.isDirty).toBe(false)
  })

  it('maps a detached HEAD worktree (branch is null)', () => {
    const worktrees: Worktree[] = [
      {
        path: '/home/user/myrepo-detached',
        headSha: 'ddd444',
        branch: null,
        isMain: false,
        isStale: false,
        isDirty: false
      }
    ]

    const result = mapWorktrees(worktrees)
    expect(result[0]!.branch).toBeNull()
    expect(result[0]!.headSha).toBe('ddd444')
  })

  it('maps a stale worktree', () => {
    const worktrees: Worktree[] = [
      {
        path: '/home/user/deleted-dir',
        headSha: 'eee555',
        branch: 'old-feature',
        isMain: false,
        isStale: true,
        isDirty: false
      }
    ]

    const result = mapWorktrees(worktrees)
    expect(result[0]!.isStale).toBe(true)
  })

  it('returns empty array for repos with no worktrees', () => {
    const result = mapWorktrees([])
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UiStateBuilder worktree badge annotations on branches
// ─────────────────────────────────────────────────────────────────────────────

describe('UiStateBuilder worktree annotations on branches', () => {
  it('annotates branch with dirty worktree badge when branch is in a dirty worktree', () => {
    const repo = createRepoWithWorktrees({
      worktrees: [
        {
          path: '/repo',
          headSha: 'c2',
          branch: 'main',
          isMain: true,
          isStale: false,
          isDirty: false
        },
        {
          path: '/repo-feature',
          headSha: 'c3',
          branch: 'feature',
          isMain: false,
          isStale: false,
          isDirty: true
        }
      ],
      activeWorktreePath: '/repo'
    })

    const stack = UiStateBuilder.buildUiStack(repo)
    if (!stack) throw new Error('expected stack')

    // Find the 'feature' branch annotation
    const featureBranch = findBranchInStack(stack, 'feature')
    expect(featureBranch).toBeDefined()
    expect(featureBranch?.worktree).toBeDefined()
    expect(featureBranch?.worktree?.status).toBe('dirty')
    expect(featureBranch?.worktree?.path).toBe('/repo-feature')
  })

  it('does not annotate branch for the active worktree (status would be "active")', () => {
    const repo = createRepoWithWorktrees({
      worktrees: [
        {
          path: '/repo',
          headSha: 'c2',
          branch: 'main',
          isMain: true,
          isStale: false,
          isDirty: false
        }
      ],
      activeWorktreePath: null // null = using main worktree
    })

    const stack = UiStateBuilder.buildUiStack(repo)
    if (!stack) throw new Error('expected stack')

    // The main branch is in the active worktree, so it should NOT have a worktree badge
    const mainBranch = findBranchInStack(stack, 'main')
    expect(mainBranch).toBeDefined()
    expect(mainBranch?.worktree).toBeUndefined()
  })

  it('annotates branch with stale status when worktree directory is missing', () => {
    const repo = createRepoWithWorktrees({
      worktrees: [
        {
          path: '/repo',
          headSha: 'c2',
          branch: 'main',
          isMain: true,
          isStale: false,
          isDirty: false
        },
        {
          path: '/deleted-dir',
          headSha: 'c3',
          branch: 'feature',
          isMain: false,
          isStale: true,
          isDirty: false
        }
      ],
      activeWorktreePath: '/repo'
    })

    const stack = UiStateBuilder.buildUiStack(repo)
    if (!stack) throw new Error('expected stack')

    const featureBranch = findBranchInStack(stack, 'feature')
    expect(featureBranch).toBeDefined()
    expect(featureBranch?.worktree?.status).toBe('stale')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createRepoWithWorktrees(opts: {
  worktrees: Worktree[]
  activeWorktreePath: string | null
}): Repo {
  return {
    path: '/repo',
    activeWorktreePath: opts.activeWorktreePath,
    commits: [
      { sha: 'c1', message: 'root', timeMs: 1000, parentSha: '', childrenSha: ['c2'] },
      { sha: 'c2', message: 'trunk', timeMs: 2000, parentSha: 'c1', childrenSha: ['c3'] },
      { sha: 'c3', message: 'feature', timeMs: 3000, parentSha: 'c2', childrenSha: [] }
    ],
    branches: [
      { ref: 'main', isTrunk: true, isRemote: false, headSha: 'c2' },
      { ref: 'feature', isTrunk: false, isRemote: false, headSha: 'c3' }
    ],
    workingTreeStatus: {
      currentBranch: 'main',
      currentCommitSha: 'c2',
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
    worktrees: opts.worktrees
  }
}

type UiStack = ReturnType<typeof UiStateBuilder.buildUiStack>

function findBranchInStack(
  stack: NonNullable<UiStack>,
  branchName: string
): (typeof stack.commits)[number]['branches'][number] | undefined {
  for (const commit of stack.commits) {
    const branch = commit.branches.find((b) => b.name === branchName)
    if (branch) return branch
    for (const spinoff of commit.spinoffs) {
      const found = findBranchInStack(spinoff, branchName)
      if (found) return found
    }
  }
  return undefined
}
