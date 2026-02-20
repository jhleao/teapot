/**
 * Tests for WorktreeOperation — Phase 1: persistent paths and createAtPath
 *
 * Covers:
 * - computeDefaultWorktreePath: pure path computation
 * - createAtPath: validation + creation at user-specified paths
 * - create: uses persistent sibling paths by default
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron-store before importing modules that use it
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null),
    getActiveWorktree: vi.fn().mockReturnValue(null),
    getPreferredEditor: vi.fn().mockReturnValue(null),
    getWorktreeBasePath: vi.fn().mockReturnValue(null)
  }
}))

import { configStore } from '../../store'
import { WorktreeOperation } from '../../operations'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function createTestRepo(): Promise<string> {
  const testDir = path.join(os.tmpdir(), `teapot-wt-op-test-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  const { execSync } = await import('child_process')
  execSync('git init', { cwd: testDir })
  execSync('git config user.email "test@test.com"', { cwd: testDir })
  execSync('git config user.name "Test"', { cwd: testDir })
  execSync('git config commit.gpgsign false', { cwd: testDir })

  const testFile = path.join(testDir, 'test.txt')
  fs.writeFileSync(testFile, 'initial content')
  execSync('git add .', { cwd: testDir })
  execSync('git commit --no-gpg-sign -m "initial"', { cwd: testDir })

  // Create a feature branch for worktree testing
  execSync('git branch feature', { cwd: testDir })

  return testDir
}

function cleanupTestRepo(testDir: string): void {
  try {
    fs.rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDefaultWorktreePath — pure unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WorktreeOperation.computeDefaultWorktreePath', () => {
  it('returns sibling path when no custom base path is configured', () => {
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue(null)

    const result = WorktreeOperation.computeDefaultWorktreePath('/home/user/myrepo', 'feature-auth')
    expect(result).toBe('/home/user/myrepo-feature-auth')
  })

  it('replaces slashes in branch name with hyphens', () => {
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue(null)

    const result = WorktreeOperation.computeDefaultWorktreePath('/home/user/myrepo', 'feature/auth')
    expect(result).toBe('/home/user/myrepo-feature-auth')
  })

  it('handles deeply nested branch names', () => {
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue(null)

    const result = WorktreeOperation.computeDefaultWorktreePath(
      '/home/user/myrepo',
      'feature/auth/oauth2'
    )
    expect(result).toBe('/home/user/myrepo-feature-auth-oauth2')
  })

  it('uses custom base path when configured', () => {
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue('/home/user/worktrees')

    const result = WorktreeOperation.computeDefaultWorktreePath('/home/user/myrepo', 'feature-auth')
    expect(result).toBe('/home/user/worktrees/myrepo-feature-auth')
  })

  it('uses custom base path and sanitizes branch slashes', () => {
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue('/home/user/worktrees')

    const result = WorktreeOperation.computeDefaultWorktreePath(
      '/home/user/myrepo',
      'fix/perf/slow-query'
    )
    expect(result).toBe('/home/user/worktrees/myrepo-fix-perf-slow-query')
  })

  it('extracts repo name correctly from path', () => {
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue(null)

    const result = WorktreeOperation.computeDefaultWorktreePath(
      '/very/deep/nested/path/to/my-project',
      'main'
    )
    expect(result).toBe('/very/deep/nested/path/to/my-project-main')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createAtPath — integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WorktreeOperation.createAtPath', () => {
  let testRepo: string
  const createdPaths: string[] = []

  beforeEach(async () => {
    testRepo = await createTestRepo()
  })

  afterEach(async () => {
    const { execSync } = await import('child_process')
    for (const worktreePath of createdPaths) {
      try {
        execSync(`git -C "${testRepo}" worktree remove --force "${worktreePath}"`)
      } catch {
        // Ignore
      }
    }
    createdPaths.length = 0
    cleanupTestRepo(testRepo)
  })

  it('creates a worktree at the specified path', async () => {
    const targetPath = path.join(os.tmpdir(), `teapot-wt-custom-${Date.now()}`)
    const result = await WorktreeOperation.createAtPath(testRepo, 'feature', targetPath)
    if (result.worktreePath) createdPaths.push(result.worktreePath)

    expect(result.success).toBe(true)
    expect(result.worktreePath).toBeDefined()

    // Verify the directory exists
    const stat = await fs.promises.stat(result.worktreePath!)
    expect(stat.isDirectory()).toBe(true)
  })

  it('rejects non-empty existing directory', async () => {
    const targetPath = path.join(os.tmpdir(), `teapot-wt-nonempty-${Date.now()}`)
    await fs.promises.mkdir(targetPath, { recursive: true })
    await fs.promises.writeFile(path.join(targetPath, 'existing.txt'), 'data')

    const result = await WorktreeOperation.createAtPath(testRepo, 'feature', targetPath)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Directory already exists and is not empty.')

    // Cleanup
    await fs.promises.rm(targetPath, { recursive: true, force: true })
  })

  it('rejects when a file exists at the target path', async () => {
    const targetPath = path.join(os.tmpdir(), `teapot-wt-file-${Date.now()}`)
    await fs.promises.writeFile(targetPath, 'I am a file')

    const result = await WorktreeOperation.createAtPath(testRepo, 'feature', targetPath)

    expect(result.success).toBe(false)
    expect(result.error).toBe('A file already exists at that path.')

    // Cleanup
    await fs.promises.rm(targetPath, { force: true })
  })

  it('succeeds when target is an empty directory', async () => {
    const targetPath = path.join(os.tmpdir(), `teapot-wt-empty-${Date.now()}`)
    await fs.promises.mkdir(targetPath, { recursive: true })

    const result = await WorktreeOperation.createAtPath(testRepo, 'feature', targetPath)
    if (result.worktreePath) createdPaths.push(result.worktreePath)

    expect(result.success).toBe(true)
    expect(result.worktreePath).toBeDefined()
  })

  it('creates parent directories if they do not exist', async () => {
    const targetPath = path.join(
      os.tmpdir(),
      `teapot-wt-deep-${Date.now()}`,
      'nested',
      'deep',
      'worktree'
    )
    const result = await WorktreeOperation.createAtPath(testRepo, 'feature', targetPath)
    if (result.worktreePath) createdPaths.push(result.worktreePath)

    expect(result.success).toBe(true)

    // Cleanup the whole parent tree
    const topDir = path.join(os.tmpdir(), path.basename(path.dirname(path.dirname(path.dirname(targetPath)))))
    await fs.promises.rm(topDir, { recursive: true, force: true }).catch(() => {})
  })

  it('returns error when branch is already checked out in another worktree', async () => {
    // Create first worktree for 'feature'
    const firstPath = path.join(os.tmpdir(), `teapot-wt-first-${Date.now()}`)
    const first = await WorktreeOperation.createAtPath(testRepo, 'feature', firstPath)
    expect(first.success).toBe(true)
    if (first.worktreePath) createdPaths.push(first.worktreePath)

    // Try to create second worktree for the same branch
    const secondPath = path.join(os.tmpdir(), `teapot-wt-second-${Date.now()}`)
    const second = await WorktreeOperation.createAtPath(testRepo, 'feature', secondPath)

    expect(second.success).toBe(false)
    expect(second.error).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// create — uses persistent paths by default
// ─────────────────────────────────────────────────────────────────────────────

describe('WorktreeOperation.create (persistent paths)', () => {
  let testRepo: string
  const createdPaths: string[] = []

  beforeEach(async () => {
    testRepo = await createTestRepo()
    vi.mocked(configStore.getWorktreeBasePath).mockReturnValue(null)
  })

  afterEach(async () => {
    const { execSync } = await import('child_process')
    for (const worktreePath of createdPaths) {
      try {
        execSync(`git -C "${testRepo}" worktree remove --force "${worktreePath}"`)
      } catch {
        // Ignore
      }
    }
    createdPaths.length = 0
    cleanupTestRepo(testRepo)
  })

  it('creates worktree as sibling of repo by default (not in /tmp/teapot/)', async () => {
    const result = await WorktreeOperation.create(testRepo, 'feature')
    if (result.worktreePath) createdPaths.push(result.worktreePath)

    expect(result.success).toBe(true)
    expect(result.worktreePath).toBeDefined()

    // Should NOT be in /tmp/teapot/worktrees/ anymore
    expect(result.worktreePath).not.toContain('teapot/worktrees')

    // Should be a sibling of the test repo
    const repoParent = path.dirname(testRepo)
    const worktreeParent = path.dirname(result.worktreePath!)
    // After symlink resolution, both should share the same resolved parent
    const resolvedRepoParent = await fs.promises.realpath(repoParent)
    const resolvedWorktreeParent = await fs.promises.realpath(worktreeParent)
    expect(resolvedWorktreeParent).toBe(resolvedRepoParent)
  })

  it('names the worktree directory after repo and branch', async () => {
    const result = await WorktreeOperation.create(testRepo, 'feature')
    if (result.worktreePath) createdPaths.push(result.worktreePath)

    expect(result.success).toBe(true)
    const repoName = path.basename(testRepo)
    const worktreeDirName = path.basename(result.worktreePath!)
    expect(worktreeDirName).toBe(`${repoName}-feature`)
  })
})
