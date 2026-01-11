import { describe, expect, it } from 'vitest'
import { getDeleteBranchPermission, type DeleteBranchPermission } from '../delete-branch'

describe('getDeleteBranchPermission', () => {
  describe('basic cases', () => {
    it('returns allowed: true for non-trunk, non-current branch', () => {
      const result = getDeleteBranchPermission({ isTrunk: false, isCurrent: false })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: false with reason "is-trunk" for trunk branches', () => {
      const result = getDeleteBranchPermission({ isTrunk: true, isCurrent: false })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
        expect(result.deniedReason).toBe('Cannot delete trunk')
      }
    })

    it('returns allowed: false with reason "is-checked-out" for current branch', () => {
      const result = getDeleteBranchPermission({ isTrunk: false, isCurrent: true })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-checked-out')
        expect(result.deniedReason).toBe('Cannot delete the checked out branch')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes trunk check over current check', () => {
      // If both trunk and current, trunk reason should be shown
      // (though this is an edge case - trunk is rarely checked out)
      const result = getDeleteBranchPermission({ isTrunk: true, isCurrent: true })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = { isTrunk: false, isCurrent: false }
      const result1 = getDeleteBranchPermission(input)
      const result2 = getDeleteBranchPermission(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = { isTrunk: false, isCurrent: true }
      const inputCopy = { ...input }
      getDeleteBranchPermission(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    // Test all 4 combinations to ensure complete coverage
    const testCases: Array<{
      isTrunk: boolean
      isCurrent: boolean
      expectedAllowed: boolean
      expectedReason?: 'is-trunk' | 'is-checked-out'
    }> = [
      { isTrunk: false, isCurrent: false, expectedAllowed: true },
      { isTrunk: true, isCurrent: false, expectedAllowed: false, expectedReason: 'is-trunk' },
      { isTrunk: false, isCurrent: true, expectedAllowed: false, expectedReason: 'is-checked-out' },
      { isTrunk: true, isCurrent: true, expectedAllowed: false, expectedReason: 'is-trunk' }
    ]

    it.each(testCases)(
      'isTrunk=$isTrunk, isCurrent=$isCurrent => allowed=$expectedAllowed',
      ({ isTrunk, isCurrent, expectedAllowed, expectedReason }) => {
        const result = getDeleteBranchPermission({ isTrunk, isCurrent })
        expect(result.allowed).toBe(expectedAllowed)
        if (!result.allowed && expectedReason) {
          expect(result.reason).toBe(expectedReason)
        }
      }
    )
  })

  describe('deniedReason messages', () => {
    it('includes deniedReason directly in result for denied permissions', () => {
      const trunkResult = getDeleteBranchPermission({ isTrunk: true, isCurrent: false })
      expect(trunkResult.deniedReason).toBe('Cannot delete trunk')

      const currentResult = getDeleteBranchPermission({ isTrunk: false, isCurrent: true })
      expect(currentResult.deniedReason).toBe('Cannot delete the checked out branch')
    })

    it('includes undefined deniedReason for allowed permissions', () => {
      const result = getDeleteBranchPermission({ isTrunk: false, isCurrent: false })
      expect(result.deniedReason).toBeUndefined()
    })

    it('messages are non-empty strings when denied', () => {
      const trunkResult = getDeleteBranchPermission({ isTrunk: true, isCurrent: false })
      const currentResult = getDeleteBranchPermission({ isTrunk: false, isCurrent: true })

      expect(trunkResult.deniedReason).toBeTruthy()
      expect(typeof trunkResult.deniedReason).toBe('string')
      expect(trunkResult.deniedReason!.length).toBeGreaterThan(0)

      expect(currentResult.deniedReason).toBeTruthy()
      expect(typeof currentResult.deniedReason).toBe('string')
      expect(currentResult.deniedReason!.length).toBeGreaterThan(0)
    })

    it('messages are distinct for different reasons', () => {
      const trunkResult = getDeleteBranchPermission({ isTrunk: true, isCurrent: false })
      const currentResult = getDeleteBranchPermission({ isTrunk: false, isCurrent: true })

      expect(trunkResult.deniedReason).not.toBe(currentResult.deniedReason)
    })
  })

  describe('type safety', () => {
    it('allowed result has correct type shape', () => {
      const result: DeleteBranchPermission = getDeleteBranchPermission({
        isTrunk: false,
        isCurrent: false
      })

      if (result.allowed) {
        // TypeScript should know deniedReason is undefined here
        expect(result.deniedReason).toBeUndefined()
        // @ts-expect-error - reason should not exist on allowed result
        expect(result.reason).toBeUndefined()
      }
    })

    it('denied result has correct type shape', () => {
      const result: DeleteBranchPermission = getDeleteBranchPermission({
        isTrunk: true,
        isCurrent: false
      })

      if (!result.allowed) {
        // TypeScript should know these exist here
        expect(result.reason).toBeDefined()
        expect(result.deniedReason).toBeDefined()
      }
    })
  })
})
