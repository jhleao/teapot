import { describe, expect, it } from 'vitest'
import { getSquashPermission, type SquashPermission } from '../squash'

describe('getSquashPermission', () => {
  describe('basic cases', () => {
    it('returns allowed: true for valid squash target', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: false
      })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: true when hasBranch is not specified (defaults to true)', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: false,
        parentIsTrunk: false
      })
      expect(result.allowed).toBe(true)
    })

    it('returns allowed: false with reason "is-trunk" for trunk commits', () => {
      const result = getSquashPermission({
        isTrunk: true,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
        expect(result.deniedReason).toBe('Cannot squash trunk commits')
      }
    })

    it('returns allowed: false with reason "is-remote" for remote branches', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: true,
        hasBranch: true,
        parentIsTrunk: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-remote')
        expect(result.deniedReason).toBe('Cannot squash remote branches')
      }
    })

    it('returns allowed: false with reason "no-branch" for commits without branch', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: false,
        hasBranch: false,
        parentIsTrunk: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('no-branch')
        expect(result.deniedReason).toBe('Cannot squash: no branch on this commit')
      }
    })

    it('returns allowed: false with reason "parent-is-trunk" when parent is on trunk', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('parent-is-trunk')
        expect(result.deniedReason).toBe('Cannot squash: parent commit is on trunk')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes trunk check first', () => {
      const result = getSquashPermission({
        isTrunk: true,
        isRemote: true,
        hasBranch: false,
        parentIsTrunk: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
      }
    })

    it('prioritizes remote check over hasBranch check', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: true,
        hasBranch: false,
        parentIsTrunk: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-remote')
      }
    })

    it('prioritizes hasBranch check over parentIsTrunk check', () => {
      const result = getSquashPermission({
        isTrunk: false,
        isRemote: false,
        hasBranch: false,
        parentIsTrunk: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('no-branch')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = { isTrunk: false, isRemote: false, hasBranch: true, parentIsTrunk: false }
      const result1 = getSquashPermission(input)
      const result2 = getSquashPermission(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = { isTrunk: false, isRemote: false, hasBranch: true, parentIsTrunk: true }
      const inputCopy = { ...input }
      getSquashPermission(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    const testCases: Array<{
      isTrunk: boolean
      isRemote: boolean
      hasBranch: boolean
      parentIsTrunk: boolean
      expectedAllowed: boolean
      expectedReason?: 'is-trunk' | 'is-remote' | 'no-branch' | 'parent-is-trunk'
    }> = [
      // Success case
      {
        isTrunk: false,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: false,
        expectedAllowed: true
      },
      // Individual failure cases
      {
        isTrunk: true,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: false,
        expectedAllowed: false,
        expectedReason: 'is-trunk'
      },
      {
        isTrunk: false,
        isRemote: true,
        hasBranch: true,
        parentIsTrunk: false,
        expectedAllowed: false,
        expectedReason: 'is-remote'
      },
      {
        isTrunk: false,
        isRemote: false,
        hasBranch: false,
        parentIsTrunk: false,
        expectedAllowed: false,
        expectedReason: 'no-branch'
      },
      {
        isTrunk: false,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: true,
        expectedAllowed: false,
        expectedReason: 'parent-is-trunk'
      }
    ]

    it.each(testCases)(
      'isTrunk=$isTrunk, isRemote=$isRemote, hasBranch=$hasBranch, parentIsTrunk=$parentIsTrunk => allowed=$expectedAllowed',
      ({ isTrunk, isRemote, hasBranch, parentIsTrunk, expectedAllowed, expectedReason }) => {
        const result = getSquashPermission({ isTrunk, isRemote, hasBranch, parentIsTrunk })
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
        getSquashPermission({
          isTrunk: true,
          isRemote: false,
          hasBranch: true,
          parentIsTrunk: false
        }),
        getSquashPermission({
          isTrunk: false,
          isRemote: true,
          hasBranch: true,
          parentIsTrunk: false
        }),
        getSquashPermission({
          isTrunk: false,
          isRemote: false,
          hasBranch: false,
          parentIsTrunk: false
        }),
        getSquashPermission({
          isTrunk: false,
          isRemote: false,
          hasBranch: true,
          parentIsTrunk: true
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
        getSquashPermission({
          isTrunk: true,
          isRemote: false,
          hasBranch: true,
          parentIsTrunk: false
        }).deniedReason,
        getSquashPermission({
          isTrunk: false,
          isRemote: true,
          hasBranch: true,
          parentIsTrunk: false
        }).deniedReason,
        getSquashPermission({
          isTrunk: false,
          isRemote: false,
          hasBranch: false,
          parentIsTrunk: false
        }).deniedReason,
        getSquashPermission({
          isTrunk: false,
          isRemote: false,
          hasBranch: true,
          parentIsTrunk: true
        }).deniedReason
      ]

      expect(new Set(reasons).size).toBe(4) // All distinct
    })
  })

  describe('type safety', () => {
    it('allowed result has correct type shape', () => {
      const result: SquashPermission = getSquashPermission({
        isTrunk: false,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: false
      })

      if (result.allowed) {
        expect(result.deniedReason).toBeUndefined()
        // @ts-expect-error - reason should not exist on allowed result
        expect(result.reason).toBeUndefined()
      }
    })

    it('denied result has correct type shape', () => {
      const result: SquashPermission = getSquashPermission({
        isTrunk: true,
        isRemote: false,
        hasBranch: true,
        parentIsTrunk: false
      })

      if (!result.allowed) {
        expect(result.reason).toBeDefined()
        expect(result.deniedReason).toBeDefined()
      }
    })
  })
})
