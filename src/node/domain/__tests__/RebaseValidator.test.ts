/**
 * RebaseValidator Tests
 *
 * Tests for pure validation logic of rebase operations.
 * All functions are synchronous and operate on data only.
 */

import type { RebaseIntent, RebaseTarget, StackNodeState, WorktreeConflict } from '@shared/types'
import type { WorkingTreeStatus, Worktree } from '@shared/types/repo'
import { describe, expect, it } from 'vitest'
import { RebaseValidator, type ValidationResult } from '../RebaseValidator'

describe('RebaseValidator', () => {
  describe('validateIntentStructure', () => {
    it('returns valid for intent with targets', () => {
      const intent = createIntent([createTarget('feature', 'head', 'base', 'target')])

      const result = RebaseValidator.validateIntentStructure(intent)

      expect(result.valid).toBe(true)
    })

    it('returns invalid for empty targets', () => {
      const intent = createIntent([])

      const result = RebaseValidator.validateIntentStructure(intent)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('INVALID_INTENT')
        expect(result.message).toContain('no targets')
      }
    })
  })

  describe('validateCleanWorkingTree', () => {
    it('returns valid for clean working tree', () => {
      const status = createWorkingTreeStatus()

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when files are staged', () => {
      const status = createWorkingTreeStatus({ staged: ['file.ts'] })

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('DIRTY_WORKING_TREE')
        expect(result.message).toContain('uncommitted changes')
        expect(result.message).toContain('file.ts')
      }
    })

    it('returns invalid when files are modified', () => {
      const status = createWorkingTreeStatus({ modified: ['src/index.ts', 'src/utils.ts'] })

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('DIRTY_WORKING_TREE')
        expect(result.message).toContain('src/index.ts')
      }
    })

    it('returns invalid when files are deleted', () => {
      const status = createWorkingTreeStatus({ deleted: ['old-file.ts'] })

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('DIRTY_WORKING_TREE')
      }
    })

    it('returns invalid when files are conflicted', () => {
      const status = createWorkingTreeStatus({ conflicted: ['merge-conflict.ts'] })

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('DIRTY_WORKING_TREE')
      }
    })

    it('truncates file list when many changes', () => {
      const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
      const status = createWorkingTreeStatus({ modified: files })

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.message).toContain('and 7 more')
      }
    })

    it('allows untracked files (not_added)', () => {
      const status = createWorkingTreeStatus({ not_added: ['new-file.ts'] })

      const result = RebaseValidator.validateCleanWorkingTree(status)

      expect(result.valid).toBe(true)
    })
  })

  describe('validateNoRebaseInProgress', () => {
    it('returns valid when no rebase in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: false })

      const result = RebaseValidator.validateNoRebaseInProgress(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when rebase in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: true })

      const result = RebaseValidator.validateNoRebaseInProgress(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('REBASE_IN_PROGRESS')
        expect(result.message).toContain('already in progress')
      }
    })
  })

  describe('validateNotDetached', () => {
    it('returns valid when not detached', () => {
      const status = createWorkingTreeStatus({ detached: false })

      const result = RebaseValidator.validateNotDetached(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when HEAD is detached', () => {
      const status = createWorkingTreeStatus({ detached: true })

      const result = RebaseValidator.validateNotDetached(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('DETACHED_HEAD')
        expect(result.message).toContain('detached HEAD')
      }
    })
  })

  describe('validateBranchNotMoved', () => {
    it('returns valid when branch has not moved', () => {
      const target = createTarget('feature', 'abc123', 'base', 'target')

      const result = RebaseValidator.validateBranchNotMoved(target, 'abc123')

      expect(result.valid).toBe(true)
    })

    it('returns invalid when branch has moved', () => {
      const target = createTarget('feature', 'abc123', 'base', 'target')

      const result = RebaseValidator.validateBranchNotMoved(target, 'def456')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('BRANCH_MOVED')
        expect(result.message).toContain('feature')
        expect(result.message).toContain('abc123'.slice(0, 8))
        expect(result.message).toContain('def456'.slice(0, 8))
      }
    })
  })

  describe('validateNotSameBase', () => {
    it('returns valid when target is different from current base', () => {
      const target = createTarget('feature', 'head', 'current-base', 'new-base')

      const result = RebaseValidator.validateNotSameBase(target)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when target is same as current base', () => {
      const target = createTarget('feature', 'head', 'same-base', 'same-base')

      const result = RebaseValidator.validateNotSameBase(target)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('SAME_BASE')
        expect(result.message).toContain('feature')
        expect(result.message).toContain('already based on')
      }
    })
  })

  describe('validateConflictsResolved', () => {
    it('returns valid when no conflicts', () => {
      const status = createWorkingTreeStatus({ conflicted: [] })

      const result = RebaseValidator.validateConflictsResolved(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when conflicts exist', () => {
      const status = createWorkingTreeStatus({ conflicted: ['file1.ts', 'file2.ts'] })

      const result = RebaseValidator.validateConflictsResolved(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('CONFLICTS_UNRESOLVED')
        expect(result.message).toContain('file1.ts')
        expect(result.message).toContain('file2.ts')
      }
    })
  })

  describe('validateRebaseInProgress', () => {
    it('returns valid when rebase is in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: true })

      const result = RebaseValidator.validateRebaseInProgress(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when no rebase in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: false })

      const result = RebaseValidator.validateRebaseInProgress(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('REBASE_IN_PROGRESS')
      }
    })
  })

  describe('validateCanContinueRebase', () => {
    it('returns valid when rebase in progress and no conflicts', () => {
      const status = createWorkingTreeStatus({ isRebasing: true, conflicted: [] })

      const result = RebaseValidator.validateCanContinueRebase(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when no rebase in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: false })

      const result = RebaseValidator.validateCanContinueRebase(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('REBASE_IN_PROGRESS')
      }
    })

    it('returns invalid when conflicts unresolved', () => {
      const status = createWorkingTreeStatus({
        isRebasing: true,
        conflicted: ['conflict.ts']
      })

      const result = RebaseValidator.validateCanContinueRebase(status)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('CONFLICTS_UNRESOLVED')
      }
    })
  })

  describe('validateCanAbortRebase', () => {
    it('returns valid when rebase in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: true })

      const result = RebaseValidator.validateCanAbortRebase(status)

      expect(result.valid).toBe(true)
    })

    it('returns invalid when no rebase in progress', () => {
      const status = createWorkingTreeStatus({ isRebasing: false })

      const result = RebaseValidator.validateCanAbortRebase(status)

      expect(result.valid).toBe(false)
    })
  })

  describe('combineValidations', () => {
    it('returns valid when all validations pass', () => {
      const results: ValidationResult[] = [{ valid: true }, { valid: true }, { valid: true }]

      const combined = RebaseValidator.combineValidations(...results)

      expect(combined.valid).toBe(true)
    })

    it('returns first failure when multiple fail', () => {
      const results: ValidationResult[] = [
        { valid: true },
        { valid: false, code: 'DIRTY_WORKING_TREE', message: 'First error' },
        { valid: false, code: 'REBASE_IN_PROGRESS', message: 'Second error' }
      ]

      const combined = RebaseValidator.combineValidations(...results)

      expect(combined.valid).toBe(false)
      if (!combined.valid) {
        expect(combined.code).toBe('DIRTY_WORKING_TREE')
        expect(combined.message).toBe('First error')
      }
    })

    it('returns valid for empty array', () => {
      const combined = RebaseValidator.combineValidations()

      expect(combined.valid).toBe(true)
    })
  })

  describe('validateNoWorktreeConflicts', () => {
    it('returns valid when no other worktrees exist', () => {
      const intent = createIntent([createTarget('feature', 'head', 'base', 'target')])
      const worktrees: Worktree[] = [createWorktree('/repo', 'main', false)]

      const result = RebaseValidator.validateNoWorktreeConflicts(intent, worktrees, '/repo')

      expect(result.valid).toBe(true)
    })

    it('returns valid when other worktrees have unrelated branches', () => {
      const intent = createIntent([createTarget('feature', 'head', 'base', 'target')])
      const worktrees: Worktree[] = [
        createWorktree('/repo', 'main', false),
        createWorktree('/repo-wt', 'unrelated-branch', false)
      ]

      const result = RebaseValidator.validateNoWorktreeConflicts(intent, worktrees, '/repo')

      expect(result.valid).toBe(true)
    })

    it('returns invalid when target branch is checked out in another worktree', () => {
      const intent = createIntent([createTarget('feature', 'head', 'base', 'target')])
      const worktrees: Worktree[] = [
        createWorktree('/repo', 'main', false),
        createWorktree('/repo-wt', 'feature', false)
      ]

      const result = RebaseValidator.validateNoWorktreeConflicts(intent, worktrees, '/repo')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.code).toBe('WORKTREE_CONFLICT')
        expect(result.conflicts).toHaveLength(1)
        expect(result.conflicts[0]!.branch).toBe('feature')
        expect(result.conflicts[0]!.worktreePath).toBe('/repo-wt')
      }
    })

    it('detects conflicts in child branches', () => {
      const childNode = createStackNode('child', 'child-head', 'feature-head', [])
      const parentNode = createStackNode('feature', 'feature-head', 'base', [childNode])
      const intent = createIntent([{ node: parentNode, targetBaseSha: 'target' }])
      const worktrees: Worktree[] = [
        createWorktree('/repo', 'main', false),
        createWorktree('/repo-wt', 'child', false)
      ]

      const result = RebaseValidator.validateNoWorktreeConflicts(intent, worktrees, '/repo')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.conflicts.some((c) => c.branch === 'child')).toBe(true)
      }
    })

    it('ignores active worktree in conflict detection', () => {
      const intent = createIntent([createTarget('feature', 'head', 'base', 'target')])
      const worktrees: Worktree[] = [
        createWorktree('/repo', 'feature', false) // Active worktree has the branch
      ]

      const result = RebaseValidator.validateNoWorktreeConflicts(intent, worktrees, '/repo')

      expect(result.valid).toBe(true)
    })

    it('tracks dirty status of conflicting worktrees', () => {
      const intent = createIntent([createTarget('feature', 'head', 'base', 'target')])
      const worktrees: Worktree[] = [
        createWorktree('/repo', 'main', false),
        createWorktree('/repo-wt', 'feature', true) // Dirty worktree
      ]

      const result = RebaseValidator.validateNoWorktreeConflicts(intent, worktrees, '/repo')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.conflicts[0]!.isDirty).toBe(true)
      }
    })
  })

  describe('formatWorktreeConflictMessage', () => {
    it('formats single conflict message', () => {
      const conflicts: WorktreeConflict[] = [
        { branch: 'feature', worktreePath: '/wt', isDirty: false }
      ]

      const message = RebaseValidator.formatWorktreeConflictMessage(conflicts)

      expect(message).toContain('feature')
      expect(message).toContain('checked out in another worktree')
    })

    it('formats multiple conflicts in same worktree', () => {
      const conflicts: WorktreeConflict[] = [
        { branch: 'feature-1', worktreePath: '/wt', isDirty: false },
        { branch: 'feature-2', worktreePath: '/wt', isDirty: false }
      ]

      const message = RebaseValidator.formatWorktreeConflictMessage(conflicts)

      expect(message).toContain('2 branches')
      expect(message).not.toContain('worktrees') // Singular worktree
    })

    it('formats multiple conflicts in multiple worktrees', () => {
      const conflicts: WorktreeConflict[] = [
        { branch: 'feature-1', worktreePath: '/wt1', isDirty: false },
        { branch: 'feature-2', worktreePath: '/wt2', isDirty: false }
      ]

      const message = RebaseValidator.formatWorktreeConflictMessage(conflicts)

      expect(message).toContain('2 branches')
      expect(message).toContain('2 other worktrees')
    })

    it('returns empty string for no conflicts', () => {
      const message = RebaseValidator.formatWorktreeConflictMessage([])

      expect(message).toBe('')
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

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

function createIntent(targets: RebaseTarget[]): RebaseIntent {
  return {
    id: `intent-${Date.now()}`,
    createdAtMs: Date.now(),
    targets
  }
}

function createTarget(
  branch: string,
  headSha: string,
  baseSha: string,
  targetBaseSha: string
): RebaseTarget {
  return {
    node: createStackNode(branch, headSha, baseSha, []),
    targetBaseSha
  }
}

function createStackNode(
  branch: string,
  headSha: string,
  baseSha: string,
  children: StackNodeState[]
): StackNodeState {
  return {
    branch,
    headSha,
    baseSha,
    ownedShas: [headSha],
    children
  }
}

function createWorktree(path: string, branch: string | null, isDirty: boolean): Worktree {
  return {
    path,
    branch,
    headSha: 'abc123',
    isMain: path === '/repo',
    isStale: false,
    isDirty
  }
}
