import { describe, expect, it } from 'vitest'
import { canRebase } from '../can-rebase.js'

describe('canRebase', () => {
  it('returns true when spinoff base is not trunk head and working tree is clean', () => {
    expect(
      canRebase({
        baseSha: 'old-trunk-sha',
        trunkHeadSha: 'trunk-head-sha',
        isWorkingTreeDirty: false
      })
    ).toBe(true)
  })

  it('returns false when spinoff base is already trunk head (already rebased)', () => {
    expect(
      canRebase({
        baseSha: 'trunk-head-sha',
        trunkHeadSha: 'trunk-head-sha',
        isWorkingTreeDirty: false
      })
    ).toBe(false)
  })

  it('returns false when working tree is dirty', () => {
    expect(
      canRebase({
        baseSha: 'old-trunk-sha',
        trunkHeadSha: 'trunk-head-sha',
        isWorkingTreeDirty: true
      })
    ).toBe(false)
  })

  it('returns false when spinoff base is trunk head and working tree is dirty', () => {
    expect(
      canRebase({
        baseSha: 'trunk-head-sha',
        trunkHeadSha: 'trunk-head-sha',
        isWorkingTreeDirty: true
      })
    ).toBe(false)
  })

  it('returns false when trunkHeadSha is empty', () => {
    expect(
      canRebase({
        baseSha: 'old-trunk-sha',
        trunkHeadSha: '',
        isWorkingTreeDirty: false
      })
    ).toBe(false)
  })

  it('returns false when baseSha is empty', () => {
    expect(
      canRebase({
        baseSha: '',
        trunkHeadSha: 'trunk-head-sha',
        isWorkingTreeDirty: false
      })
    ).toBe(false)
  })
})
