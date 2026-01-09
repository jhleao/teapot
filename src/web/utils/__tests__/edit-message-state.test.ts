import { describe, expect, it } from 'vitest'
import {
  getEditMessageDisabledReason,
  getEditMessageState,
  type EditMessageState
} from '../edit-message-state.js'

describe('getEditMessageState', () => {
  describe('basic cases', () => {
    it('returns canEdit: true for HEAD commit on non-trunk branch', () => {
      const result = getEditMessageState({ isHead: true, isTrunk: false })
      expect(result.canEdit).toBe(true)
      expect(result.disabledReason).toBeUndefined()
    })

    it('returns canEdit: false with reason "on-trunk" for trunk commits', () => {
      const result = getEditMessageState({ isHead: true, isTrunk: true })
      expect(result.canEdit).toBe(false)
      if (!result.canEdit) {
        expect(result.reason).toBe('on-trunk')
        expect(result.disabledReason).toBe('Cannot amend trunk commits')
      }
    })

    it('returns canEdit: false with reason "on-trunk" for non-HEAD trunk commits', () => {
      const result = getEditMessageState({ isHead: false, isTrunk: true })
      expect(result.canEdit).toBe(false)
      if (!result.canEdit) {
        expect(result.reason).toBe('on-trunk')
        expect(result.disabledReason).toBe('Cannot amend trunk commits')
      }
    })

    it('returns canEdit: false with reason "not-head" for non-HEAD commits on non-trunk', () => {
      const result = getEditMessageState({ isHead: false, isTrunk: false })
      expect(result.canEdit).toBe(false)
      if (!result.canEdit) {
        expect(result.reason).toBe('not-head')
        expect(result.disabledReason).toBe('Only the checked out commit can be amended')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes trunk check over head check', () => {
      // Even if it's HEAD, being on trunk should take precedence
      // This ensures the error message is accurate - trunk is the real blocker
      const result = getEditMessageState({ isHead: true, isTrunk: true })
      expect(result.canEdit).toBe(false)
      if (!result.canEdit) {
        expect(result.reason).toBe('on-trunk')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = { isHead: true, isTrunk: false }
      const result1 = getEditMessageState(input)
      const result2 = getEditMessageState(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = { isHead: true, isTrunk: false }
      const inputCopy = { ...input }
      getEditMessageState(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    // Test all 4 combinations to ensure complete coverage
    const testCases: Array<{
      isHead: boolean
      isTrunk: boolean
      expectedCanEdit: boolean
      expectedReason?: 'on-trunk' | 'not-head'
    }> = [
      { isHead: true, isTrunk: false, expectedCanEdit: true },
      { isHead: true, isTrunk: true, expectedCanEdit: false, expectedReason: 'on-trunk' },
      { isHead: false, isTrunk: false, expectedCanEdit: false, expectedReason: 'not-head' },
      { isHead: false, isTrunk: true, expectedCanEdit: false, expectedReason: 'on-trunk' }
    ]

    it.each(testCases)(
      'isHead=$isHead, isTrunk=$isTrunk => canEdit=$expectedCanEdit',
      ({ isHead, isTrunk, expectedCanEdit, expectedReason }) => {
        const result = getEditMessageState({ isHead, isTrunk })
        expect(result.canEdit).toBe(expectedCanEdit)
        if (!result.canEdit && expectedReason) {
          expect(result.reason).toBe(expectedReason)
        }
      }
    )
  })

  describe('disabledReason included in state', () => {
    it('includes disabledReason directly in state for disabled items', () => {
      const trunkResult = getEditMessageState({ isHead: true, isTrunk: true })
      expect(trunkResult.disabledReason).toBe('Cannot amend trunk commits')

      const notHeadResult = getEditMessageState({ isHead: false, isTrunk: false })
      expect(notHeadResult.disabledReason).toBe('Only the checked out commit can be amended')
    })

    it('includes undefined disabledReason for enabled items', () => {
      const result = getEditMessageState({ isHead: true, isTrunk: false })
      expect(result.disabledReason).toBeUndefined()
    })

    it('disabledReason matches what getEditMessageDisabledReason returns', () => {
      const states = [
        getEditMessageState({ isHead: true, isTrunk: false }),
        getEditMessageState({ isHead: true, isTrunk: true }),
        getEditMessageState({ isHead: false, isTrunk: false }),
        getEditMessageState({ isHead: false, isTrunk: true })
      ]

      for (const state of states) {
        expect(state.disabledReason).toBe(getEditMessageDisabledReason(state))
      }
    })
  })
})

describe('getEditMessageDisabledReason (deprecated)', () => {
  it('returns undefined when canEdit is true', () => {
    const state: EditMessageState = { canEdit: true, disabledReason: undefined }
    expect(getEditMessageDisabledReason(state)).toBeUndefined()
  })

  it('returns the disabledReason from state for on-trunk', () => {
    const state: EditMessageState = {
      canEdit: false,
      reason: 'on-trunk',
      disabledReason: 'Cannot amend trunk commits'
    }
    expect(getEditMessageDisabledReason(state)).toBe('Cannot amend trunk commits')
  })

  it('returns the disabledReason from state for not-head', () => {
    const state: EditMessageState = {
      canEdit: false,
      reason: 'not-head',
      disabledReason: 'Only the checked out commit can be amended'
    }
    expect(getEditMessageDisabledReason(state)).toBe('Only the checked out commit can be amended')
  })

  it('messages are non-empty strings when disabled', () => {
    const onTrunkState = getEditMessageState({ isHead: true, isTrunk: true })
    const notHeadState = getEditMessageState({ isHead: false, isTrunk: false })

    expect(onTrunkState.disabledReason).toBeTruthy()
    expect(typeof onTrunkState.disabledReason).toBe('string')
    expect(onTrunkState.disabledReason!.length).toBeGreaterThan(0)

    expect(notHeadState.disabledReason).toBeTruthy()
    expect(typeof notHeadState.disabledReason).toBe('string')
    expect(notHeadState.disabledReason!.length).toBeGreaterThan(0)
  })

  it('messages are distinct for different reasons', () => {
    const onTrunkState = getEditMessageState({ isHead: true, isTrunk: true })
    const notHeadState = getEditMessageState({ isHead: false, isTrunk: false })

    expect(onTrunkState.disabledReason).not.toBe(notHeadState.disabledReason)
  })
})
