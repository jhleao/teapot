import { describe, expect, it } from 'vitest'
import { extractRepoName, isValidGitUrl, validateFolderName } from '../git-url'

describe('extractRepoName', () => {
  it('extracts repo name from HTTPS URL with .git', () => {
    expect(extractRepoName('https://github.com/user/repo.git')).toBe('repo')
  })

  it('extracts repo name from HTTPS URL without .git', () => {
    expect(extractRepoName('https://github.com/user/repo')).toBe('repo')
  })

  it('extracts repo name from SSH URL with .git', () => {
    expect(extractRepoName('git@github.com:user/repo.git')).toBe('repo')
  })

  it('extracts repo name from SSH URL without .git', () => {
    expect(extractRepoName('git@github.com:user/repo')).toBe('repo')
  })

  it('handles nested paths', () => {
    expect(extractRepoName('https://github.com/org/subgroup/repo.git')).toBe('repo')
  })

  it('returns null for empty string', () => {
    expect(extractRepoName('')).toBe(null)
  })

  it('returns null for whitespace', () => {
    expect(extractRepoName('   ')).toBe(null)
  })

  it('returns null for URL without path', () => {
    expect(extractRepoName('https://github.com/')).toBe(null)
  })
})

describe('isValidGitUrl', () => {
  it('accepts HTTPS URLs', () => {
    expect(isValidGitUrl('https://github.com/user/repo.git')).toBe(true)
  })

  it('accepts HTTP URLs', () => {
    expect(isValidGitUrl('http://github.com/user/repo.git')).toBe(true)
  })

  it('accepts SSH URLs', () => {
    expect(isValidGitUrl('git@github.com:user/repo.git')).toBe(true)
  })

  it('accepts git protocol URLs', () => {
    expect(isValidGitUrl('git://github.com/user/repo.git')).toBe(true)
  })

  it('accepts file protocol URLs', () => {
    expect(isValidGitUrl('file:///path/to/repo')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidGitUrl('')).toBe(false)
  })

  it('rejects plain text', () => {
    expect(isValidGitUrl('not-a-url')).toBe(false)
  })

  it('rejects URLs without path', () => {
    expect(isValidGitUrl('https://github.com')).toBe(false)
  })
})

describe('validateFolderName', () => {
  it('returns null for valid folder names', () => {
    expect(validateFolderName('my-repo')).toBe(null)
    expect(validateFolderName('my_repo')).toBe(null)
    expect(validateFolderName('MyRepo123')).toBe(null)
  })

  it('returns null for empty string (incomplete)', () => {
    expect(validateFolderName('')).toBe(null)
  })

  it('rejects folder names with invalid characters', () => {
    expect(validateFolderName('my/repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my\\repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my:repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my*repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my?repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my"repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my<repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my>repo')).toBe('Folder name contains invalid characters')
    expect(validateFolderName('my|repo')).toBe('Folder name contains invalid characters')
  })

  it('rejects Windows reserved names', () => {
    expect(validateFolderName('CON')).toBe('This name is reserved by the system')
    expect(validateFolderName('con')).toBe('This name is reserved by the system')
    expect(validateFolderName('PRN')).toBe('This name is reserved by the system')
    expect(validateFolderName('AUX')).toBe('This name is reserved by the system')
    expect(validateFolderName('NUL')).toBe('This name is reserved by the system')
    expect(validateFolderName('COM1')).toBe('This name is reserved by the system')
    expect(validateFolderName('LPT1')).toBe('This name is reserved by the system')
  })

  it('rejects folder names ending with dot or space', () => {
    expect(validateFolderName('repo.')).toBe('Folder name cannot end with a dot or space')
    expect(validateFolderName('repo ')).toBe('Folder name cannot end with a dot or space')
  })

  it('rejects folder names that are too long', () => {
    const longName = 'a'.repeat(256)
    expect(validateFolderName(longName)).toBe('Folder name is too long')
  })

  it('accepts folder names at max length', () => {
    const maxName = 'a'.repeat(255)
    expect(validateFolderName(maxName)).toBe(null)
  })
})
