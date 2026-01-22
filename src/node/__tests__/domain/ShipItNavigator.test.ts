/**
 * Tests for Ship It logic
 *
 * Pre-merge validation (validateCanShip):
 * 1. PR must exist and be open
 * 2. PR must be mergeable
 * 3. Target branch must not be stale (merged)
 * 4. branchCanShip must not be false (computed by frontend enrichment)
 *
 * Post-merge navigation (determineNavigation):
 * 1. If user is on shipped branch → go to parent or main
 * 2. If shipped branch has children → user needs to rebase them
 * 3. If user is elsewhere → stay there
 */

import type { ShipItNavigationContext } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { ShipItNavigator } from '../../domain'

const validateCanShip = ShipItNavigator.validateCanShip
const determineShipItNavigation = ShipItNavigator.determineNavigation

// ============================================================================
// validateCanShip Tests
// ============================================================================

describe('validateCanShip', () => {
  const makePr = (overrides: Partial<Parameters<typeof validateCanShip>[1][0]> = {}) => ({
    headRefName: 'feature',
    baseRefName: 'main',
    state: 'open',
    isMergeable: true,
    ...overrides
  })

  describe('PR existence checks', () => {
    it('rejects when no PR exists for the branch', () => {
      const result = validateCanShip('feature', [])

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('No open PR found')
      }
    })

    it('rejects when PR is closed (not open)', () => {
      const result = validateCanShip('feature', [makePr({ state: 'closed' })])

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('No open PR found')
      }
    })

    it('rejects when PR is already merged', () => {
      const result = validateCanShip('feature', [makePr({ state: 'merged' })])

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('No open PR found')
      }
    })

    it('accepts when PR is open', () => {
      const result = validateCanShip('feature', [makePr({ state: 'open' })])

      expect(result.canShip).toBe(true)
    })
  })

  describe('mergeability checks', () => {
    it('rejects when PR is not mergeable', () => {
      const result = validateCanShip('feature', [makePr({ isMergeable: false })])

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('not mergeable')
      }
    })

    it('accepts when PR is mergeable', () => {
      const result = validateCanShip('feature', [makePr({ isMergeable: true })])

      expect(result.canShip).toBe(true)
    })
  })

  describe('stale target checks', () => {
    it('rejects when target branch has been merged (stale target)', () => {
      const prs = [
        makePr({ headRefName: 'feature-2', baseRefName: 'feature-1' }),
        makePr({ headRefName: 'feature-1', baseRefName: 'main', state: 'merged' })
      ]

      const result = validateCanShip('feature-2', prs)

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('has been merged')
        expect(result.reason).toContain('feature-1')
      }
    })

    it('accepts when target branch is still open', () => {
      const prs = [
        makePr({ headRefName: 'feature-2', baseRefName: 'feature-1' }),
        makePr({ headRefName: 'feature-1', baseRefName: 'main', state: 'open' })
      ]

      const result = validateCanShip('feature-2', prs)

      expect(result.canShip).toBe(true)
    })

    it('accepts when target is trunk (main/master)', () => {
      // Trunk can't be "merged" in the PR sense
      const result = validateCanShip('feature', [makePr({ baseRefName: 'main' })])

      expect(result.canShip).toBe(true)
    })

    it('accepts when target is master (also trunk)', () => {
      const result = validateCanShip('feature', [makePr({ baseRefName: 'master' })])

      expect(result.canShip).toBe(true)
    })
  })

  // Note: "child PR checks" were removed - canShip is now computed by frontend enrichment
  // (enrichStackWithForge) based on isDirectlyOffTrunk && isTrunk(pr.baseRefName).
  // The backend trusts the frontend's computation and no longer checks hasChildPrs.

  describe('branchCanShip parameter', () => {
    it('rejects when branchCanShip=false and PR targets non-trunk', () => {
      const prs = [makePr({ headRefName: 'feature', baseRefName: 'other-branch' })]

      const result = validateCanShip('feature', prs, false)

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('PR targets')
        expect(result.reason).toContain('other-branch')
      }
    })

    it('rejects when branchCanShip=false and PR targets trunk (stacked branch)', () => {
      const prs = [makePr({ headRefName: 'feature', baseRefName: 'main' })]

      const result = validateCanShip('feature', prs, false)

      expect(result.canShip).toBe(false)
      if (!result.canShip) {
        expect(result.reason).toContain('stacked on another branch')
      }
    })

    it('accepts when branchCanShip=true', () => {
      const prs = [makePr({ headRefName: 'feature', baseRefName: 'main' })]

      const result = validateCanShip('feature', prs, true)

      expect(result.canShip).toBe(true)
    })

    it('accepts when branchCanShip is undefined (trusts frontend will provide value)', () => {
      const prs = [makePr({ headRefName: 'feature', baseRefName: 'main' })]

      // branchCanShip not passed - backend accepts (frontend is source of truth)
      const result = validateCanShip('feature', prs, undefined)

      expect(result.canShip).toBe(true)
    })
  })
})

// ============================================================================
// determineNavigation Tests
// ============================================================================

describe('determineShipItNavigation', () => {
  const baseContext: ShipItNavigationContext = {
    repoPath: '/fake/repo',
    shippedBranch: 'feature-1',
    prTargetBranch: 'main',
    userCurrentBranch: 'feature-1',
    wasDetached: false,
    hasChildren: false,
    isWorkingTreeClean: true
  }

  describe('when user is on shipped branch', () => {
    it('switches to main when PR targeted main and no children', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        userCurrentBranch: 'feature-1',
        prTargetBranch: 'main',
        hasChildren: false
      })

      expect(result.action).toBe('switched-to-main')
      expect(result.targetBranch).toBe('main')
      expect(result.needsRebase).toBe(false)
    })

    it('switches to parent when PR targeted a stacked branch', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        shippedBranch: 'feature-2',
        userCurrentBranch: 'feature-2',
        prTargetBranch: 'feature-1', // stacked on feature-1
        hasChildren: false
      })

      expect(result.action).toBe('switched-to-parent')
      expect(result.targetBranch).toBe('feature-1')
      expect(result.needsRebase).toBe(false)
    })

    it('indicates rebase needed when shipped branch has children', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        userCurrentBranch: 'feature-1',
        prTargetBranch: 'main',
        hasChildren: true
      })

      expect(result.action).toBe('switched-to-main')
      expect(result.needsRebase).toBe(true)
      expect(result.message).toContain('rebase')
    })
  })

  describe('when user is NOT on shipped branch', () => {
    it('stays on current branch', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        shippedBranch: 'feature-1',
        userCurrentBranch: 'feature-other', // user is elsewhere
        prTargetBranch: 'main',
        hasChildren: false
      })

      expect(result.action).toBe('stayed')
      expect(result.targetBranch).toBeUndefined()
    })

    it('stays and notes rebase needed if children exist', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        shippedBranch: 'feature-1',
        userCurrentBranch: 'feature-2', // user is on a child branch
        prTargetBranch: 'main',
        hasChildren: true
      })

      expect(result.action).toBe('stayed')
      expect(result.needsRebase).toBe(true)
    })
  })

  describe('when user is in detached HEAD', () => {
    it('switches to main when shipped branch was targeted at main', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        userCurrentBranch: null,
        wasDetached: true,
        prTargetBranch: 'main',
        hasChildren: false
      })

      // When detached, we switch to target since user wasn't "on" any branch
      expect(result.action).toBe('switched-to-main')
      expect(result.targetBranch).toBe('main')
    })
  })

  describe('edge cases', () => {
    it('handles null current branch (detached)', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        userCurrentBranch: null,
        wasDetached: true
      })

      // Should still work without crashing
      expect(result.action).toBeDefined()
    })

    it('prefers parent over main when PR targeted parent', () => {
      const result = determineShipItNavigation({
        ...baseContext,
        shippedBranch: 'feature-2',
        userCurrentBranch: 'feature-2',
        prTargetBranch: 'feature-1',
        hasChildren: false
      })

      // Go to parent, not main
      expect(result.targetBranch).toBe('feature-1')
      expect(result.action).toBe('switched-to-parent')
    })
  })
})
