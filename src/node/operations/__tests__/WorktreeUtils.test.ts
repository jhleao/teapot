import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store to avoid electron-store initialization
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null),
    getActiveWorktree: vi.fn().mockReturnValue(null),
    setActiveWorktree: vi.fn()
  }
}))

import {
  clearGitDirCache,
  isWorktreeConflictError,
  isWorktreeStale,
  normalizePath,
  parseWorktreeConflictError,
  pruneIfStale,
  pruneStaleWorktrees,
  resolveGitDir,
  resolveGitDirSync,
  retryWithPrune
} from '../WorktreeUtils'

describe('normalizePath', () => {
  it('should resolve symlinks for existing paths', async () => {
    // Create a temp directory
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-normalize-'))

    try {
      // The temp directory should resolve to its real path
      const result = await normalizePath(tempDir)

      // On macOS, /var is symlinked to /private/var, so the resolved path
      // should match what fs.promises.realpath returns
      const expected = await fs.promises.realpath(tempDir)
      expect(result).toBe(expected)
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('should resolve parent symlinks for non-existent child paths', async () => {
    // Create a temp directory
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-normalize-'))

    try {
      // Create a non-existent child path
      const nonExistentPath = path.join(tempDir, 'does-not-exist', 'nested')

      const result = await normalizePath(nonExistentPath)

      // The parent should be resolved, child segments appended
      const resolvedParent = await fs.promises.realpath(tempDir)
      expect(result).toBe(path.join(resolvedParent, 'does-not-exist', 'nested'))
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('should return original path when no parents can be resolved', async () => {
    // A completely non-existent path with no resolvable parents
    const nonExistentPath = '/completely/fake/path/that/does/not/exist'

    const result = await normalizePath(nonExistentPath)

    // Should return the original path since nothing can be resolved
    expect(result).toBe(nonExistentPath)
  })

  it('should handle paths with multiple levels of non-existent directories', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-normalize-'))

    try {
      // Create a subdirectory
      const subDir = path.join(tempDir, 'existing-sub')
      await fs.promises.mkdir(subDir)

      // Non-existent path beyond the existing subdirectory
      const nonExistentPath = path.join(subDir, 'level1', 'level2', 'level3')

      const result = await normalizePath(nonExistentPath)

      // The resolved subDir should be the base, with remaining segments appended
      const resolvedSubDir = await fs.promises.realpath(subDir)
      expect(result).toBe(path.join(resolvedSubDir, 'level1', 'level2', 'level3'))
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('should resolve actual symlinks to their target', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-symlink-'))

    try {
      // Create a real directory
      const realDir = path.join(tempDir, 'real-dir')
      await fs.promises.mkdir(realDir)

      // Create a symlink pointing to it
      const symlinkPath = path.join(tempDir, 'symlink-to-real')
      await fs.promises.symlink(realDir, symlinkPath)

      // normalizePath should resolve the symlink to the real path
      const result = await normalizePath(symlinkPath)

      // The result should be the real path, not the symlink
      const expectedRealPath = await fs.promises.realpath(realDir)
      expect(result).toBe(expectedRealPath)
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('should resolve symlinks in parent directories for non-existent paths', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-symlink-'))

    try {
      // Create a real directory
      const realDir = path.join(tempDir, 'real-parent')
      await fs.promises.mkdir(realDir)

      // Create a symlink pointing to it
      const symlinkPath = path.join(tempDir, 'symlink-parent')
      await fs.promises.symlink(realDir, symlinkPath)

      // Reference a non-existent child through the symlink
      const nonExistentChild = path.join(symlinkPath, 'child-does-not-exist')

      const result = await normalizePath(nonExistentChild)

      // Should resolve the symlink parent and append the child
      const expectedRealParent = await fs.promises.realpath(realDir)
      expect(result).toBe(path.join(expectedRealParent, 'child-does-not-exist'))
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('resolveGitDir', () => {
  let repoPath: string

  beforeEach(async () => {
    clearGitDirCache()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-resolve-git-dir-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })
  })

  afterEach(async () => {
    clearGitDirCache()
    try {
      execSync('git worktree prune', { cwd: repoPath })
    } catch {
      // ignore
    }
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should return .git path for regular repository', async () => {
    const result = await resolveGitDir(repoPath)
    expect(result).toBe(path.join(repoPath, '.git'))
  })

  it('should resolve gitdir pointer for linked worktree', async () => {
    // Create a linked worktree
    const worktreePath = path.join(os.tmpdir(), `teapot-test-linked-wt-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" -b linked-branch`, { cwd: repoPath })

    try {
      // Verify .git is a file in the linked worktree
      const gitPath = path.join(worktreePath, '.git')
      const stat = await fs.promises.stat(gitPath)
      expect(stat.isFile()).toBe(true)

      // resolveGitDir should return the actual git directory
      const result = await resolveGitDir(worktreePath)
      expect(result).toContain('.git/worktrees/')
      expect(result).not.toBe(gitPath)

      // Should be able to access files in the resolved directory
      const headPath = path.join(result, 'HEAD')
      expect(fs.existsSync(headPath)).toBe(true)
    } finally {
      execSync(`git worktree remove "${worktreePath}"`, { cwd: repoPath })
    }
  })

  it('should cache results for repeated calls', async () => {
    clearGitDirCache()

    const result1 = await resolveGitDir(repoPath)
    const result2 = await resolveGitDir(repoPath)

    expect(result1).toBe(result2)
  })

  it('should handle non-existent paths gracefully', async () => {
    const result = await resolveGitDir('/non/existent/path')
    expect(result).toBe('/non/existent/path/.git')
  })
})

describe('resolveGitDirSync', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-resolve-sync-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })
  })

  afterEach(async () => {
    try {
      execSync('git worktree prune', { cwd: repoPath })
    } catch {
      // ignore
    }
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should work synchronously for regular repository', () => {
    const result = resolveGitDirSync(repoPath)
    expect(result).toBe(path.join(repoPath, '.git'))
  })

  it('should resolve gitdir pointer synchronously for linked worktree', async () => {
    const worktreePath = path.join(os.tmpdir(), `teapot-test-linked-sync-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" -b linked-sync-branch`, { cwd: repoPath })

    try {
      const result = resolveGitDirSync(worktreePath)
      expect(result).toContain('.git/worktrees/')
    } finally {
      execSync(`git worktree remove "${worktreePath}"`, { cwd: repoPath })
    }
  })

  it('should handle non-existent paths gracefully', () => {
    const result = resolveGitDirSync('/non/existent/path')
    expect(result).toBe('/non/existent/path/.git')
  })
})

describe('WorktreeUtils', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-worktree-utils-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    // Create initial commit
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })
  })

  afterEach(async () => {
    // Clean up any worktrees first
    try {
      execSync('git worktree prune', { cwd: repoPath })
    } catch {
      // ignore
    }
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  describe('parseWorktreeConflictError', () => {
    it('should parse "already used by worktree" error', () => {
      const error = new Error("fatal: 'feature' is already used by worktree at '/path/to/worktree'")
      const result = parseWorktreeConflictError(error)
      expect(result).toEqual({ worktreePath: '/path/to/worktree' })
    })

    it('should parse "checked out in worktree" error', () => {
      const error = new Error(
        "fatal: cannot checkout 'feature': checked out in worktree at '/another/path'"
      )
      const result = parseWorktreeConflictError(error)
      expect(result).toEqual({ worktreePath: '/another/path' })
    })

    it('should return null for non-worktree errors', () => {
      const error = new Error('fatal: some other git error')
      const result = parseWorktreeConflictError(error)
      expect(result).toBeNull()
    })

    it('should handle string errors', () => {
      const result = parseWorktreeConflictError("already used by worktree at '/some/path'")
      expect(result).toEqual({ worktreePath: '/some/path' })
    })
  })

  describe('isWorktreeConflictError', () => {
    it('should return true for worktree conflict errors', () => {
      const error = new Error("fatal: 'branch' is already used by worktree at '/path'")
      expect(isWorktreeConflictError(error)).toBe(true)
    })

    it('should return false for other errors', () => {
      const error = new Error('fatal: not a worktree error')
      expect(isWorktreeConflictError(error)).toBe(false)
    })
  })

  describe('pruneStaleWorktrees', () => {
    it('should successfully prune when there are no stale worktrees', async () => {
      const result = await pruneStaleWorktrees(repoPath)
      expect(result.pruned).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should successfully prune stale worktree references', async () => {
      // Create a worktree
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b test-branch`, { cwd: repoPath })

      // Manually delete the worktree directory (simulating crash/external deletion)
      await fs.promises.rm(worktreePath, { recursive: true, force: true })

      // Verify the worktree is still in git's list (as stale)
      const beforePrune = execSync('git worktree list --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8'
      })
      expect(beforePrune).toContain(worktreePath)

      // Prune
      const result = await pruneStaleWorktrees(repoPath)
      expect(result.pruned).toBe(true)

      // Verify the worktree is gone from git's list
      const afterPrune = execSync('git worktree list --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8'
      })
      expect(afterPrune).not.toContain(worktreePath)
    })
  })

  describe('isWorktreeStale', () => {
    it('should return false for a valid worktree', async () => {
      // Create a worktree
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-valid-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b valid-branch`, { cwd: repoPath })

      try {
        const result = await isWorktreeStale(repoPath, worktreePath)
        expect(result.isStale).toBe(false)
      } finally {
        execSync(`git worktree remove "${worktreePath}"`, { cwd: repoPath })
      }
    })

    it('should return true for a worktree whose directory was deleted', async () => {
      // Create a worktree
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-stale-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b stale-branch`, { cwd: repoPath })

      // Delete the worktree directory manually
      await fs.promises.rm(worktreePath, { recursive: true, force: true })

      const result = await isWorktreeStale(repoPath, worktreePath)
      expect(result.isStale).toBe(true)
      expect(result.reason).toBe('directory_missing')

      // Clean up
      execSync('git worktree prune', { cwd: repoPath })
    })

    it('should return false for a non-existent worktree path', async () => {
      const result = await isWorktreeStale(repoPath, '/non/existent/path')
      expect(result.isStale).toBe(false)
    })
  })

  describe('pruneIfStale', () => {
    it('should not prune a valid worktree', async () => {
      // Create a worktree
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-prune-valid-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b prune-valid-branch`, { cwd: repoPath })

      try {
        const result = await pruneIfStale(repoPath, worktreePath)
        expect(result.wasStale).toBe(false)
        expect(result.pruned).toBe(false)

        // Worktree should still exist in git's list
        const list = execSync('git worktree list --porcelain', {
          cwd: repoPath,
          encoding: 'utf-8'
        })
        expect(list).toContain(worktreePath)
      } finally {
        execSync(`git worktree remove "${worktreePath}"`, { cwd: repoPath })
      }
    })

    it('should prune a stale worktree', async () => {
      // Create a worktree
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-prune-stale-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b prune-stale-branch`, { cwd: repoPath })

      // Delete the directory
      await fs.promises.rm(worktreePath, { recursive: true, force: true })

      const result = await pruneIfStale(repoPath, worktreePath)
      expect(result.wasStale).toBe(true)
      expect(result.pruned).toBe(true)
      expect(result.reason).toBe('directory_missing')

      // Worktree should be gone from git's list
      const list = execSync('git worktree list --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8'
      })
      expect(list).not.toContain(worktreePath)
    })
  })

  describe('retryWithPrune', () => {
    it('should return result on first successful attempt', async () => {
      const operation = vi.fn().mockResolvedValue({ success: true, value: 42 })

      const result = await retryWithPrune(operation, { repoPath })

      expect(result).toEqual({ success: true, value: 42 })
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should throw non-worktree errors without retrying', async () => {
      const error = new Error('some other error')
      const operation = vi.fn().mockRejectedValue(error)

      await expect(retryWithPrune(operation, { repoPath })).rejects.toThrow('some other error')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry after pruning stale worktree', async () => {
      // Create a worktree and make it stale
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-retry-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b retry-branch`, { cwd: repoPath })
      await fs.promises.rm(worktreePath, { recursive: true, force: true })

      let callCount = 0
      const operation = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error(`fatal: 'retry-branch' is already used by worktree at '${worktreePath}'`)
        }
        return Promise.resolve({ success: true })
      })

      const onRetry = vi.fn()
      const result = await retryWithPrune(operation, { repoPath, onRetry })

      expect(result).toEqual({ success: true })
      expect(operation).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('should not retry if worktree is valid (not stale)', async () => {
      // Create a valid worktree
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-valid-retry-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b valid-retry-branch`, { cwd: repoPath })

      try {
        const operation = vi
          .fn()
          .mockRejectedValue(
            new Error(
              `fatal: 'valid-retry-branch' is already used by worktree at '${worktreePath}'`
            )
          )

        await expect(retryWithPrune(operation, { repoPath })).rejects.toThrow('already used by')
        expect(operation).toHaveBeenCalledTimes(1)
      } finally {
        execSync(`git worktree remove "${worktreePath}"`, { cwd: repoPath })
      }
    })

    it('should respect maxRetries option', async () => {
      // Create a worktree and make it stale
      const worktreePath = path.join(os.tmpdir(), `teapot-test-wt-max-retry-${Date.now()}`)
      execSync(`git worktree add "${worktreePath}" -b max-retry-branch`, { cwd: repoPath })
      await fs.promises.rm(worktreePath, { recursive: true, force: true })

      // Always throw, but prune will eventually make the worktree disappear from git
      // so we need a different approach - mock the error to persist
      const operation = vi
        .fn()
        .mockRejectedValue(
          new Error(`fatal: 'max-retry-branch' is already used by worktree at '${worktreePath}'`)
        )

      // With maxRetries: 0, should not retry at all
      await expect(retryWithPrune(operation, { repoPath, maxRetries: 0 })).rejects.toThrow(
        'already used by'
      )
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })
})
