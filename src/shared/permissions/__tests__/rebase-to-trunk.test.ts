import { describe, expect, it } from 'vitest'
import {
  getRebaseToTrunkPermission,
  type RebaseToTrunkPermission
} from '../rebase-to-trunk'

describe('getRebaseToTrunkPermission', () => {
  describe('basic cases', () => {
    it('returns allowed: true for valid rebase target', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: false
      })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: true when hasUncommittedChanges is not specified', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: true
      })
      expect(result.allowed).toBe(true)
    })

    it('returns allowed: false with reason "no-trunk" when trunk does not exist', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: false,
        hasUncommittedChanges: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('no-trunk')
        expect(result.deniedReason).toBe('No trunk branch found')
      }
    })

    it('returns allowed: false with reason "not-off-trunk" when not directly off trunk', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: false,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('not-off-trunk')
        expect(result.deniedReason).toBe('Stack is not directly off trunk')
      }
    })

    it('returns allowed: false with reason "already-on-trunk-head" when already on trunk head', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: true,
        hasTrunk: true,
        hasUncommittedChanges: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('already-on-trunk-head')
        expect(result.deniedReason).toBe('Already on latest trunk')
      }
    })

    it('returns allowed: false with reason "dirty-working-tree" when has uncommitted changes', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('dirty-working-tree')
        expect(result.deniedReason).toBe('Cannot rebase with uncommitted changes')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes no-trunk check first', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: false,
        isBaseOnTrunkHead: true,
        hasTrunk: false,
        hasUncommittedChanges: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('no-trunk')
      }
    })

    it('prioritizes not-off-trunk over already-on-trunk-head', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: false,
        isBaseOnTrunkHead: true,
        hasTrunk: true,
        hasUncommittedChanges: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('not-off-trunk')
      }
    })

    it('prioritizes already-on-trunk-head over dirty-working-tree', () => {
      const result = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: true,
        hasTrunk: true,
        hasUncommittedChanges: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('already-on-trunk-head')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = {
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: false
      }
      const result1 = getRebaseToTrunkPermission(input)
      const result2 = getRebaseToTrunkPermission(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = {
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: true
      }
      const inputCopy = { ...input }
      getRebaseToTrunkPermission(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    const testCases: Array<{
      hasTrunk: boolean
      isDirectlyOffTrunk: boolean
      isBaseOnTrunkHead: boolean
      hasUncommittedChanges: boolean
      expectedAllowed: boolean
      expectedReason?: 'no-trunk' | 'not-off-trunk' | 'already-on-trunk-head' | 'dirty-working-tree'
    }> = [
      // Success case
      {
        hasTrunk: true,
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasUncommittedChanges: false,
        expectedAllowed: true
      },
      // Individual failure cases
      {
        hasTrunk: false,
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasUncommittedChanges: false,
        expectedAllowed: false,
        expectedReason: 'no-trunk'
      },
      {
        hasTrunk: true,
        isDirectlyOffTrunk: false,
        isBaseOnTrunkHead: false,
        hasUncommittedChanges: false,
        expectedAllowed: false,
        expectedReason: 'not-off-trunk'
      },
      {
        hasTrunk: true,
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: true,
        hasUncommittedChanges: false,
        expectedAllowed: false,
        expectedReason: 'already-on-trunk-head'
      },
      {
        hasTrunk: true,
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasUncommittedChanges: true,
        expectedAllowed: false,
        expectedReason: 'dirty-working-tree'
      }
    ]

    it.each(testCases)(
      'hasTrunk=$hasTrunk, isDirectlyOffTrunk=$isDirectlyOffTrunk, isBaseOnTrunkHead=$isBaseOnTrunkHead, hasUncommittedChanges=$hasUncommittedChanges => allowed=$expectedAllowed',
      ({
        hasTrunk,
        isDirectlyOffTrunk,
        isBaseOnTrunkHead,
        hasUncommittedChanges,
        expectedAllowed,
        expectedReason
      }) => {
        const result = getRebaseToTrunkPermission({
          hasTrunk,
          isDirectlyOffTrunk,
          isBaseOnTrunkHead,
          hasUncommittedChanges
        })
        expect(result.allowed).toBe(expectedAllowed)
        if (!result.allowed && expectedReason) {
          expect(result.reason).toBe(expectedReason)
        }
      }
    )
  })

  describe('deniedReason messages', () => {
    it('all messages are non-empty strings', () => {
      const cases = [
        getRebaseToTrunkPermission({
          hasTrunk: false,
          isDirectlyOffTrunk: true,
          isBaseOnTrunkHead: false,
          hasUncommittedChanges: false
        }),
        getRebaseToTrunkPermission({
          hasTrunk: true,
          isDirectlyOffTrunk: false,
          isBaseOnTrunkHead: false,
          hasUncommittedChanges: false
        }),
        getRebaseToTrunkPermission({
          hasTrunk: true,
          isDirectlyOffTrunk: true,
          isBaseOnTrunkHead: true,
          hasUncommittedChanges: false
        }),
        getRebaseToTrunkPermission({
          hasTrunk: true,
          isDirectlyOffTrunk: true,
          isBaseOnTrunkHead: false,
          hasUncommittedChanges: true
        })
      ]

      for (const result of cases) {
        expect(result.deniedReason).toBeTruthy()
        expect(typeof result.deniedReason).toBe('string')
        expect(result.deniedReason!.length).toBeGreaterThan(0)
      }
    })

    it('all messages are distinct', () => {
      const reasons = [
        getRebaseToTrunkPermission({
          hasTrunk: false,
          isDirectlyOffTrunk: true,
          isBaseOnTrunkHead: false,
          hasUncommittedChanges: false
        }).deniedReason,
        getRebaseToTrunkPermission({
          hasTrunk: true,
          isDirectlyOffTrunk: false,
          isBaseOnTrunkHead: false,
          hasUncommittedChanges: false
        }).deniedReason,
        getRebaseToTrunkPermission({
          hasTrunk: true,
          isDirectlyOffTrunk: true,
          isBaseOnTrunkHead: true,
          hasUncommittedChanges: false
        }).deniedReason,
        getRebaseToTrunkPermission({
          hasTrunk: true,
          isDirectlyOffTrunk: true,
          isBaseOnTrunkHead: false,
          hasUncommittedChanges: true
        }).deniedReason
      ]

      expect(new Set(reasons).size).toBe(4) // All distinct
    })
  })

  describe('type safety', () => {
    it('allowed result has correct type shape', () => {
      const result: RebaseToTrunkPermission = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: true,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: false
      })

      if (result.allowed) {
        expect(result.deniedReason).toBeUndefined()
        // @ts-expect-error - reason should not exist on allowed result
        expect(result.reason).toBeUndefined()
      }
    })

    it('denied result has correct type shape', () => {
      const result: RebaseToTrunkPermission = getRebaseToTrunkPermission({
        isDirectlyOffTrunk: false,
        isBaseOnTrunkHead: false,
        hasTrunk: true,
        hasUncommittedChanges: false
      })

      if (!result.allowed) {
        expect(result.reason).toBeDefined()
        expect(result.deniedReason).toBeDefined()
      }
    })
  })
})
