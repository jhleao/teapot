/**
 * Tests for BranchUtils pure functions
 */

import { describe, expect, it } from 'vitest'
import { BranchUtils } from '../BranchUtils'

describe('BranchUtils', () => {
  describe('parseRemoteBranch', () => {
    it('parses origin/main correctly', () => {
      const result = BranchUtils.parseRemoteBranch('origin/main')
      expect(result).toEqual({ remote: 'origin', localBranch: 'main' })
    })

    it('parses origin/master correctly', () => {
      const result = BranchUtils.parseRemoteBranch('origin/master')
      expect(result).toEqual({ remote: 'origin', localBranch: 'master' })
    })

    it('parses origin/feature/foo correctly (nested slashes)', () => {
      const result = BranchUtils.parseRemoteBranch('origin/feature/foo')
      expect(result).toEqual({ remote: 'origin', localBranch: 'feature/foo' })
    })

    it('parses origin/feature/foo/bar/baz correctly (deeply nested)', () => {
      const result = BranchUtils.parseRemoteBranch('origin/feature/foo/bar/baz')
      expect(result).toEqual({ remote: 'origin', localBranch: 'feature/foo/bar/baz' })
    })

    it('parses refs/remotes/origin/main correctly', () => {
      const result = BranchUtils.parseRemoteBranch('refs/remotes/origin/main')
      expect(result).toEqual({ remote: 'origin', localBranch: 'main' })
    })

    it('parses refs/remotes/origin/feature/foo correctly', () => {
      const result = BranchUtils.parseRemoteBranch('refs/remotes/origin/feature/foo')
      expect(result).toEqual({ remote: 'origin', localBranch: 'feature/foo' })
    })

    it('parses upstream/main correctly (different remote)', () => {
      const result = BranchUtils.parseRemoteBranch('upstream/main')
      expect(result).toEqual({ remote: 'upstream', localBranch: 'main' })
    })

    it('returns null for local branch (no slash)', () => {
      expect(BranchUtils.parseRemoteBranch('main')).toBeNull()
      expect(BranchUtils.parseRemoteBranch('feature')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(BranchUtils.parseRemoteBranch('')).toBeNull()
    })
  })

  describe('normalizeBranchRef', () => {
    it('strips remote prefix for remote branches', () => {
      expect(BranchUtils.normalizeBranchRef('origin/main', true)).toBe('main')
      expect(BranchUtils.normalizeBranchRef('origin/feature/foo', true)).toBe('feature/foo')
    })

    it('returns as-is for local branches', () => {
      expect(BranchUtils.normalizeBranchRef('main', false)).toBe('main')
      expect(BranchUtils.normalizeBranchRef('feature/foo', false)).toBe('feature/foo')
    })
  })

  describe('isRemoteBranchRef', () => {
    it('returns true for origin prefixed refs', () => {
      expect(BranchUtils.isRemoteBranchRef('origin/main')).toBe(true)
      expect(BranchUtils.isRemoteBranchRef('origin/feature')).toBe(true)
    })

    it('returns true for upstream prefixed refs', () => {
      expect(BranchUtils.isRemoteBranchRef('upstream/main')).toBe(true)
    })

    it('returns false for local branches', () => {
      expect(BranchUtils.isRemoteBranchRef('main')).toBe(false)
      expect(BranchUtils.isRemoteBranchRef('feature/foo')).toBe(false)
    })
  })

  describe('isSymbolicBranch', () => {
    it('returns true for HEAD', () => {
      expect(BranchUtils.isSymbolicBranch('HEAD')).toBe(true)
    })

    it('returns true for refs ending with /HEAD', () => {
      expect(BranchUtils.isSymbolicBranch('origin/HEAD')).toBe(true)
    })

    it('returns false for regular branches', () => {
      expect(BranchUtils.isSymbolicBranch('main')).toBe(false)
      expect(BranchUtils.isSymbolicBranch('origin/main')).toBe(false)
    })
  })

  describe('getBranchName', () => {
    it('returns ref as-is for local branches', () => {
      expect(BranchUtils.getBranchName('main', false)).toBe('main')
      expect(BranchUtils.getBranchName('feature/foo', false)).toBe('feature/foo')
    })

    it('strips remote prefix for remote branches', () => {
      expect(BranchUtils.getBranchName('origin/main', true)).toBe('main')
      expect(BranchUtils.getBranchName('origin/feature/foo', true)).toBe('feature/foo')
    })
  })

  describe('generateRandomBranchName', () => {
    it('generates branch name with default prefix', () => {
      const name = BranchUtils.generateRandomBranchName()
      expect(name).toMatch(/^branch-[a-z]+-[a-z]+-\d+$/)
    })

    it('generates branch name with custom prefix', () => {
      const name = BranchUtils.generateRandomBranchName('feature')
      expect(name).toMatch(/^feature-[a-z]+-[a-z]+-\d+$/)
    })
  })

  describe('generateUserBranchName', () => {
    it('generates branch name from username', () => {
      const name = BranchUtils.generateUserBranchName('John Doe')
      expect(name).toMatch(/^john-doe-[a-z0-9]+$/)
    })

    it('sanitizes special characters', () => {
      const name = BranchUtils.generateUserBranchName('user@example.com')
      expect(name).toMatch(/^user-example-com-[a-z0-9]+$/)
    })

    it('handles empty spaces correctly', () => {
      const name = BranchUtils.generateUserBranchName('  username  ')
      expect(name).toMatch(/^username-[a-z0-9]+$/)
    })
  })

  describe('validateBranchName', () => {
    it('returns null for valid branch names', () => {
      expect(BranchUtils.validateBranchName('main')).toBeNull()
      expect(BranchUtils.validateBranchName('feature/foo')).toBeNull()
      expect(BranchUtils.validateBranchName('fix-123')).toBeNull()
    })

    it('returns error for empty name', () => {
      expect(BranchUtils.validateBranchName('')).toBe('Branch name cannot be empty')
      expect(BranchUtils.validateBranchName('  ')).toBe('Branch name cannot be empty')
    })

    it('returns error for name starting with hyphen', () => {
      expect(BranchUtils.validateBranchName('-feature')).toBe(
        'Branch name cannot start with a hyphen'
      )
    })

    it('returns error for name ending with dot', () => {
      expect(BranchUtils.validateBranchName('feature.')).toBe('Branch name cannot end with a dot')
    })

    it('returns error for name ending with .lock', () => {
      expect(BranchUtils.validateBranchName('feature.lock')).toBe(
        'Branch name cannot end with .lock'
      )
    })

    it('returns error for name with double dots', () => {
      expect(BranchUtils.validateBranchName('feature..bar')).toBe('Branch name cannot contain ..')
    })

    it('returns error for name with @{', () => {
      expect(BranchUtils.validateBranchName('feature@{bar}')).toBe('Branch name cannot contain @{')
    })

    it('returns error for name with spaces', () => {
      expect(BranchUtils.validateBranchName('feature bar')).toBe(
        'Branch name cannot contain spaces'
      )
    })
  })
})
