/**
 * Tests for shared repo type utilities
 */

import { describe, expect, it } from 'vitest'
import { extractLocalBranchName, isTrunk, isTrunkRef, TRUNK_BRANCHES } from '../repo'

describe('TRUNK_BRANCHES', () => {
  it('contains all canonical trunk names', () => {
    expect(TRUNK_BRANCHES).toContain('main')
    expect(TRUNK_BRANCHES).toContain('master')
    expect(TRUNK_BRANCHES).toContain('develop')
    expect(TRUNK_BRANCHES).toContain('trunk')
  })

  it('has exactly four entries', () => {
    expect(TRUNK_BRANCHES).toHaveLength(4)
  })

  it('is ordered by preference (main first)', () => {
    expect(TRUNK_BRANCHES[0]).toBe('main')
    expect(TRUNK_BRANCHES[1]).toBe('master')
  })
})

describe('isTrunk', () => {
  it('returns true for main', () => {
    expect(isTrunk('main')).toBe(true)
  })

  it('returns true for master', () => {
    expect(isTrunk('master')).toBe(true)
  })

  it('returns true for develop and trunk', () => {
    expect(isTrunk('develop')).toBe(true)
    expect(isTrunk('trunk')).toBe(true)
  })

  it('returns false for feature branches', () => {
    expect(isTrunk('feature-1')).toBe(false)
    expect(isTrunk('release/1.0')).toBe(false)
  })

  it('returns false for remote trunk refs (use isTrunkRef for remote refs)', () => {
    // Remote refs like origin/main are NOT trunk via isTrunk - they include the remote prefix
    // Use isTrunkRef(ref, true) to check remote refs
    expect(isTrunk('origin/main')).toBe(false)
    expect(isTrunk('origin/master')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isTrunk('')).toBe(false)
  })

  it('returns false for similar but different names', () => {
    expect(isTrunk('main-feature')).toBe(false)
    expect(isTrunk('master2')).toBe(false)
  })

  // Case-insensitive tests for Windows compatibility
  describe('case insensitivity (Windows compatibility)', () => {
    it('returns true for MAIN, Main, mAiN', () => {
      expect(isTrunk('MAIN')).toBe(true)
      expect(isTrunk('Main')).toBe(true)
      expect(isTrunk('mAiN')).toBe(true)
    })

    it('returns true for MASTER, Master, mAsTeR', () => {
      expect(isTrunk('MASTER')).toBe(true)
      expect(isTrunk('Master')).toBe(true)
      expect(isTrunk('mAsTeR')).toBe(true)
    })

    it('returns true for DEVELOP, Develop, dEvElOp', () => {
      expect(isTrunk('DEVELOP')).toBe(true)
      expect(isTrunk('Develop')).toBe(true)
      expect(isTrunk('dEvElOp')).toBe(true)
    })

    it('returns true for TRUNK, Trunk, tRuNk', () => {
      expect(isTrunk('TRUNK')).toBe(true)
      expect(isTrunk('Trunk')).toBe(true)
      expect(isTrunk('tRuNk')).toBe(true)
    })
  })
})

describe('extractLocalBranchName', () => {
  it('strips remote prefix from remote refs', () => {
    expect(extractLocalBranchName('origin/main')).toBe('main')
    expect(extractLocalBranchName('origin/master')).toBe('master')
    expect(extractLocalBranchName('upstream/develop')).toBe('develop')
  })

  it('handles nested branch names with slashes', () => {
    expect(extractLocalBranchName('origin/feature/foo')).toBe('feature/foo')
    expect(extractLocalBranchName('origin/release/1.0/hotfix')).toBe('release/1.0/hotfix')
  })

  it('returns local branch names unchanged', () => {
    expect(extractLocalBranchName('main')).toBe('main')
    expect(extractLocalBranchName('feature-branch')).toBe('feature-branch')
  })

  it('handles empty string', () => {
    expect(extractLocalBranchName('')).toBe('')
  })
})

describe('isTrunkRef', () => {
  describe('local refs (isRemote=false)', () => {
    it('returns true for trunk names', () => {
      expect(isTrunkRef('main', false)).toBe(true)
      expect(isTrunkRef('master', false)).toBe(true)
      expect(isTrunkRef('develop', false)).toBe(true)
      expect(isTrunkRef('trunk', false)).toBe(true)
    })

    it('returns true for trunk names with different case', () => {
      expect(isTrunkRef('MAIN', false)).toBe(true)
      expect(isTrunkRef('Master', false)).toBe(true)
    })

    it('returns false for non-trunk names', () => {
      expect(isTrunkRef('feature', false)).toBe(false)
      expect(isTrunkRef('release/1.0', false)).toBe(false)
    })

    it('returns false for remote refs when isRemote=false', () => {
      // When isRemote=false, the ref is treated as-is (not stripped)
      expect(isTrunkRef('origin/main', false)).toBe(false)
    })
  })

  describe('remote refs (isRemote=true)', () => {
    it('returns true for remote trunk refs', () => {
      expect(isTrunkRef('origin/main', true)).toBe(true)
      expect(isTrunkRef('origin/master', true)).toBe(true)
      expect(isTrunkRef('upstream/develop', true)).toBe(true)
    })

    it('returns true for remote trunk refs with different case', () => {
      expect(isTrunkRef('origin/MAIN', true)).toBe(true)
      expect(isTrunkRef('upstream/Master', true)).toBe(true)
    })

    it('returns false for remote non-trunk refs', () => {
      expect(isTrunkRef('origin/feature', true)).toBe(false)
      expect(isTrunkRef('upstream/release/1.0', true)).toBe(false)
    })
  })

  describe('default isRemote parameter', () => {
    it('defaults to isRemote=false', () => {
      expect(isTrunkRef('main')).toBe(true)
      expect(isTrunkRef('origin/main')).toBe(false) // no stripping by default
    })
  })
})
