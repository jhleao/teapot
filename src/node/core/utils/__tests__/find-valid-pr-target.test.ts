/**
 * Tests for finding a valid PR target branch
 *
 * When a PR's target branch is merged, we need to find the next valid target.
 * This walks up the stack until we find an unmerged branch or trunk.
 */

import { describe, expect, it } from 'vitest'
import type { ForgePullRequest } from '@shared/types/git-forge'
import { findValidPrTarget } from '../find-valid-pr-target'

// Helper to create mock PRs
function createPr(
  headRefName: string,
  baseRefName: string,
  state: 'open' | 'closed' | 'merged' | 'draft' = 'open'
): ForgePullRequest {
  return {
    number: Math.floor(Math.random() * 1000),
    title: `PR for ${headRefName}`,
    url: `https://github.com/test/repo/pull/${headRefName}`,
    state,
    headRefName,
    headSha: 'abc123',
    baseRefName,
    createdAt: new Date().toISOString(),
    isMergeable: true
  }
}

describe('findValidPrTarget', () => {
  it('returns trunk when targeting trunk directly', () => {
    const prs: ForgePullRequest[] = []
    const mergedBranches = new Set<string>()

    const result = findValidPrTarget('feature-1', 'main', prs, mergedBranches)

    expect(result).toBe('main')
  })

  it('returns target unchanged when target is not merged', () => {
    const prs = [
      createPr('feature-2', 'feature-1', 'open'),
      createPr('feature-1', 'main', 'open')
    ]
    const mergedBranches = new Set<string>()

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    expect(result).toBe('feature-1')
  })

  it('walks up stack when target is merged', () => {
    // Stack: main <- feature-1 <- feature-2 <- feature-3
    // feature-1 is merged, so feature-2's target should become main
    const prs = [
      createPr('feature-3', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'open'),
      createPr('feature-1', 'main', 'merged')
    ]
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    expect(result).toBe('main')
  })

  it('walks up multiple levels if needed', () => {
    // Stack: main <- f1 <- f2 <- f3 <- f4
    // f1 and f2 are merged, so f3's target should become main
    const prs = [
      createPr('feature-4', 'feature-3', 'open'),
      createPr('feature-3', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'merged'),
      createPr('feature-1', 'main', 'merged')
    ]
    const mergedBranches = new Set(['feature-1', 'feature-2'])

    const result = findValidPrTarget('feature-3', 'feature-2', prs, mergedBranches)

    expect(result).toBe('main')
  })

  it('stops at first unmerged branch in stack', () => {
    // Stack: main <- f1 <- f2 <- f3
    // f1 is merged, f2 is not, so f3 stays targeting f2
    const prs = [
      createPr('feature-3', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'open'),
      createPr('feature-1', 'main', 'merged')
    ]
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-3', 'feature-2', prs, mergedBranches)

    // f2 is not merged, so it's still a valid target
    expect(result).toBe('feature-2')
  })

  it('handles master as trunk', () => {
    const prs = [createPr('feature-1', 'master', 'merged')]
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    expect(result).toBe('master')
  })

  it('returns original target when no PR chain found', () => {
    // If we can't trace the stack, return original target
    const prs: ForgePullRequest[] = []
    const mergedBranches = new Set(['feature-1'])

    const result = findValidPrTarget('feature-2', 'feature-1', prs, mergedBranches)

    // Can't walk the stack, return original (even if merged)
    // This is a safety fallback - UI should prevent this case
    expect(result).toBe('feature-1')
  })

  it('handles circular references gracefully', () => {
    // Edge case: malformed PR chain with cycle
    const prs = [
      createPr('feature-1', 'feature-2', 'open'),
      createPr('feature-2', 'feature-1', 'open') // cycle!
    ]
    const mergedBranches = new Set(['feature-1', 'feature-2'])

    // Should not infinite loop - returns last valid target or falls back
    const result = findValidPrTarget('feature-1', 'feature-2', prs, mergedBranches)

    expect(result).toBeDefined()
  })
})
