import { describe, expect, it } from 'vitest'
import { canRebase } from '../can-rebase.js'

describe('canRebase', () => {
  it('returns true when commit is not on trunk head and working tree is clean', () => {
    expect(
      canRebase({
        commitSha: 'feature-sha',
        trunkHeadSha: 'trunk-sha',
        isWorkingTreeDirty: false
      })
    ).toBe(true)
  })

  it('returns false when commit is already on trunk head', () => {
    expect(
      canRebase({
        commitSha: 'same-sha',
        trunkHeadSha: 'same-sha',
        isWorkingTreeDirty: false
      })
    ).toBe(false)
  })

  it('returns false when working tree is dirty', () => {
    expect(
      canRebase({
        commitSha: 'feature-sha',
        trunkHeadSha: 'trunk-sha',
        isWorkingTreeDirty: true
      })
    ).toBe(false)
  })

  it('returns false when both commit is on trunk and working tree is dirty', () => {
    expect(
      canRebase({
        commitSha: 'same-sha',
        trunkHeadSha: 'same-sha',
        isWorkingTreeDirty: true
      })
    ).toBe(false)
  })

  it('returns false when trunkHeadSha is empty', () => {
    expect(
      canRebase({
        commitSha: 'feature-sha',
        trunkHeadSha: '',
        isWorkingTreeDirty: false
      })
    ).toBe(false)
  })

  it('returns false when commitSha is empty', () => {
    expect(
      canRebase({
        commitSha: '',
        trunkHeadSha: 'trunk-sha',
        isWorkingTreeDirty: false
      })
    ).toBe(false)
  })
})
