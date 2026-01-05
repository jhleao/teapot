import { describe, expect, it } from 'vitest'
import { extractRepoName, isValidGitUrl, parseGitCloneError } from '../GitUrlParser'

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
      expect(extractRepoName('https://git.company.com/team/internal-tool.git')).toBe(
        'internal-tool'
      )
    })

    it('handles repo names with hyphens and numbers', () => {
      expect(extractRepoName('https://github.com/user/my-repo-123.git')).toBe('my-repo-123')
    })
  })
})

describe('isValidGitUrl', () => {
  describe('valid URLs', () => {
    it('accepts HTTPS GitHub URL', () => {
      expect(isValidGitUrl('https://github.com/user/repo.git')).toBe(true)
    })

    it('accepts HTTPS URL without .git', () => {
      expect(isValidGitUrl('https://github.com/user/repo')).toBe(true)
    })

    it('accepts SSH URL', () => {
      expect(isValidGitUrl('git@github.com:user/repo.git')).toBe(true)
    })

    it('accepts git protocol URL', () => {
      expect(isValidGitUrl('git://github.com/user/repo.git')).toBe(true)
    })

    it('accepts HTTP URL', () => {
      expect(isValidGitUrl('http://github.com/user/repo.git')).toBe(true)
    })

    it('accepts file:// URL for local repos', () => {
      expect(isValidGitUrl('file:///path/to/repo')).toBe(true)
    })
  })

  describe('invalid URLs', () => {
    it('rejects empty string', () => {
      expect(isValidGitUrl('')).toBe(false)
    })

    it('rejects whitespace only', () => {
      expect(isValidGitUrl('   ')).toBe(false)
    })

    it('rejects plain text', () => {
      expect(isValidGitUrl('not-a-url')).toBe(false)
    })

    it('rejects URL without path', () => {
      expect(isValidGitUrl('https://github.com')).toBe(false)
    })

    it('rejects SSH URL without path', () => {
      expect(isValidGitUrl('git@github.com')).toBe(false)
    })
  })
})

describe('parseGitCloneError', () => {
  const httpsUrl = 'https://github.com/user/repo.git'
  const sshUrl = 'git@github.com:user/repo.git'

  it('detects authentication failed error for HTTPS', () => {
    const result = parseGitCloneError('Authentication failed for url', httpsUrl)
    expect(result.isAuthError).toBe(true)
    expect(result.userMessage).toContain('SSH URL')
  })

  it('detects could not read username error', () => {
    const result = parseGitCloneError('could not read Username', httpsUrl)
    expect(result.isAuthError).toBe(true)
  })

  it('detects SSH permission denied error', () => {
    const result = parseGitCloneError('Permission denied (publickey)', sshUrl)
    expect(result.isAuthError).toBe(true)
    expect(result.userMessage).toContain('SSH key')
  })

  it('detects repository not found error', () => {
    const result = parseGitCloneError('Repository not found', httpsUrl)
    expect(result.isAuthError).toBe(false)
    expect(result.userMessage).toContain('not found')
  })

  it('detects host key verification error for SSH', () => {
    const result = parseGitCloneError('Host key verification failed', sshUrl)
    expect(result.isAuthError).toBe(true)
    expect(result.userMessage).toContain('ssh -T')
  })

  it('returns original message for unknown errors', () => {
    const result = parseGitCloneError('Some random error', httpsUrl)
    expect(result.isAuthError).toBe(false)
    expect(result.userMessage).toBe('Some random error')
  })
})
