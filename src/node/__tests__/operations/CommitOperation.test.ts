import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron before any imports that use it
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

// Mock the store to avoid electron-store initialization
const mockRebaseSessions = new Map<string, unknown>()
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null),
    getActiveWorktree: () => null,
    getUseParallelWorktree: () => false,
    getRebaseSession: (key: string) => mockRebaseSessions.get(key) ?? null,
    setRebaseSession: (key: string, session: unknown) => mockRebaseSessions.set(key, session),
    deleteRebaseSession: (key: string) => mockRebaseSessions.delete(key),
    hasRebaseSession: (key: string) => mockRebaseSessions.has(key)
  }
}))

// Mock the forge service to avoid electron-store initialization
vi.mock('../../services/ForgeService', () => ({
  gitForgeService: {
    getState: vi.fn().mockResolvedValue({ pullRequests: [] }),
    getStateWithStatus: vi
      .fn()
      .mockResolvedValue({ state: { pullRequests: [] }, status: 'success' }),
    closePullRequest: vi.fn(),
    deleteRemoteBranch: vi.fn()
  }
}))

import { CommitOperation } from '../../operations/CommitOperation'
import { gitForgeService } from '../../services/ForgeService'

describe('amend', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRebaseSessions.clear()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-amend-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    execSync('git config commit.gpgsign false', { cwd: repoPath })
  })

  afterEach(async () => {
    mockRebaseSessions.clear()
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should amend commit message while staying on branch', async () => {
    // Create a commit
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial content')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "original message"', { cwd: repoPath })

    // Amend the commit message
    await CommitOperation.amend(repoPath, 'amended message')

    // Verify we're still on the branch
    const currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('main')

    // Verify the message was amended
    const commitMessage = execSync('git log -1 --format=%s', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(commitMessage).toBe('amended message')
  })

  it('should amend with staged changes', async () => {
    // Create initial commit
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial content')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "original message"', { cwd: repoPath })

    // Stage additional changes
    await fs.promises.writeFile(file1, 'modified content')
    execSync('git add file1.txt', { cwd: repoPath })

    // Amend (will include staged changes)
    await CommitOperation.amend(repoPath)

    // Verify we're still on the branch
    const currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('main')

    // Verify the working tree is clean (staged changes were committed)
    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8' })
    expect(status).toBe('')

    // Verify the file content is the modified version
    const content = await fs.promises.readFile(file1, 'utf-8')
    expect(content).toBe('modified content')
  })

  it('should amend with child branch without creating duplicate commits', async () => {
    // Setup:
    //   main(A) → parent-branch(B) → child-branch(C)
    //
    // After amending parent-branch (B → B'), child-branch should be rebased:
    //   main(A) → parent-branch(B') → child-branch(C')
    //
    // Bug scenario: If the old commit B is incorrectly included in the child's
    // rebase range, it gets replayed on top of B', creating a bogus duplicate:
    //   main(A) → parent-branch(B') → B'' → child-branch(C')
    // This B'' causes spurious conflicts since B and B' have near-identical content.

    // Create trunk commit
    const file1 = path.join(repoPath, 'base.txt')
    await fs.promises.writeFile(file1, 'base')
    execSync('git add base.txt', { cwd: repoPath })
    execSync('git commit -m "trunk commit A"', { cwd: repoPath })

    // Create parent-branch with one commit
    execSync('git checkout -b parent-branch', { cwd: repoPath })
    const parentFile = path.join(repoPath, 'parent.txt')
    await fs.promises.writeFile(parentFile, 'parent content v1')
    execSync('git add parent.txt', { cwd: repoPath })
    execSync('git commit -m "parent commit B"', { cwd: repoPath })

    // Create child-branch stacked on parent-branch
    execSync('git checkout -b child-branch', { cwd: repoPath })
    const childFile = path.join(repoPath, 'child.txt')
    await fs.promises.writeFile(childFile, 'child content')
    execSync('git add child.txt', { cwd: repoPath })
    execSync('git commit -m "child commit C"', { cwd: repoPath })

    // Go back to parent-branch, stage changes, and amend
    execSync('git checkout parent-branch', { cwd: repoPath })
    await fs.promises.writeFile(parentFile, 'parent content v2')
    execSync('git add parent.txt', { cwd: repoPath })

    await CommitOperation.amend(repoPath, 'parent commit B (amended)')

    // Verify parent-branch has the amended message
    const parentMsg = execSync('git log -1 --format=%s parent-branch', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(parentMsg).toBe('parent commit B (amended)')

    // Verify child-branch has exactly 1 commit on top of parent-branch (not 2)
    // If the bug were present, there would be 2 commits: B'' (duplicate) and C'
    const commitCount = execSync(
      'git rev-list --count parent-branch..child-branch',
      { cwd: repoPath, encoding: 'utf-8' }
    ).trim()
    expect(commitCount).toBe('1')

    // Verify the single child commit has the right message
    const childMsg = execSync('git log -1 --format=%s child-branch', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(childMsg).toBe('child commit C')

    // Verify child-branch's parent is parent-branch's HEAD
    const childParent = execSync('git rev-parse child-branch~1', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    const parentHead = execSync('git rev-parse parent-branch', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(childParent).toBe(parentHead)
  })

  it('should rebase entire stack when amending a commit mid-stack', { timeout: 30000 }, async () => {
    // Setup: 4-branch deep stack
    //   main(A) → branch-1(B) → branch-2(C) → branch-3(D) → branch-4(E)
    //
    // After amending branch-1 (B → B'), the entire stack should be rebased:
    //   main(A) → branch-1(B') → branch-2(C') → branch-3(D') → branch-4(E')
    //
    // Bug scenario: Only branch-2 gets rebased, leaving branch-3 and branch-4
    // pointing to old SHAs (D and E still have parents C and D, not C' and D')

    // Create trunk commit
    const baseFile = path.join(repoPath, 'base.txt')
    await fs.promises.writeFile(baseFile, 'base')
    execSync('git add base.txt', { cwd: repoPath })
    execSync('git commit -m "trunk commit A"', { cwd: repoPath })

    // Create branch-1
    execSync('git checkout -b branch-1', { cwd: repoPath })
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'content v1')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit B"', { cwd: repoPath })

    // Create branch-2 stacked on branch-1
    execSync('git checkout -b branch-2', { cwd: repoPath })
    const file2 = path.join(repoPath, 'file2.txt')
    await fs.promises.writeFile(file2, 'content 2')
    execSync('git add file2.txt', { cwd: repoPath })
    execSync('git commit -m "commit C"', { cwd: repoPath })

    // Create branch-3 stacked on branch-2
    execSync('git checkout -b branch-3', { cwd: repoPath })
    const file3 = path.join(repoPath, 'file3.txt')
    await fs.promises.writeFile(file3, 'content 3')
    execSync('git add file3.txt', { cwd: repoPath })
    execSync('git commit -m "commit D"', { cwd: repoPath })

    // Create branch-4 stacked on branch-3
    execSync('git checkout -b branch-4', { cwd: repoPath })
    const file4 = path.join(repoPath, 'file4.txt')
    await fs.promises.writeFile(file4, 'content 4')
    execSync('git add file4.txt', { cwd: repoPath })
    execSync('git commit -m "commit E"', { cwd: repoPath })

    // Go back to branch-1, stage changes, and amend
    execSync('git checkout branch-1', { cwd: repoPath })
    await fs.promises.writeFile(file1, 'content v2')
    execSync('git add file1.txt', { cwd: repoPath })

    await CommitOperation.amend(repoPath, 'commit B (amended)')

    // Verify branch-1 has the amended message
    const msg1 = execSync('git log -1 --format=%s branch-1', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(msg1).toBe('commit B (amended)')

    // Verify each branch in the stack is properly connected
    // branch-2 should be 1 commit on top of branch-1
    const count2 = execSync('git rev-list --count branch-1..branch-2', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(count2).toBe('1')

    // branch-3 should be 1 commit on top of branch-2
    const count3 = execSync('git rev-list --count branch-2..branch-3', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(count3).toBe('1')

    // branch-4 should be 1 commit on top of branch-3
    const count4 = execSync('git rev-list --count branch-3..branch-4', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(count4).toBe('1')

    // Verify the full chain: branch-4 should be exactly 4 commits ahead of main
    const totalCount = execSync('git rev-list --count main..branch-4', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(totalCount).toBe('4')

    // Verify parent linkage is correct through the whole stack
    const branch1Head = execSync('git rev-parse branch-1', { cwd: repoPath, encoding: 'utf-8' }).trim()
    const branch2Parent = execSync('git rev-parse branch-2~1', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(branch2Parent).toBe(branch1Head)

    const branch2Head = execSync('git rev-parse branch-2', { cwd: repoPath, encoding: 'utf-8' }).trim()
    const branch3Parent = execSync('git rev-parse branch-3~1', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(branch3Parent).toBe(branch2Head)

    const branch3Head = execSync('git rev-parse branch-3', { cwd: repoPath, encoding: 'utf-8' }).trim()
    const branch4Parent = execSync('git rev-parse branch-4~1', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(branch4Parent).toBe(branch3Head)

    // Verify all commit messages are preserved
    const msg2 = execSync('git log -1 --format=%s branch-2', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(msg2).toBe('commit C')
    const msg3 = execSync('git log -1 --format=%s branch-3', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(msg3).toBe('commit D')
    const msg4 = execSync('git log -1 --format=%s branch-4', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(msg4).toBe('commit E')
  })
})

describe('uncommit', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-uncommit-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
    execSync('git config commit.gpgsign false', { cwd: repoPath })
  })

  afterEach(async () => {
    await fs.promises.rm(repoPath, { recursive: true, force: true })
  })

  it('should uncommit HEAD, preserve changes as staged, delete branch, and land on parent branch', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })
    const commit1 = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })
    execSync('git checkout feature', { cwd: repoPath })

    // Commit 2 on feature
    await fs.promises.writeFile(file1, 'modified')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 2"', { cwd: repoPath })
    const commit2 = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()

    // Uncommit commit2
    await CommitOperation.uncommit(repoPath, commit2)

    // Assertions
    // 1. HEAD should be at commit1
    const currentHead = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(currentHead).toBe(commit1)

    // 2. Branch 'feature' should be gone
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('feature')

    // 3. Should be on 'main' (since main points to commit1)
    const currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('main')

    // 4. Changes should be in Index (staged)
    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8' })
    // 'M  file1.txt' means modified and staged
    expect(status).toContain('M  file1.txt')
  })

  it('should detach if no parent branch exists', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })
    const commit1 = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()

    // Move main to commit 2
    await fs.promises.writeFile(file1, 'modified')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 2"', { cwd: repoPath })
    const commit2 = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()

    // Uncommit commit2 (main will be deleted)
    await CommitOperation.uncommit(repoPath, commit2)

    const currentHead = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(currentHead).toBe(commit1)

    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean)
    expect(branches).not.toContain('main')

    const currentBranch = execSync('git branch --show-current', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    expect(currentBranch).toBe('') // Detached (empty string)

    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8' })
    // 'M  file1.txt' means modified and staged
    expect(status).toContain('M  file1.txt')
  })

  it('should delete remote branch when uncommitting', async () => {
    // Setup: main -> commit1
    const file1 = path.join(repoPath, 'file1.txt')
    await fs.promises.writeFile(file1, 'initial')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 1"', { cwd: repoPath })

    // Create feature branch
    execSync('git branch feature', { cwd: repoPath })
    execSync('git checkout feature', { cwd: repoPath })

    // Commit 2 on feature
    await fs.promises.writeFile(file1, 'modified')
    execSync('git add file1.txt', { cwd: repoPath })
    execSync('git commit -m "commit 2"', { cwd: repoPath })
    const commit2 = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()

    // Uncommit commit2
    await CommitOperation.uncommit(repoPath, commit2)

    // Verify deleteRemoteBranch was called for the feature branch
    expect(gitForgeService.deleteRemoteBranch).toHaveBeenCalledWith(repoPath, 'feature')
  })
})
