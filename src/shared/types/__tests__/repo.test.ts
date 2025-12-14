/**
 * Tests for shared repo type utilities
 */

import { describe, expect, it } from 'vitest'
import { isTrunk, TRUNK_BRANCHES } from '../repo'

describe('TRUNK_BRANCHES', () => {
  it('contains main and master', () => {
    expect(TRUNK_BRANCHES).toContain('main')
    expect(TRUNK_BRANCHES).toContain('master')
  })

  it('has exactly two entries', () => {
    expect(TRUNK_BRANCHES).toHaveLength(2)
  })
})

describe('isTrunk', () => {
  it('returns true for main', () => {
    expect(isTrunk('main')).toBe(true)
  })

  it('returns true for master', () => {
    expect(isTrunk('master')).toBe(true)
  })

  it('returns false for feature branches', () => {
    expect(isTrunk('feature-1')).toBe(false)
    expect(isTrunk('develop')).toBe(false)
    expect(isTrunk('release/1.0')).toBe(false)
  })

  it('returns false for remote trunk refs', () => {
    // Remote refs like origin/main are NOT trunk - they include the remote prefix
    expect(isTrunk('origin/main')).toBe(false)
    expect(isTrunk('origin/master')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isTrunk('')).toBe(false)
  })

  it('returns false for similar but different names', () => {
    expect(isTrunk('main-feature')).toBe(false)
    expect(isTrunk('master2')).toBe(false)
    expect(isTrunk('Main')).toBe(false) // case sensitive
    expect(isTrunk('MASTER')).toBe(false)
  })
})
