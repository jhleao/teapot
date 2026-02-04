import { describe, expect, it } from 'vitest'
import {
  getCreateWorktreePermission,
  type CreateWorktreePermission
} from '../create-worktree'

describe('getCreateWorktreePermission', () => {
  describe('basic cases', () => {
    it('returns allowed: true for non-trunk, non-remote branch without worktree', () => {
      const result = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: false,
        hasWorktree: false
      })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: true when hasWorktree is not specified', () => {
      const result = getCreateWorktreePermission({ isTrunk: false, isRemote: false })
      expect(result.allowed).toBe(true)
      expect(result.deniedReason).toBeUndefined()
    })

    it('returns allowed: false with reason "is-trunk" for trunk branches', () => {
      const result = getCreateWorktreePermission({
        isTrunk: true,
        isRemote: false,
        hasWorktree: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
        expect(result.deniedReason).toBe('Cannot create worktree for trunk branches')
      }
    })

    it('returns allowed: false with reason "is-remote" for remote branches', () => {
      const result = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: true,
        hasWorktree: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-remote')
        expect(result.deniedReason).toBe('Cannot create worktree for remote branches')
      }
    })

    it('returns allowed: false with reason "has-worktree" for branches with existing worktree', () => {
      const result = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: false,
        hasWorktree: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('has-worktree')
        expect(result.deniedReason).toBe('Branch already has a worktree')
      }
    })
  })

  describe('priority and edge cases', () => {
    it('prioritizes trunk check over remote check', () => {
      const result = getCreateWorktreePermission({
        isTrunk: true,
        isRemote: true,
        hasWorktree: false
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-trunk')
      }
    })

    it('prioritizes remote check over hasWorktree check', () => {
      const result = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: true,
        hasWorktree: true
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toBe('is-remote')
      }
    })

    it('returns consistent results for same inputs (pure function)', () => {
      const input = { isTrunk: false, isRemote: false, hasWorktree: false }
      const result1 = getCreateWorktreePermission(input)
      const result2 = getCreateWorktreePermission(input)
      expect(result1).toEqual(result2)
    })

    it('does not mutate input object', () => {
      const input = { isTrunk: false, isRemote: true, hasWorktree: false }
      const inputCopy = { ...input }
      getCreateWorktreePermission(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('exhaustive state coverage', () => {
    const testCases: Array<{
      isTrunk: boolean
      isRemote: boolean
      hasWorktree: boolean
      expectedAllowed: boolean
      expectedReason?: 'is-trunk' | 'is-remote' | 'has-worktree'
    }> = [
      { isTrunk: false, isRemote: false, hasWorktree: false, expectedAllowed: true },
      {
        isTrunk: true,
        isRemote: false,
        hasWorktree: false,
        expectedAllowed: false,
        expectedReason: 'is-trunk'
      },
      {
        isTrunk: false,
        isRemote: true,
        hasWorktree: false,
        expectedAllowed: false,
        expectedReason: 'is-remote'
      },
      {
        isTrunk: false,
        isRemote: false,
        hasWorktree: true,
        expectedAllowed: false,
        expectedReason: 'has-worktree'
      },
      // Multiple conditions - verify priority
      {
        isTrunk: true,
        isRemote: true,
        hasWorktree: true,
        expectedAllowed: false,
        expectedReason: 'is-trunk'
      }
    ]

    it.each(testCases)(
      'isTrunk=$isTrunk, isRemote=$isRemote, hasWorktree=$hasWorktree => allowed=$expectedAllowed',
      ({ isTrunk, isRemote, hasWorktree, expectedAllowed, expectedReason }) => {
        const result = getCreateWorktreePermission({ isTrunk, isRemote, hasWorktree })
        expect(result.allowed).toBe(expectedAllowed)
        if (!result.allowed && expectedReason) {
          expect(result.reason).toBe(expectedReason)
        }
      }
    )
  })

  describe('deniedReason messages', () => {
    it('includes deniedReason directly in result for denied permissions', () => {
      const trunkResult = getCreateWorktreePermission({
        isTrunk: true,
        isRemote: false,
        hasWorktree: false
      })
      expect(trunkResult.deniedReason).toBe('Cannot create worktree for trunk branches')

      const remoteResult = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: true,
        hasWorktree: false
      })
      expect(remoteResult.deniedReason).toBe('Cannot create worktree for remote branches')

      const worktreeResult = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: false,
        hasWorktree: true
      })
      expect(worktreeResult.deniedReason).toBe('Branch already has a worktree')
    })

    it('messages are distinct for different reasons', () => {
      const trunkResult = getCreateWorktreePermission({
        isTrunk: true,
        isRemote: false,
        hasWorktree: false
      })
      const remoteResult = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: true,
        hasWorktree: false
      })
      const worktreeResult = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: false,
        hasWorktree: true
      })

      const reasons = [
        trunkResult.deniedReason,
        remoteResult.deniedReason,
        worktreeResult.deniedReason
      ]
      expect(new Set(reasons).size).toBe(3) // All distinct
    })
  })

  describe('type safety', () => {
    it('allowed result has correct type shape', () => {
      const result: CreateWorktreePermission = getCreateWorktreePermission({
        isTrunk: false,
        isRemote: false,
        hasWorktree: false
      })

      if (result.allowed) {
        expect(result.deniedReason).toBeUndefined()
        // @ts-expect-error - reason should not exist on allowed result
        expect(result.reason).toBeUndefined()
      }
    })

    it('denied result has correct type shape', () => {
      const result: CreateWorktreePermission = getCreateWorktreePermission({
        isTrunk: true,
        isRemote: false,
        hasWorktree: false
      })

      if (!result.allowed) {
        expect(result.reason).toBeDefined()
        expect(result.deniedReason).toBeDefined()
      }
    })
  })
})
