import type { UiBranch } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getMergedBranchToCleanup } from '../get-merged-branch-to-cleanup.js'

const createBranch = (overrides: Partial<UiBranch> = {}): UiBranch => {
  const isCurrent = overrides.isCurrent ?? false
  const isRemote = overrides.isRemote ?? false
  const isTrunk = overrides.isTrunk ?? false

  return {
    name: 'feature-branch',
    isCurrent,
    isRemote,
    isTrunk,
    isMerged: false,
    // Compute permissions based on state (same logic as backend)
    canRename: !isRemote && !isTrunk,
    canDelete: !isCurrent && !isTrunk,
    canFold: !isRemote && !isTrunk,
    canCreateWorktree: !isRemote && !isTrunk,
    ...overrides
  }
}

describe('getMergedBranchToCleanup', () => {
  it('returns null when no branches', () => {
    expect(getMergedBranchToCleanup([])).toBeNull()
  })

  it('returns null when no merged branches', () => {
    const branches = [
      createBranch({ name: 'feature-1', isMerged: false }),
      createBranch({ name: 'feature-2', isMerged: false })
    ]
    expect(getMergedBranchToCleanup(branches)).toBeNull()
  })

  it('returns merged branch when one exists', () => {
    const mergedBranch = createBranch({ name: 'merged-feature', isMerged: true })
    const branches = [mergedBranch]

    expect(getMergedBranchToCleanup(branches)).toBe(mergedBranch)
  })

  it('returns null when only merged branch is current (checked out)', () => {
    const branches = [createBranch({ name: 'merged-feature', isMerged: true, isCurrent: true })]

    expect(getMergedBranchToCleanup(branches)).toBeNull()
  })

  it('returns first non-current merged branch when multiple exist', () => {
    const firstMerged = createBranch({ name: 'first-merged', isMerged: true })
    const secondMerged = createBranch({ name: 'second-merged', isMerged: true })
    const branches = [firstMerged, secondMerged]

    expect(getMergedBranchToCleanup(branches)).toBe(firstMerged)
  })

  it('skips current merged branch and returns next merged branch', () => {
    const currentMerged = createBranch({ name: 'current-merged', isMerged: true, isCurrent: true })
    const otherMerged = createBranch({ name: 'other-merged', isMerged: true })
    const branches = [currentMerged, otherMerged]

    expect(getMergedBranchToCleanup(branches)).toBe(otherMerged)
  })

  it('returns merged branch from mixed merged/non-merged branches', () => {
    const nonMerged = createBranch({ name: 'not-merged', isMerged: false })
    const merged = createBranch({ name: 'merged', isMerged: true })
    const branches = [nonMerged, merged]

    expect(getMergedBranchToCleanup(branches)).toBe(merged)
  })

  it('handles undefined isMerged as not merged', () => {
    const undefinedMerged = createBranch({ name: 'undefined-merged' })
    delete (undefinedMerged as Partial<UiBranch>).isMerged
    const branches = [undefinedMerged]

    expect(getMergedBranchToCleanup(branches)).toBeNull()
  })
})
