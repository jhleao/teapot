/**
 * Tests for shared git-forge type utilities
 */

import { describe, expect, it } from 'vitest'
import {
  ACTIVE_PR_STATES,
  canRecreatePr,
  countOpenPrs,
  findActivePr,
  findBestPr,
  findOpenPr,
  hasChildPrs,
  hasMergedPr,
  isActivePrState
} from '../git-forge'

describe('ACTIVE_PR_STATES', () => {
  it('contains open and draft states', () => {
    expect(ACTIVE_PR_STATES).toContain('open')
    expect(ACTIVE_PR_STATES).toContain('draft')
  })

  it('does not contain closed or merged states', () => {
    expect(ACTIVE_PR_STATES).not.toContain('closed')
    expect(ACTIVE_PR_STATES).not.toContain('merged')
  })

  it('has exactly two entries', () => {
    expect(ACTIVE_PR_STATES).toHaveLength(2)
  })
})

describe('hasChildPrs', () => {
  const makePr = (head: string, base: string, state: string) => ({
    headRefName: head,
    baseRefName: base,
    state
  })

  it('returns true when open PR targets the branch', () => {
    const prs = [makePr('feature-2', 'feature-1', 'open')]
    expect(hasChildPrs('feature-1', prs)).toBe(true)
  })

  it('returns true when draft PR targets the branch', () => {
    const prs = [makePr('feature-2', 'feature-1', 'draft')]
    expect(hasChildPrs('feature-1', prs)).toBe(true)
  })

  it('returns false when no PR targets the branch', () => {
    const prs = [makePr('feature-1', 'main', 'open')]
    expect(hasChildPrs('feature-1', prs)).toBe(false)
  })

  it('returns false when only closed PR targets the branch', () => {
    const prs = [makePr('feature-2', 'feature-1', 'closed')]
    expect(hasChildPrs('feature-1', prs)).toBe(false)
  })

  it('returns false when only merged PR targets the branch', () => {
    const prs = [makePr('feature-2', 'feature-1', 'merged')]
    expect(hasChildPrs('feature-1', prs)).toBe(false)
  })

  it('returns false for empty PR list', () => {
    expect(hasChildPrs('feature-1', [])).toBe(false)
  })

  it('handles multiple PRs correctly', () => {
    const prs = [
      makePr('feature-1', 'main', 'open'),
      makePr('feature-2', 'feature-1', 'closed'), // closed - doesn't count
      makePr('feature-3', 'feature-2', 'open')
    ]

    expect(hasChildPrs('main', prs)).toBe(true) // feature-1 targets main
    expect(hasChildPrs('feature-1', prs)).toBe(false) // only closed PR targets it
    expect(hasChildPrs('feature-2', prs)).toBe(true) // feature-3 targets it
    expect(hasChildPrs('feature-3', prs)).toBe(false) // nothing targets it
  })

  it('returns true if any active PR targets the branch', () => {
    const prs = [
      makePr('feature-2', 'feature-1', 'closed'),
      makePr('feature-3', 'feature-1', 'draft') // draft counts as active
    ]
    expect(hasChildPrs('feature-1', prs)).toBe(true)
  })
})

describe('isActivePrState', () => {
  it('returns true for open state', () => {
    expect(isActivePrState('open')).toBe(true)
  })

  it('returns true for draft state', () => {
    expect(isActivePrState('draft')).toBe(true)
  })

  it('returns false for closed state', () => {
    expect(isActivePrState('closed')).toBe(false)
  })

  it('returns false for merged state', () => {
    expect(isActivePrState('merged')).toBe(false)
  })

  it('returns false for unknown states', () => {
    expect(isActivePrState('unknown')).toBe(false)
    expect(isActivePrState('')).toBe(false)
  })
})

describe('findOpenPr', () => {
  const makePr = (head: string, state: string) => ({
    headRefName: head,
    state
  })

  it('finds open PR for branch', () => {
    const prs = [makePr('feature-1', 'open'), makePr('feature-2', 'open')]
    const result = findOpenPr('feature-1', prs)
    expect(result).toEqual(makePr('feature-1', 'open'))
  })

  it('returns undefined when no PR exists for branch', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(findOpenPr('feature-2', prs)).toBeUndefined()
  })

  it('returns undefined when PR is draft (not shippable)', () => {
    const prs = [makePr('feature-1', 'draft')]
    expect(findOpenPr('feature-1', prs)).toBeUndefined()
  })

  it('returns undefined when PR is closed', () => {
    const prs = [makePr('feature-1', 'closed')]
    expect(findOpenPr('feature-1', prs)).toBeUndefined()
  })

  it('returns undefined when PR is merged', () => {
    const prs = [makePr('feature-1', 'merged')]
    expect(findOpenPr('feature-1', prs)).toBeUndefined()
  })

  it('returns undefined for empty PR list', () => {
    expect(findOpenPr('feature-1', [])).toBeUndefined()
  })

  it('preserves additional properties on returned PR', () => {
    const prs = [{ headRefName: 'feature-1', state: 'open', number: 123, extra: 'data' }]
    const result = findOpenPr('feature-1', prs)
    expect(result).toEqual({ headRefName: 'feature-1', state: 'open', number: 123, extra: 'data' })
  })
})

describe('findActivePr', () => {
  const makePr = (head: string, state: string) => ({
    headRefName: head,
    state
  })

  it('finds open PR for branch', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(findActivePr('feature-1', prs)).toEqual(makePr('feature-1', 'open'))
  })

  it('finds draft PR for branch', () => {
    const prs = [makePr('feature-1', 'draft')]
    expect(findActivePr('feature-1', prs)).toEqual(makePr('feature-1', 'draft'))
  })

  it('returns undefined when no PR exists for branch', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(findActivePr('feature-2', prs)).toBeUndefined()
  })

  it('returns undefined when PR is closed', () => {
    const prs = [makePr('feature-1', 'closed')]
    expect(findActivePr('feature-1', prs)).toBeUndefined()
  })

  it('returns undefined when PR is merged', () => {
    const prs = [makePr('feature-1', 'merged')]
    expect(findActivePr('feature-1', prs)).toBeUndefined()
  })

  it('returns undefined for empty PR list', () => {
    expect(findActivePr('feature-1', [])).toBeUndefined()
  })

  it('prefers first matching active PR', () => {
    const prs = [
      makePr('feature-1', 'draft'),
      makePr('feature-1', 'open') // second one shouldn't be returned
    ]
    expect(findActivePr('feature-1', prs)).toEqual(makePr('feature-1', 'draft'))
  })
})

describe('hasMergedPr', () => {
  const makePr = (head: string, state: string) => ({
    headRefName: head,
    state
  })

  it('returns true when branch has merged PR', () => {
    const prs = [makePr('feature-1', 'merged')]
    expect(hasMergedPr('feature-1', prs)).toBe(true)
  })

  it('returns false when branch has open PR', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(hasMergedPr('feature-1', prs)).toBe(false)
  })

  it('returns false when branch has draft PR', () => {
    const prs = [makePr('feature-1', 'draft')]
    expect(hasMergedPr('feature-1', prs)).toBe(false)
  })

  it('returns false when branch has closed (not merged) PR', () => {
    const prs = [makePr('feature-1', 'closed')]
    expect(hasMergedPr('feature-1', prs)).toBe(false)
  })

  it('returns false when no PR exists for branch', () => {
    const prs = [makePr('feature-2', 'merged')]
    expect(hasMergedPr('feature-1', prs)).toBe(false)
  })

  it('returns false for empty PR list', () => {
    expect(hasMergedPr('feature-1', [])).toBe(false)
  })

  it('returns true if any PR for branch is merged', () => {
    const prs = [
      makePr('feature-1', 'open'),
      makePr('feature-1', 'merged') // has a merged PR too
    ]
    expect(hasMergedPr('feature-1', prs)).toBe(true)
  })
})

describe('findBestPr', () => {
  const makePr = (head: string, state: string, createdAt?: string) => ({
    headRefName: head,
    state,
    createdAt
  })

  it('returns undefined when no PR exists for branch', () => {
    expect(findBestPr('feature-1', [])).toBeUndefined()
    expect(findBestPr('feature-1', [makePr('feature-2', 'open')])).toBeUndefined()
  })

  it('returns single matching PR', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(findBestPr('feature-1', prs)?.state).toBe('open')
  })

  it('prefers open over draft', () => {
    const prs = [
      makePr('feature-1', 'draft', '2024-01-01'),
      makePr('feature-1', 'open', '2024-01-01')
    ]
    expect(findBestPr('feature-1', prs)?.state).toBe('open')
  })

  it('prefers open over closed', () => {
    const prs = [
      makePr('feature-1', 'closed', '2024-01-15'),
      makePr('feature-1', 'open', '2024-01-01')
    ]
    expect(findBestPr('feature-1', prs)?.state).toBe('open')
  })

  it('prefers open over closed regardless of creation order', () => {
    // Closed PR created more recently should still be lower priority than open PR
    const prs = [
      makePr('feature-1', 'open', '2024-01-01'),
      makePr('feature-1', 'closed', '2024-01-20')
    ]
    expect(findBestPr('feature-1', prs)?.state).toBe('open')
  })

  it('prefers draft over merged', () => {
    const prs = [
      makePr('feature-1', 'merged', '2024-01-02'),
      makePr('feature-1', 'draft', '2024-01-01')
    ]
    expect(findBestPr('feature-1', prs)?.state).toBe('draft')
  })

  it('prefers merged over closed', () => {
    const prs = [
      makePr('feature-1', 'closed', '2024-01-02'),
      makePr('feature-1', 'merged', '2024-01-01')
    ]
    expect(findBestPr('feature-1', prs)?.state).toBe('merged')
  })

  it('prefers most recently created within same state', () => {
    const prs = [
      makePr('feature-1', 'closed', '2024-01-01'),
      makePr('feature-1', 'closed', '2024-01-15') // More recent
    ]
    expect(findBestPr('feature-1', prs)?.createdAt).toBe('2024-01-15')
  })

  it('handles missing createdAt gracefully', () => {
    const prs = [makePr('feature-1', 'open'), makePr('feature-1', 'closed', '2024-01-01')]
    expect(findBestPr('feature-1', prs)?.state).toBe('open')
  })

  it('preserves additional properties on returned PR', () => {
    const prs = [{ headRefName: 'feature-1', state: 'open', createdAt: '2024-01-01', number: 123 }]
    const result = findBestPr('feature-1', prs)
    expect(result).toEqual({
      headRefName: 'feature-1',
      state: 'open',
      createdAt: '2024-01-01',
      number: 123
    })
  })

  it('does not mutate input array', () => {
    const prs = [
      makePr('feature-1', 'closed', '2024-01-15'),
      makePr('feature-1', 'open', '2024-01-01')
    ]
    const originalOrder = [...prs]
    findBestPr('feature-1', prs)
    expect(prs).toEqual(originalOrder)
  })

  // Edge cases for date parsing
  it('handles invalid createdAt dates gracefully - does not throw', () => {
    const prs = [
      makePr('feature-1', 'open', 'invalid-date'),
      makePr('feature-1', 'open', '2024-01-01')
    ]
    // Should not throw - invalid dates result in NaN comparison, order may vary
    // The key guarantee is no exception
    const result = findBestPr('feature-1', prs)
    expect(result).toBeDefined()
    expect(result?.state).toBe('open')
  })

  it('handles empty string createdAt gracefully', () => {
    const prs = [makePr('feature-1', 'closed', ''), makePr('feature-1', 'closed', '2024-01-15')]
    expect(findBestPr('feature-1', prs)?.createdAt).toBe('2024-01-15')
  })

  it('handles both PRs having invalid dates', () => {
    const prs = [makePr('feature-1', 'open', 'bad'), makePr('feature-1', 'open', 'also-bad')]
    // Should not throw, returns one of them (both have equal priority)
    const result = findBestPr('feature-1', prs)
    expect(result).toBeDefined()
    expect(result?.state).toBe('open')
  })

  // Complex multi-PR scenarios (3+ PRs)
  it('handles 3+ PRs with mixed states correctly', () => {
    const prs = [
      makePr('feature-1', 'closed', '2024-01-03'),
      makePr('feature-1', 'draft', '2024-01-02'),
      makePr('feature-1', 'open', '2024-01-01'),
      makePr('feature-1', 'merged', '2024-01-04')
    ]
    // Should select open (highest priority) regardless of array order
    expect(findBestPr('feature-1', prs)?.state).toBe('open')
  })

  it('handles 3+ PRs all with same state - selects newest', () => {
    const prs = [
      makePr('feature-1', 'closed', '2024-01-01'),
      makePr('feature-1', 'closed', '2024-01-15'),
      makePr('feature-1', 'closed', '2024-01-10')
    ]
    expect(findBestPr('feature-1', prs)?.createdAt).toBe('2024-01-15')
  })

  it('handles multiple open PRs - selects newest open', () => {
    const prs = [
      makePr('feature-1', 'open', '2024-01-01'),
      makePr('feature-1', 'open', '2024-01-20'),
      makePr('feature-1', 'open', '2024-01-10'),
      makePr('feature-1', 'closed', '2024-01-25') // Newer but lower priority
    ]
    const result = findBestPr('feature-1', prs)
    expect(result?.state).toBe('open')
    expect(result?.createdAt).toBe('2024-01-20')
  })

  it('handles 5+ PRs with complex state and date combinations', () => {
    const prs = [
      makePr('feature-1', 'merged', '2024-01-25'),
      makePr('feature-1', 'closed', '2024-01-30'),
      makePr('feature-1', 'draft', '2024-01-05'),
      makePr('feature-1', 'draft', '2024-01-15'),
      makePr('feature-1', 'closed', '2024-01-01')
    ]
    // No open PR, so draft with newest date should be selected
    const result = findBestPr('feature-1', prs)
    expect(result?.state).toBe('draft')
    expect(result?.createdAt).toBe('2024-01-15')
  })
})

describe('countOpenPrs', () => {
  const makePr = (head: string, state: string) => ({
    headRefName: head,
    state
  })

  it('returns 0 for no matching PRs', () => {
    expect(countOpenPrs('feature-1', [])).toBe(0)
    expect(countOpenPrs('feature-1', [makePr('feature-2', 'open')])).toBe(0)
  })

  it('counts only open PRs', () => {
    const prs = [
      makePr('feature-1', 'open'),
      makePr('feature-1', 'draft'),
      makePr('feature-1', 'open'),
      makePr('feature-1', 'closed')
    ]
    expect(countOpenPrs('feature-1', prs)).toBe(2)
  })

  it('returns 1 for single open PR', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(countOpenPrs('feature-1', prs)).toBe(1)
  })

  it('returns 0 when only draft/closed/merged PRs exist', () => {
    const prs = [
      makePr('feature-1', 'draft'),
      makePr('feature-1', 'closed'),
      makePr('feature-1', 'merged')
    ]
    expect(countOpenPrs('feature-1', prs)).toBe(0)
  })
})

describe('canRecreatePr', () => {
  const makePr = (head: string, state: string) => ({
    headRefName: head,
    state
  })

  it('returns false when no PRs exist', () => {
    expect(canRecreatePr('feature-1', [])).toBe(false)
  })

  it('returns false when open PR exists', () => {
    const prs = [makePr('feature-1', 'open')]
    expect(canRecreatePr('feature-1', prs)).toBe(false)
  })

  it('returns false when draft PR exists', () => {
    const prs = [makePr('feature-1', 'draft')]
    expect(canRecreatePr('feature-1', prs)).toBe(false)
  })

  it('returns true when only closed PRs exist', () => {
    const prs = [makePr('feature-1', 'closed')]
    expect(canRecreatePr('feature-1', prs)).toBe(true)
  })

  it('returns true when only merged PRs exist', () => {
    const prs = [makePr('feature-1', 'merged')]
    expect(canRecreatePr('feature-1', prs)).toBe(true)
  })

  it('returns true when only closed and merged PRs exist', () => {
    const prs = [makePr('feature-1', 'closed'), makePr('feature-1', 'merged')]
    expect(canRecreatePr('feature-1', prs)).toBe(true)
  })

  it('returns false when at least one active PR exists among inactive ones', () => {
    const prs = [makePr('feature-1', 'closed'), makePr('feature-1', 'open')]
    expect(canRecreatePr('feature-1', prs)).toBe(false)
  })

  it('returns false for different branch', () => {
    const prs = [makePr('feature-2', 'closed')]
    expect(canRecreatePr('feature-1', prs)).toBe(false)
  })
})
