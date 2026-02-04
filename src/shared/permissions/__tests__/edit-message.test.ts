import { describe, expect, it } from 'vitest'
import { getEditMessagePermission, type EditMessagePermission } from '../edit-message'

describe('getEditMessagePermission', () => {
  describe('basic cases', () => {
    it('returns allowed: true for HEAD commit not on trunk', () => {
      const result = getEditMessagePermission({ isHead: true, isTrunk: false })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: false with reason "is-trunk" for trunk commits', () => {
      const result = getEditMessagePermission({ isHead: true, isTrunk: true })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
        expect(result.deniedReason).toBe('Cannot amend trunk commits')
      }
    })

    it('returns allowed: false with reason "not-head" for non-HEAD commits', () => {
      const result = getEditMessagePermission({ isHead: false, isTrunk: false })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('not-head')
        expect(result.deniedReason).toBe('Only the checked out commit can be amended')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes trunk check over head check', () => {
      // If both trunk and not HEAD, trunk reason should be shown
      // (trunk commits are never editable, regardless of HEAD status)
      const result = getEditMessagePermission({ isHead: false, isTrunk: true })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = { isHead: true, isTrunk: false }
      const result1 = getEditMessagePermission(input)
      const result2 = getEditMessagePermission(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = { isHead: false, isTrunk: true }
      const inputCopy = { ...input }
      getEditMessagePermission(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    // Test all 4 combinations to ensure complete coverage
    const testCases: Array<{
      isHead: boolean
      isTrunk: boolean
      expectedAllowed: boolean
      expectedReason?: 'is-trunk' | 'not-head'
    }> = [
      { isHead: true, isTrunk: false, expectedAllowed: true },
      { isHead: true, isTrunk: true, expectedAllowed: false, expectedReason: 'is-trunk' },
      { isHead: false, isTrunk: false, expectedAllowed: false, expectedReason: 'not-head' },
      { isHead: false, isTrunk: true, expectedAllowed: false, expectedReason: 'is-trunk' }
    ]

    it.each(testCases)(
      'isHead=$isHead, isTrunk=$isTrunk => allowed=$expectedAllowed',
      ({ isHead, isTrunk, expectedAllowed, expectedReason }) => {
        const result = getEditMessagePermission({ isHead, isTrunk })
        expect(result.allowed).toBe(expectedAllowed)
        if (!result.allowed && expectedReason) {
          expect(result.reason).toBe(expectedReason)
        }
      }
    )
  })

  describe('deniedReason messages', () => {
    it('includes deniedReason directly in result for denied permissions', () => {
      const trunkResult = getEditMessagePermission({ isHead: true, isTrunk: true })
      expect(trunkResult.deniedReason).toBe('Cannot amend trunk commits')

      const headResult = getEditMessagePermission({ isHead: false, isTrunk: false })
      expect(headResult.deniedReason).toBe('Only the checked out commit can be amended')
    })

    it('includes undefined deniedReason for allowed permissions', () => {
      const result = getEditMessagePermission({ isHead: true, isTrunk: false })
      expect(result.deniedReason).toBeUndefined()
    })

    it('messages are non-empty strings when denied', () => {
      const trunkResult = getEditMessagePermission({ isHead: true, isTrunk: true })
      const headResult = getEditMessagePermission({ isHead: false, isTrunk: false })

      expect(trunkResult.deniedReason).toBeTruthy()
      expect(typeof trunkResult.deniedReason).toBe('string')
      expect(trunkResult.deniedReason!.length).toBeGreaterThan(0)

      expect(headResult.deniedReason).toBeTruthy()
      expect(typeof headResult.deniedReason).toBe('string')
      expect(headResult.deniedReason!.length).toBeGreaterThan(0)
    })

    it('messages are distinct for different reasons', () => {
      const trunkResult = getEditMessagePermission({ isHead: true, isTrunk: true })
      const headResult = getEditMessagePermission({ isHead: false, isTrunk: false })

      expect(trunkResult.deniedReason).not.toBe(headResult.deniedReason)
    })
  })

  describe('type safety', () => {
    it('allowed result has correct type shape', () => {
      const result: EditMessagePermission = getEditMessagePermission({
        isHead: true,
        isTrunk: false
      })

      if (result.allowed) {
        // TypeScript should know deniedReason is undefined here
        expect(result.deniedReason).toBeUndefined()
        // @ts-expect-error - reason should not exist on allowed result
        expect(result.reason).toBeUndefined()
      }
    })

    it('denied result has correct type shape', () => {
      const result: EditMessagePermission = getEditMessagePermission({
        isHead: true,
        isTrunk: true
      })

      if (!result.allowed) {
        // TypeScript should know these exist here
        expect(result.reason).toBeDefined()
        expect(result.deniedReason).toBeDefined()
      }
    })
  })
})
