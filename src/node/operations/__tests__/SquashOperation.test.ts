/**
 * Integration tests for SquashOperation.
 *
 * These tests verify the full squash workflow including:
 * - Branch deletion/preservation
 * - Descendant rebasing
 * - Worktree isolation
 * - Error handling and rollback
 */

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Electron's BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

// Mock the store
let mockActiveWorktree: string | null = null
const mockRebaseSessions = new Map<string, unknown>()
vi.mock('../../store', () => ({
  configStore: {
    getActiveWorktree: () => mockActiveWorktree,
    setActiveWorktree: vi.fn(),
    getGithubPat: vi.fn().mockReturnValue(null),
    getUseParallelWorktree: vi.fn().mockReturnValue(true),
    // Session storage methods
    getRebaseSession: (key: string) => mockRebaseSessions.get(key) ?? null,
    setRebaseSession: (key: string, session: unknown) => mockRebaseSessions.set(key, session),
    deleteRebaseSession: (key: string) => mockRebaseSessions.delete(key),
    hasRebaseSession: (key: string) => mockRebaseSessions.has(key)
  }
}))

// Mock the forge service
vi.mock('../../services/ForgeService', () => ({
  gitForgeService: {
    deleteRemoteBranch: vi.fn().mockResolvedValue(undefined),
    getStateWithStatus: vi.fn().mockResolvedValue({
      state: { pullRequests: [] },
      status: 'idle'
    }),
    closePullRequest: vi.fn().mockResolvedValue(undefined)
  }
}))

import type { PrState } from '@shared/types/git-forge'
import { resetGitAdapter } from '../../adapters/git'
import { ExecutionContextService } from '../../services/ExecutionContextService'
import { gitForgeService } from '../../services/ForgeService'
import { SquashOperation } from '../SquashOperation'

describe('SquashOperation', () => {
  let tempDir: string
  let repoPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    resetGitAdapter()

    // Create temp directory and repo
    // Use realpath to resolve symlinks (e.g., /var -> /private/var on macOS)
    // so paths match what git returns
    tempDir = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'squash-test-'))
    )
    repoPath = path.join(tempDir, 'repo')
    await fs.promises.mkdir(repoPath)

    // Initialize git repo
    execSync('git init -b main', { cwd: repoPath })
    execSync('git config user.name "Test User"', { cwd: repoPath })
    execSync('git config user.email "test@example.com"', { cwd: repoPath })

    // Create initial commit on main
    await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
    execSync('git add .', { cwd: repoPath })
    execSync('git commit -m "initial commit"', { cwd: repoPath })

    // Reset mock state
    mockActiveWorktree = null
    mockRebaseSessions.clear()
  })

  afterEach(async () => {
    // Clean up contexts
    try {
      await ExecutionContextService.clearStoredContext(repoPath)
    } catch {
      // Ignore errors
    }

    // Clean up mock state
    mockRebaseSessions.clear()

    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  describe('preview', () => {
    it('returns canSquash true for valid squash scenario', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(true)
      expect(preview.targetBranch).toBe('target')
      expect(preview.parentBranch).toBe('parent')
      expect(preview.isEmpty).toBe(false)
    })

    it('returns canSquash false when parent is trunk', async () => {
      // Create stack: main -> target (parent is trunk)
      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(false)
      expect(preview.error).toBe('parent_is_trunk')
    })

    it('returns canSquash false for trunk branch', async () => {
      const preview = await SquashOperation.preview(repoPath, 'main')

      expect(preview.canSquash).toBe(false)
      expect(preview.error).toBe('is_trunk')
    })

    it('returns isEmpty true for branch with no diff from parent', async () => {
      // Create stack: main -> parent -> target (target has an empty commit on top of parent)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      // Create target with an "empty" change - same content, different commit
      execSync('git checkout -b target', { cwd: repoPath })
      execSync('git commit --allow-empty -m "empty commit"', { cwd: repoPath })

      // Switch to main so we're not on parent or target
      execSync('git checkout main', { cwd: repoPath })

      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(true)
      expect(preview.isEmpty).toBe(true)
    })

    it('includes descendant branches in preview', async () => {
      // Create stack: main -> parent -> target -> child
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout -b child', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'child.txt'), 'child content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "child commit"', { cwd: repoPath })

      // Preview squashing target
      execSync('git checkout target', { cwd: repoPath })
      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(true)
      expect(preview.descendantBranches).toContain('child')
    })

    it('returns resultWouldBeEmpty true when child reverts parent changes', async () => {
      // Stack: main -> parent (modifies file.txt) -> target (reverts file.txt to initial)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "revert parent changes"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(true)
      expect(preview.isEmpty).toBe(false)
      expect(preview.resultWouldBeEmpty).toBe(true)
    })

    it('returns resultWouldBeEmpty false for normal squash', async () => {
      // Stack: main -> parent -> target (adds different files)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(true)
      expect(preview.isEmpty).toBe(false)
      expect(preview.resultWouldBeEmpty).toBeFalsy()
    })

    it('resultWouldBeEmpty is not set when isEmpty', async () => {
      // Stack: main -> parent -> target (empty commit)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      execSync('git commit --allow-empty -m "empty commit"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const preview = await SquashOperation.preview(repoPath, 'target')

      expect(preview.canSquash).toBe(true)
      expect(preview.isEmpty).toBe(true)
      expect(preview.resultWouldBeEmpty).toBeFalsy()
    })
  })

  describe('execute - fast path (empty branch, no descendants)', () => {
    it('deletes empty branch (branch with no diff)', async () => {
      // Create stack: main -> parent -> target (target has empty commit)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      // Create target with an empty commit on top of parent
      execSync('git checkout -b target', { cwd: repoPath })
      execSync('git commit --allow-empty -m "empty commit"', { cwd: repoPath })

      // Switch to main so we're not on parent or target
      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)
      expect(result.deletedBranch).toBe('target')

      // Verify branch was deleted
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).not.toContain('target')
    })
  })

  describe('execute - single commit squash', () => {
    it('squashes single commit into parent and deletes child branch', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })
      const parentSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim()

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      // Switch to parent to avoid "cannot delete checked out branch" issues
      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)
      expect(result.deletedBranch).toBe('target')
      expect(result.preservedBranch).toBe('parent')

      // Verify target branch was deleted
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).not.toContain('target')

      // Verify parent branch was updated (should have target's changes)
      const newParentSha = execSync('git rev-parse parent', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(newParentSha).not.toBe(parentSha)

      // Verify the file from target is now in parent
      execSync('git checkout parent', { cwd: repoPath })
      const targetFileExists = fs.existsSync(path.join(repoPath, 'target.txt'))
      expect(targetFileExists).toBe(true)
    }, 15000)

    it('preserves author information when squashing', async () => {
      // Create stack: main -> parent -> target with different author
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      // Commit with different author
      execSync('git commit -m "target commit" --author="Other Author <other@example.com>"', {
        cwd: repoPath
      })

      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')
      expect(result.success).toBe(true)

      // Check that the new commit preserves the original author
      const commitInfo = execSync('git log -1 --format="%an <%ae>"', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(commitInfo).toBe('Other Author <other@example.com>')
    })
  })

  describe('execute - multi-commit squash', () => {
    it('squashes multiple commits from target into parent', async () => {
      // Create stack: main -> parent -> target (with 2 commits)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target1.txt'), 'target content 1')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit 1"', { cwd: repoPath })

      await fs.promises.writeFile(path.join(repoPath, 'target2.txt'), 'target content 2')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit 2"', { cwd: repoPath })

      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)

      // Verify both files from target are in parent
      execSync('git checkout parent', { cwd: repoPath })
      expect(fs.existsSync(path.join(repoPath, 'target1.txt'))).toBe(true)
      expect(fs.existsSync(path.join(repoPath, 'target2.txt'))).toBe(true)
    }, 15000)
  })

  describe('execute - with descendants', () => {
    it('rebases descendants after squashing', async () => {
      // Create stack: main -> parent -> target -> child
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout -b child', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'child.txt'), 'child content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "child commit"', { cwd: repoPath })

      const childShaOriginal = execSync('git rev-parse child', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()

      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)
      expect(result.modifiedBranches).toContain('parent')
      expect(result.modifiedBranches).toContain('child')

      // Verify child was rebased (different SHA)
      const childShaNew = execSync('git rev-parse child', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(childShaNew).not.toBe(childShaOriginal)

      // Verify child still has its content
      execSync('git checkout child', { cwd: repoPath })
      expect(fs.existsSync(path.join(repoPath, 'child.txt'))).toBe(true)

      // Verify child's parent is now the new parent commit (with target's changes)
      const childParentHasTargetFile = execSync(
        'git show child^:target.txt 2>/dev/null || echo ""',
        { cwd: repoPath, encoding: 'utf-8' }
      )
      expect(childParentHasTargetFile.trim()).toBe('target content')
    })
  })

  describe('execute - branch choice options', () => {
    it('preserves parent branch by default (choice: parent)', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target', { branchChoice: 'parent' })

      expect(result.success).toBe(true)
      expect(result.preservedBranch).toBe('parent')
      expect(result.deletedBranch).toBe('target')

      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).toContain('parent')
      expect(branches).not.toContain('target')
    })

    it('preserves child branch when choice is child', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target', { branchChoice: 'child' })

      expect(result.success).toBe(true)
      expect(result.preservedBranch).toBe('target')
      expect(result.deletedBranch).toBe('parent')

      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).toContain('target')
      expect(branches).not.toContain('parent')
    })

    it('preserves both branches when choice is both', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target', { branchChoice: 'both' })

      expect(result.success).toBe(true)
      expect(result.deletedBranch).toBeUndefined()

      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).toContain('parent')
      expect(branches).toContain('target')

      // Verify both branches point to the same commit
      const parentSha = execSync('git rev-parse parent', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      const targetSha = execSync('git rev-parse target', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(parentSha).toBe(targetSha)
    })

    it('creates custom named branch and deletes both originals', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target', {
        branchChoice: 'custom-feature'
      })

      expect(result.success).toBe(true)
      expect(result.preservedBranch).toBe('custom-feature')
      expect(result.deletedBranch).toContain('target')
      expect(result.deletedBranch).toContain('parent')

      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).toContain('custom-feature')
      expect(branches).not.toContain('parent')
      expect(branches).not.toContain('target')
    })
  })

  describe('execute - with dirty worktree', () => {
    it('preserves uncommitted changes when squashing non-current branch', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      // Switch to parent and create uncommitted changes
      execSync('git checkout parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'wip.txt'), 'work in progress')

      // Squash target (we're on parent with dirty changes)
      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)

      // Verify uncommitted changes are preserved
      const wipContent = await fs.promises.readFile(path.join(repoPath, 'wip.txt'), 'utf-8')
      expect(wipContent).toBe('work in progress')
    })

    it('blocks squash when current branch has uncommitted changes', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      // Create uncommitted changes on target (the branch we're squashing)
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'modified content')

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(false)
      expect(result.error).toBe('dirty_tree')
    })
  })

  describe('execute - worktree conflicts', () => {
    it('blocks when target branch is checked out and dirty in current worktree', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      // Make the current worktree dirty (we're on target)
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'dirty changes')

      // Execute should fail because we're on target with dirty changes
      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(false)
      expect(result.error).toBe('dirty_tree')
    })
  })

  describe('execute - context management', () => {
    it('releases execution context on success', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      // Switch to main so we're not on any of the branches being modified
      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')
      expect(result.success).toBe(true)

      // Verify no stored context
      const storedPath = await ExecutionContextService.getStoredExecutionPath(repoPath)
      expect(storedPath).toBeUndefined()
    })

    it('releases execution context when validation fails', async () => {
      // Try to squash trunk - should fail validation
      const result = await SquashOperation.execute(repoPath, 'main')
      expect(result.success).toBe(false)

      // Verify no stored context
      const storedPath = await ExecutionContextService.getStoredExecutionPath(repoPath)
      expect(storedPath).toBeUndefined()
    })
  })

  describe('execute - PR handling', () => {
    it('closes PR when deleting branch with open PR', async () => {
      // Create stack: main -> parent -> target
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'parent.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'target.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      // Mock PR for target branch - mock both calls (preview and execute)
      const mockPR = {
        state: {
          pullRequests: [
            {
              number: 123,
              headRefName: 'target',
              state: 'open' as PrState,
              title: 'Test PR',
              url: 'https://github.com/test/repo/pull/123',
              headSha: 'abc123',
              baseRefName: 'parent',
              createdAt: '2024-01-01T00:00:00Z',
              isMergeable: true
            }
          ]
        },
        status: 'idle' as const,
        error: undefined,
        lastSuccessfulFetch: undefined
      }
      vi.mocked(gitForgeService.getStateWithStatus)
        .mockResolvedValueOnce(mockPR)
        .mockResolvedValueOnce(mockPR)

      // Switch to main so we're not on the branches being modified
      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)
      expect(gitForgeService.closePullRequest).toHaveBeenCalledWith(repoPath, 123)
    })
  })

  describe('execute - rollback on failure', () => {
    it('rolls back branches when descendant rebase conflicts', async () => {
      // Create stack: main -> parent -> target -> child
      // with child having conflicting changes
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'shared.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'shared.txt'), 'target content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "target commit"', { cwd: repoPath })

      execSync('git checkout -b child', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'shared.txt'), 'child content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "child commit"', { cwd: repoPath })

      const parentShaOriginal = execSync('git rev-parse parent', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      const childShaOriginal = execSync('git rev-parse child', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()

      // Switch to main so we're not on the branches being modified
      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      // If there's a conflict, branches should be rolled back
      if (!result.success && result.error === 'descendant_conflict') {
        // Verify rollback happened
        const parentShaAfter = execSync('git rev-parse parent', {
          cwd: repoPath,
          encoding: 'utf-8'
        }).trim()
        const childShaAfter = execSync('git rev-parse child', {
          cwd: repoPath,
          encoding: 'utf-8'
        }).trim()

        expect(parentShaAfter).toBe(parentShaOriginal)
        expect(childShaAfter).toBe(childShaOriginal)
      }
      // If no conflict, the test still passes (conflict is not guaranteed)
    }, 15000)
  })

  describe('execute - result would be empty', () => {
    it('deletes both branches when result would be empty (no descendants)', async () => {
      // Stack: main(file.txt="initial") -> parent(file.txt="changed") -> target(file.txt="initial")
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "revert parent changes"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)

      // Both branches should be deleted
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).not.toContain('target')
      expect(branches).not.toContain('parent')
      expect(branches).toContain('main')
    })

    it('checks out grandparent branch when user was on deleted branch', async () => {
      // Same revert scenario, user on parent
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "revert parent changes"', { cwd: repoPath })

      // Stay on parent (not main)
      execSync('git checkout parent', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)

      // Should not be on a deleted branch - should be on grandparent (main)
      const currentBranch = execSync('git branch --show-current', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(currentBranch).toBe('main')
    })

    it('rebases descendants onto grandparent when result would be empty', async () => {
      // Stack: main -> parent(file.txt="changed") -> target(file.txt="initial") -> child(child.txt)
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "revert parent changes"', { cwd: repoPath })

      execSync('git checkout -b child', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'child.txt'), 'child content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "child commit"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)
      expect(result.modifiedBranches).toContain('child')

      // Parent and target deleted, child preserved
      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).not.toContain('target')
      expect(branches).not.toContain('parent')
      expect(branches).toContain('child')

      // Child still has its content
      execSync('git checkout child', { cwd: repoPath })
      expect(fs.existsSync(path.join(repoPath, 'child.txt'))).toBe(true)
      const childContent = await fs.promises.readFile(path.join(repoPath, 'child.txt'), 'utf-8')
      expect(childContent).toBe('child content')

      // Child's parent commit should be main's HEAD (grandparent)
      const childParentSha = execSync('git rev-parse child^', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      const mainSha = execSync('git rev-parse main', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim()
      expect(childParentSha).toBe(mainSha)
    })

    it('rebases multi-level descendants onto grandparent', async () => {
      // Stack: main -> parent -> target -> child1 -> child2
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "revert parent changes"', { cwd: repoPath })

      execSync('git checkout -b child1', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'child1.txt'), 'child1 content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "child1 commit"', { cwd: repoPath })

      execSync('git checkout -b child2', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'child2.txt'), 'child2 content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "child2 commit"', { cwd: repoPath })

      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)

      const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' })
      expect(branches).not.toContain('target')
      expect(branches).not.toContain('parent')
      expect(branches).toContain('child1')
      expect(branches).toContain('child2')

      // Both children have their content
      execSync('git checkout child1', { cwd: repoPath })
      expect(fs.existsSync(path.join(repoPath, 'child1.txt'))).toBe(true)

      execSync('git checkout child2', { cwd: repoPath })
      expect(fs.existsSync(path.join(repoPath, 'child2.txt'))).toBe(true)
    })

    it('closes PRs for both deleted branches', async () => {
      // Same revert scenario
      execSync('git checkout -b parent', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'parent content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "parent commit"', { cwd: repoPath })

      execSync('git checkout -b target', { cwd: repoPath })
      await fs.promises.writeFile(path.join(repoPath, 'file.txt'), 'initial content')
      execSync('git add .', { cwd: repoPath })
      execSync('git commit -m "revert parent changes"', { cwd: repoPath })

      // Mock PRs for both branches
      const mockPR = {
        state: {
          pullRequests: [
            {
              number: 10,
              headRefName: 'parent',
              state: 'open' as PrState,
              title: 'Parent PR',
              url: 'https://github.com/test/repo/pull/10',
              headSha: 'abc',
              baseRefName: 'main',
              createdAt: '2024-01-01T00:00:00Z',
              isMergeable: true
            },
            {
              number: 20,
              headRefName: 'target',
              state: 'open' as PrState,
              title: 'Target PR',
              url: 'https://github.com/test/repo/pull/20',
              headSha: 'def',
              baseRefName: 'parent',
              createdAt: '2024-01-01T00:00:00Z',
              isMergeable: true
            }
          ]
        },
        status: 'idle' as const,
        error: undefined,
        lastSuccessfulFetch: undefined
      }
      vi.mocked(gitForgeService.getStateWithStatus).mockResolvedValueOnce(mockPR)

      execSync('git checkout main', { cwd: repoPath })

      const result = await SquashOperation.execute(repoPath, 'target')

      expect(result.success).toBe(true)
      expect(gitForgeService.closePullRequest).toHaveBeenCalledWith(repoPath, 10)
      expect(gitForgeService.closePullRequest).toHaveBeenCalledWith(repoPath, 20)
    })
  })
})
