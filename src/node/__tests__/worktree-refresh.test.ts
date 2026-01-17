/**
 * Test: Worktree list refresh after create/delete operations
 *
 * Verifies that:
 * 1. Backend correctly detects worktree changes
 * 2. IPC handlers return updated uiState after worktree operations
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron-store before importing modules that use it
vi.mock('../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null),
    getActiveWorktree: vi.fn().mockReturnValue(null)
  }
}))

import { SimpleGitAdapter } from '../adapters/git'
import { WorktreeOperation } from '../operations'
import { RepoModelService } from '../services'

// Helper to create a test git repo
async function createTestRepo(): Promise<string> {
  const testDir = path.join(os.tmpdir(), `teapot-worktree-test-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  const { execSync } = await import('child_process')
  execSync('git init', { cwd: testDir })
  execSync('git config user.email "test@test.com"', { cwd: testDir })
  execSync('git config user.name "Test"', { cwd: testDir })

  // Create initial commit
  const testFile = path.join(testDir, 'test.txt')
  fs.writeFileSync(testFile, 'initial content')
  execSync('git add .', { cwd: testDir })
  execSync('git commit -m "initial"', { cwd: testDir })

  // Create a feature branch for worktree testing
  execSync('git checkout -b feature', { cwd: testDir })
  execSync('git checkout main || git checkout master', { cwd: testDir })

  return testDir
}

// Helper to cleanup test repo
function cleanupTestRepo(testDir: string): void {
  try {
    fs.rmSync(testDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

describe('Worktree refresh after create/delete', () => {
  let testRepo: string

  beforeEach(async () => {
    testRepo = await createTestRepo()
  })

  it('buildRepoModel returns worktree after creation', async () => {
    // Step 1: Get initial worktree count
    const initialRepo = await RepoModelService.buildRepoModel(
      { repoPath: testRepo },
      { skipWorktreeDirtyCheck: true }
    )
    const initialWorktreeCount = initialRepo.worktrees.length
    expect(initialWorktreeCount).toBe(1) // Just the main worktree

    // Step 2: Create a new worktree via git directly
    const { execSync } = await import('child_process')
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: testRepo })

    // Step 3: buildRepoModel should see the new worktree
    const afterCreateRepo = await RepoModelService.buildRepoModel(
      { repoPath: testRepo },
      { skipWorktreeDirtyCheck: true }
    )
    expect(afterCreateRepo.worktrees.length).toBe(initialWorktreeCount + 1)

    // Step 4: Remove the worktree
    execSync(`git worktree remove "${worktreePath}"`, { cwd: testRepo })

    // Step 5: buildRepoModel should NOT see the removed worktree
    const afterRemoveRepo = await RepoModelService.buildRepoModel(
      { repoPath: testRepo },
      { skipWorktreeDirtyCheck: true }
    )
    expect(afterRemoveRepo.worktrees.length).toBe(initialWorktreeCount)

    // Cleanup
    cleanupTestRepo(testRepo)
  })

  it('listWorktrees directly reflects create/delete', async () => {
    const adapter = new SimpleGitAdapter()

    // Initial state
    const initialWorktrees = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(initialWorktrees.length).toBe(1)

    // Create worktree
    const { execSync } = await import('child_process')
    const worktreePath = path.join(os.tmpdir(), `teapot-wt-${Date.now()}`)
    execSync(`git worktree add "${worktreePath}" feature`, { cwd: testRepo })

    // Should see new worktree
    const afterCreate = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(afterCreate.length).toBe(2)
    // Path might be resolved differently, so check the worktree branch instead
    expect(afterCreate.some((wt) => wt.branch === 'feature')).toBe(true)

    // Remove worktree
    execSync(`git worktree remove "${worktreePath}"`, { cwd: testRepo })

    // Should not see removed worktree
    const afterRemove = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(afterRemove.length).toBe(1)
    expect(afterRemove.some((wt) => wt.branch === 'feature')).toBe(false)

    // Cleanup
    cleanupTestRepo(testRepo)
  })
})

describe('WorktreeOperation create/remove works correctly', () => {
  let testRepo: string

  beforeEach(async () => {
    testRepo = await createTestRepo()
  })

  it('createWorktree operation succeeds and creates worktree', async () => {
    // Create worktree via operation
    const result = await WorktreeOperation.create(testRepo, 'feature')
    expect(result.success).toBe(true)
    expect(result.worktreePath).toBeDefined()

    // Verify worktree exists via adapter
    const adapter = new SimpleGitAdapter()
    const worktrees = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(worktrees.length).toBe(2)
    expect(worktrees.some((wt) => wt.branch === 'feature')).toBe(true)

    // Cleanup
    if (result.worktreePath) {
      const { execSync } = await import('child_process')
      execSync(`git worktree remove "${result.worktreePath}"`, { cwd: testRepo })
    }
    cleanupTestRepo(testRepo)
  })

  it('removeWorktree operation succeeds and removes worktree', async () => {
    // Create worktree first
    const createResult = await WorktreeOperation.create(testRepo, 'feature')
    expect(createResult.success).toBe(true)
    const worktreePath = createResult.worktreePath!

    // Verify worktree exists
    const adapter = new SimpleGitAdapter()
    const before = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(before.length).toBe(2)

    // Remove worktree via operation
    const removeResult = await WorktreeOperation.remove(testRepo, worktreePath)
    expect(removeResult.success).toBe(true)

    // Verify worktree is removed
    const after = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(after.length).toBe(1)
    expect(after.some((wt) => wt.branch === 'feature')).toBe(false)

    // Cleanup
    cleanupTestRepo(testRepo)
  })
})

describe('WorktreeOperation.createTemporary', () => {
  let testRepo: string

  beforeEach(async () => {
    testRepo = await createTestRepo()
  })

  it('creates a temporary worktree with detached HEAD', async () => {
    const result = await WorktreeOperation.createTemporary(testRepo)

    expect(result.success).toBe(true)
    expect(result.worktreePath).toBeDefined()

    // Verify the worktree exists
    const adapter = new SimpleGitAdapter()
    const worktrees = await adapter.listWorktrees(testRepo, { skipDirtyCheck: true })
    expect(worktrees.length).toBe(2)

    // Verify the temp worktree has detached HEAD (no branch)
    const tempWorktree = worktrees.find((wt) => wt.path === result.worktreePath)
    expect(tempWorktree).toBeDefined()
    expect(tempWorktree?.branch).toBeNull() // Detached HEAD means no branch

    // Cleanup
    if (result.worktreePath) {
      const { execSync } = await import('child_process')
      execSync(`git worktree remove "${result.worktreePath}"`, { cwd: testRepo })
    }
    cleanupTestRepo(testRepo)
  })

  it('creates worktree at trunk (main or master branch)', async () => {
    const { execSync } = await import('child_process')

    // Get the trunk branch name (could be main or master depending on git config)
    const branches = execSync('git branch', { cwd: testRepo, encoding: 'utf-8' })
    const trunkBranch = branches.includes('main') ? 'main' : 'master'

    // Get the commit SHA of trunk
    const trunkSha = execSync(`git rev-parse ${trunkBranch}`, {
      cwd: testRepo,
      encoding: 'utf-8'
    }).trim()

    const result = await WorktreeOperation.createTemporary(testRepo)
    expect(result.success).toBe(true)

    // Verify the temp worktree is at the same commit as trunk
    const tempSha = execSync(`git -C "${result.worktreePath}" rev-parse HEAD`, {
      encoding: 'utf-8'
    }).trim()
    expect(tempSha).toBe(trunkSha)

    // Cleanup
    if (result.worktreePath) {
      execSync(`git worktree remove "${result.worktreePath}"`, { cwd: testRepo })
    }
    cleanupTestRepo(testRepo)
  })

  it('creates worktree at master when main does not exist', async () => {
    const { execSync } = await import('child_process')

    // Check if we have main branch - if so, rename it to master for this test
    const branches = execSync('git branch', { cwd: testRepo, encoding: 'utf-8' })
    if (branches.includes('main')) {
      execSync('git branch -m main master', { cwd: testRepo })
    }

    // Get the commit SHA of master
    const masterSha = execSync('git rev-parse master', { cwd: testRepo, encoding: 'utf-8' }).trim()

    const result = await WorktreeOperation.createTemporary(testRepo)
    expect(result.success).toBe(true)

    // Verify the temp worktree is at the same commit as master
    const tempSha = execSync(`git -C "${result.worktreePath}" rev-parse HEAD`, {
      encoding: 'utf-8'
    }).trim()
    expect(tempSha).toBe(masterSha)

    // Cleanup
    if (result.worktreePath) {
      execSync(`git worktree remove "${result.worktreePath}"`, { cwd: testRepo })
    }
    cleanupTestRepo(testRepo)
  })

  it('uses custom base directory when provided', async () => {
    const customBaseDir = path.join(os.tmpdir(), `teapot-custom-base-${Date.now()}`)

    const result = await WorktreeOperation.createTemporary(testRepo, customBaseDir)
    expect(result.success).toBe(true)
    expect(result.worktreePath).toContain('teapot-exec-')

    // The worktree path should be under the custom base dir (accounting for symlink resolution)
    const resolvedCustomBase = await fs.promises.realpath(customBaseDir)
    expect(result.worktreePath?.startsWith(resolvedCustomBase)).toBe(true)

    // Cleanup
    if (result.worktreePath) {
      const { execSync } = await import('child_process')
      execSync(`git worktree remove "${result.worktreePath}"`, { cwd: testRepo })
    }
    await fs.promises.rm(customBaseDir, { recursive: true, force: true })
    cleanupTestRepo(testRepo)
  })

  it('generates unique worktree names for concurrent calls', async () => {
    const [result1, result2] = await Promise.all([
      WorktreeOperation.createTemporary(testRepo),
      WorktreeOperation.createTemporary(testRepo)
    ])

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    expect(result1.worktreePath).not.toBe(result2.worktreePath)

    // Both should contain the teapot-exec- prefix
    expect(result1.worktreePath).toContain('teapot-exec-')
    expect(result2.worktreePath).toContain('teapot-exec-')

    // Cleanup
    const { execSync } = await import('child_process')
    if (result1.worktreePath) {
      execSync(`git worktree remove "${result1.worktreePath}"`, { cwd: testRepo })
    }
    if (result2.worktreePath) {
      execSync(`git worktree remove "${result2.worktreePath}"`, { cwd: testRepo })
    }
    cleanupTestRepo(testRepo)
  })
})
