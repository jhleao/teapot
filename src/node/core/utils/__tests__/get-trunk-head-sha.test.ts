import type { Branch } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getTrunkHeadSha } from '../get-trunk-head-sha.js'

describe('getTrunkHeadSha', () => {
  it('returns the headSha of the local trunk branch', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'main', headSha: 'trunk-sha-123', isTrunk: true, isRemote: false }),
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(getTrunkHeadSha(branches)).toBe('trunk-sha-123')
  })

  it('prefers local trunk over remote trunk', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'main', headSha: 'local-sha', isTrunk: true, isRemote: false })
    ]

    expect(getTrunkHeadSha(branches)).toBe('local-sha')
  })

  it('falls back to remote trunk when no local trunk exists', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'origin/main', headSha: 'remote-sha', isTrunk: true, isRemote: true }),
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(getTrunkHeadSha(branches)).toBe('remote-sha')
  })

  it('returns empty string when no trunk branch exists', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'feature', headSha: 'feature-sha', isTrunk: false, isRemote: false })
    ]

    expect(getTrunkHeadSha(branches)).toBe('')
  })

  it('returns empty string when branches array is empty', () => {
    expect(getTrunkHeadSha([])).toBe('')
  })

  it('returns empty string when trunk has no headSha', () => {
    const branches: Branch[] = [
      createBranch({ ref: 'main', headSha: '', isTrunk: true, isRemote: false })
    ]

    expect(getTrunkHeadSha(branches)).toBe('')
  })
})

function createBranch(overrides: {
  ref: string
  headSha: string
  isTrunk: boolean
  isRemote: boolean
}): Branch {
  return {
    ref: overrides.ref,
    headSha: overrides.headSha,
    isTrunk: overrides.isTrunk,
    isRemote: overrides.isRemote
  }
}
