/**
 * Tests for shared git-forge type utilities
 */

import { describe, expect, it } from 'vitest'
import {
  ACTIVE_PR_STATES,
  findActivePr,
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
