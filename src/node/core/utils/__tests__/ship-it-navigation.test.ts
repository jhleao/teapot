/**
 * Tests for Ship It navigation logic
 *
 * After merging a PR, we need to intelligently navigate to the right branch:
 * 1. If user is on shipped branch → go to parent or main
 * 2. If shipped branch has children → user needs to rebase them
 * 3. If user is elsewhere → stay there
 */

import { describe, expect, it } from 'vitest'
import type { ShipItNavigationContext } from '@shared/types'
import { determineShipItNavigation } from '../ship-it-navigation'

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
