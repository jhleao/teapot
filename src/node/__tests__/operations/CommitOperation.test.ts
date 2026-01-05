import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the store to avoid electron-store initialization
vi.mock('../../store', () => ({
  configStore: {
    getGithubPat: vi.fn().mockReturnValue(null)
  }
}))

// Mock the forge service to avoid electron-store initialization
vi.mock('../../services/ForgeService', () => ({
  gitForgeService: {
    getState: vi.fn().mockResolvedValue({ pullRequests: [] }),
    getStateWithStatus: vi.fn().mockResolvedValue({ state: { pullRequests: [] }, status: 'success' }),
    closePullRequest: vi.fn(),
    deleteRemoteBranch: vi.fn()
  }
}))

import { CommitOperation } from '../../operations/CommitOperation'
import { gitForgeService } from '../../services/ForgeService'

describe('uncommit', () => {
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teapot-test-uncommit-'))
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })
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
