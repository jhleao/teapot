import { describe, expect, it } from 'vitest'
import { getRenameBranchPermission, type RenameBranchPermission } from '../rename-branch'

describe('getRenameBranchPermission', () => {
  describe('basic cases', () => {
    it('returns allowed: true for non-trunk, non-remote branch', () => {
      const result = getRenameBranchPermission({ isTrunk: false, isRemote: false })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: false with reason "is-trunk" for trunk branches', () => {
      const result = getRenameBranchPermission({ isTrunk: true, isRemote: false })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
        expect(result.deniedReason).toBe('Cannot rename trunk branches')
      }
    })

    it('returns allowed: false with reason "is-remote" for remote branches', () => {
      const result = getRenameBranchPermission({ isTrunk: false, isRemote: true })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-remote')
        expect(result.deniedReason).toBe('Cannot rename remote branches')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes trunk check over remote check', () => {
      // If both trunk and remote, trunk reason should be shown
      // (though this is common for origin/main)
      const result = getRenameBranchPermission({ isTrunk: true, isRemote: true })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = { isTrunk: false, isRemote: false }
      const result1 = getRenameBranchPermission(input)
      const result2 = getRenameBranchPermission(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = { isTrunk: false, isRemote: true }
      const inputCopy = { ...input }
      getRenameBranchPermission(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    // Test all 4 combinations to ensure complete coverage
    const testCases: Array<{
      isTrunk: boolean
      isRemote: boolean
      expectedAllowed: boolean
      expectedReason?: 'is-trunk' | 'is-remote'
    }> = [
      { isTrunk: false, isRemote: false, expectedAllowed: true },
      { isTrunk: true, isRemote: false, expectedAllowed: false, expectedReason: 'is-trunk' },
      { isTrunk: false, isRemote: true, expectedAllowed: false, expectedReason: 'is-remote' },
      { isTrunk: true, isRemote: true, expectedAllowed: false, expectedReason: 'is-trunk' }
    ]

    it.each(testCases)(
      'isTrunk=$isTrunk, isRemote=$isRemote => allowed=$expectedAllowed',
      ({ isTrunk, isRemote, expectedAllowed, expectedReason }) => {
        const result = getRenameBranchPermission({ isTrunk, isRemote })
        expect(result.allowed).toBe(expectedAllowed)
        if (!result.allowed && expectedReason) {
          expect(result.reason).toBe(expectedReason)
        }
      }
    )
  })

  describe('deniedReason messages', () => {
    it('includes deniedReason directly in result for denied permissions', () => {
      const trunkResult = getRenameBranchPermission({ isTrunk: true, isRemote: false })
      expect(trunkResult.deniedReason).toBe('Cannot rename trunk branches')

      const remoteResult = getRenameBranchPermission({ isTrunk: false, isRemote: true })
      expect(remoteResult.deniedReason).toBe('Cannot rename remote branches')
    })

    it('includes undefined deniedReason for allowed permissions', () => {
      const result = getRenameBranchPermission({ isTrunk: false, isRemote: false })
      expect(result.deniedReason).toBeUndefined()
    })

    it('messages are non-empty strings when denied', () => {
      const trunkResult = getRenameBranchPermission({ isTrunk: true, isRemote: false })
      const remoteResult = getRenameBranchPermission({ isTrunk: false, isRemote: true })

      expect(trunkResult.deniedReason).toBeTruthy()
      expect(typeof trunkResult.deniedReason).toBe('string')
      expect(trunkResult.deniedReason!.length).toBeGreaterThan(0)

      expect(remoteResult.deniedReason).toBeTruthy()
      expect(typeof remoteResult.deniedReason).toBe('string')
      expect(remoteResult.deniedReason!.length).toBeGreaterThan(0)
    })

    it('messages are distinct for different reasons', () => {
      const trunkResult = getRenameBranchPermission({ isTrunk: true, isRemote: false })
      const remoteResult = getRenameBranchPermission({ isTrunk: false, isRemote: true })

      expect(trunkResult.deniedReason).not.toBe(remoteResult.deniedReason)
    })
  })

  describe('type safety', () => {
    it('allowed result has correct type shape', () => {
      const result: RenameBranchPermission = getRenameBranchPermission({
        isTrunk: false,
        isRemote: false
      })

      if (result.allowed) {
        // TypeScript should know deniedReason is undefined here
        expect(result.deniedReason).toBeUndefined()
        // @ts-expect-error - reason should not exist on allowed result
        expect(result.reason).toBeUndefined()
      }
    })

    it('denied result has correct type shape', () => {
      const result: RenameBranchPermission = getRenameBranchPermission({
        isTrunk: true,
        isRemote: false
      })

      if (!result.allowed) {
        // TypeScript should know these exist here
        expect(result.reason).toBeDefined()
        expect(result.deniedReason).toBeDefined()
      }
    })
  })
})
