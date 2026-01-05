import { describe, expect, it } from 'vitest'
import { extractRepoName } from '../git-url'

describe('extractRepoName', () => {
  describe('HTTPS URLs', () => {
    it('extracts repo name from HTTPS URL with .git suffix', () => {
      expect(extractRepoName('https://github.com/user/repo.git')).toBe('repo')
    })

    it('extracts repo name from HTTPS URL without .git suffix', () => {
      expect(extractRepoName('https://github.com/user/repo')).toBe('repo')
    })

    it('extracts repo name from GitLab HTTPS URL', () => {
      expect(extractRepoName('https://gitlab.com/org/project.git')).toBe('project')
    })

    it('handles URLs with nested paths', () => {
      expect(extractRepoName('https://github.com/org/subgroup/repo.git')).toBe('repo')
    })
  })

  describe('SSH URLs', () => {
    it('extracts repo name from SSH URL with .git suffix', () => {
      expect(extractRepoName('git@github.com:user/repo.git')).toBe('repo')
    })

    it('extracts repo name from SSH URL without .git suffix', () => {
      expect(extractRepoName('git@github.com:user/repo')).toBe('repo')
    })

    it('extracts repo name from GitLab SSH URL', () => {
      expect(extractRepoName('git@gitlab.com:org/project.git')).toBe('project')
    })

    it('handles SSH URLs with nested paths', () => {
      expect(extractRepoName('git@gitlab.com:org/subgroup/repo.git')).toBe('repo')
    })
  })

  describe('edge cases', () => {
    it('handles URL with trailing whitespace', () => {
      expect(extractRepoName('https://github.com/user/repo.git   ')).toBe('repo')
    })

    it('handles URL with leading whitespace', () => {
      expect(extractRepoName('   https://github.com/user/repo.git')).toBe('repo')
    })

    it('returns null for empty string', () => {
      expect(extractRepoName('')).toBe(null)
    })

    it('returns null for whitespace only', () => {
      expect(extractRepoName('   ')).toBe(null)
    })

    it('returns null for URL without path separator', () => {
      expect(extractRepoName('invalid-url')).toBe(null)
    })

    it('returns null for URL ending with separator', () => {
      expect(extractRepoName('https://github.com/user/')).toBe(null)
    })

    it('handles Bitbucket SSH URLs', () => {
      expect(extractRepoName('git@bitbucket.org:team/project.git')).toBe('project')
    })

    it('handles self-hosted GitLab URLs', () => {
      expect(extractRepoName('https://git.company.com/team/internal-tool.git')).toBe('internal-tool')
    })

    it('handles repo names with hyphens and numbers', () => {
      expect(extractRepoName('https://github.com/user/my-repo-123.git')).toBe('my-repo-123')
    })
  })
})
