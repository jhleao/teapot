/**
 * Tests for PR #345: Worktree Conflict Detection
 *
 * Verifies that SimpleGitAdapter.listWorktrees() correctly detects:
 *  - isRebasing flag when a worktree has a rebase in progress
 *  - conflictedFiles when a worktree rebase has conflicts
 *  - Branch name recovery during detached HEAD (rebase) state
 *  - skipConflictCheck option skips conflict detection
 *  - External rebases (CLI-initiated) in the main worktree
 */

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveGitDir } from '../../../operations/WorktreeUtils'
import { SimpleGitAdapter } from '../SimpleGitAdapter'
import { cleanupTestRepo, createTestRepo } from './test-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(repoPath: string, cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: repoPath
    }
  }).trim()
}

function commitFile(repoPath: string, filename: string, content: string, message: string): void {
  const fullPath = path.join(repoPath, filename)
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fullPath, content)
  git(repoPath, `add "${filename}"`)
  git(repoPath, `commit -m "${message}"`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worktree Conflict Detection – listWorktrees()', () => {
  let repoPath: string
  let adapter: SimpleGitAdapter
  let worktreePath: string | null = null

  beforeEach(async () => {
    repoPath = fs.realpathSync(await createTestRepo())
    adapter = new SimpleGitAdapter()
    worktreePath = null
  })

  afterEach(async () => {
    // Abort any in-progress rebase and remove worktrees
    if (worktreePath) {
      try {
        execSync('git rebase --abort', { cwd: worktreePath, stdio: 'ignore' })
      } catch { /* no rebase */ }
      try {
        git(repoPath, `worktree remove "${worktreePath}" --force`)
      } catch { /* already removed */ }
      await fs.promises.rm(worktreePath, { recursive: true, force: true })
    }
    // Abort rebase in main worktree too (for external rebase tests)
    try {
      execSync('git rebase --abort', { cwd: repoPath, stdio: 'ignore' })
    } catch { /* no rebase */ }
    await cleanupTestRepo(repoPath)
  })

  // -----------------------------------------------------------------------
  // Clean worktree (no conflicts)
  // -----------------------------------------------------------------------

  it('reports isRebasing=false and empty conflictedFiles for a clean worktree', async () => {
    commitFile(repoPath, 'file.txt', 'hello', 'Initial commit')

    // Create a clean worktree
    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-clean-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `checkout -b clean-worktree-test`)
    commitFile(repoPath, 'feature.txt', 'feature', 'Feature commit')
    git(repoPath, 'checkout main')
    git(repoPath, `worktree add "${worktreePath}" clean-worktree-test`)

    const worktrees = await adapter.listWorktrees(repoPath)

    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt).toBeDefined()
    expect(wt!.isRebasing).toBe(false)
    expect(wt!.conflictedFiles).toEqual([])
    expect(wt!.branch).toBe('clean-worktree-test')
  })

  // -----------------------------------------------------------------------
  // Worktree with conflicting rebase
  // -----------------------------------------------------------------------

  it('detects isRebasing=true and conflictedFiles for a worktree mid-rebase', async () => {
    // Set up conflicting branches
    commitFile(repoPath, 'file.txt', 'line 1\noriginal\nline 3', 'Initial content')

    git(repoPath, 'checkout -b rebase-conflict-detect-test')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nfeature-change\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Feature: modify line 2"')

    git(repoPath, 'checkout main')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nmain-change\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Main: modify line 2"')

    // Create worktree for the feature branch
    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-conflict-detect-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `worktree add "${worktreePath}" rebase-conflict-detect-test`)

    // Start rebase in the worktree — will conflict
    try {
      execSync('git rebase main', {
        cwd: worktreePath,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test User',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test User',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: repoPath
        }
      })
    } catch {
      // Expected: conflict
    }

    const worktrees = await adapter.listWorktrees(repoPath)

    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt).toBeDefined()
    expect(wt!.isRebasing).toBe(true)
    expect(wt!.conflictedFiles).toContain('file.txt')
    // Branch name should be recovered from rebase-merge/head-name
    expect(wt!.branch).toBe('rebase-conflict-detect-test')
  })

  // -----------------------------------------------------------------------
  // Worktree rebasing without conflicts (rebase completed or paused before conflicts)
  // -----------------------------------------------------------------------

  it('detects isRebasing=true but empty conflictedFiles for non-conflicting rebase', async () => {
    // Set up branches that do NOT conflict
    commitFile(repoPath, 'file.txt', 'main content', 'Initial commit')

    git(repoPath, 'checkout -b non-conflict-rebase-test')
    commitFile(repoPath, 'feature-only.txt', 'feature content', 'Add feature file')

    git(repoPath, 'checkout main')
    commitFile(repoPath, 'main-only.txt', 'main extra', 'Add main-only file')

    // Create worktree
    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-no-conflict-rebase-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `worktree add "${worktreePath}" non-conflict-rebase-test`)

    // Start rebase — should succeed without conflicts
    execSync('git rebase main', {
      cwd: worktreePath,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test User',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test User',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: repoPath
      }
    })

    const worktrees = await adapter.listWorktrees(repoPath)

    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt).toBeDefined()
    // Rebase completed successfully, so no rebase should be in progress
    expect(wt!.isRebasing).toBe(false)
    expect(wt!.conflictedFiles).toEqual([])
  })

  // -----------------------------------------------------------------------
  // skipConflictCheck option
  // -----------------------------------------------------------------------

  it('returns isRebasing=false when skipConflictCheck is true', async () => {
    // Set up a conflicting rebase (same as above)
    commitFile(repoPath, 'file.txt', 'line 1\noriginal\nline 3', 'Initial content')

    git(repoPath, 'checkout -b skip-conflict-check-test')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nfeature\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Feature change"')

    git(repoPath, 'checkout main')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nmain\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Main change"')

    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-skip-conflict-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `worktree add "${worktreePath}" skip-conflict-check-test`)

    try {
      execSync('git rebase main', {
        cwd: worktreePath,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test User',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test User',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: repoPath
        }
      })
    } catch {
      // Expected: conflict
    }

    // With skipConflictCheck, should not detect conflict state
    const worktrees = await adapter.listWorktrees(repoPath, { skipConflictCheck: true })

    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt).toBeDefined()
    expect(wt!.isRebasing).toBe(false)
    expect(wt!.conflictedFiles).toEqual([])
  })

  // -----------------------------------------------------------------------
  // Main worktree fields (isRebasing, conflictedFiles present)
  // -----------------------------------------------------------------------

  it('includes isRebasing and conflictedFiles fields for the main worktree', async () => {
    commitFile(repoPath, 'file.txt', 'content', 'Initial commit')

    const worktrees = await adapter.listWorktrees(repoPath)

    expect(worktrees.length).toBeGreaterThanOrEqual(1)
    const mainWt = worktrees.find((w) => w.isMain)
    expect(mainWt).toBeDefined()
    expect(mainWt!.isRebasing).toBe(false)
    expect(mainWt!.conflictedFiles).toEqual([])
  })

  // -----------------------------------------------------------------------
  // External rebase in main worktree
  // -----------------------------------------------------------------------

  it('detects external rebase conflict in the main worktree', async () => {
    // Set up conflicting branches
    commitFile(repoPath, 'file.txt', 'line 1\noriginal\nline 3', 'Initial content')

    git(repoPath, 'checkout -b external-rebase-detect-test')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nfeature\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Feature change"')

    git(repoPath, 'checkout main')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nmain\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Main change"')

    // Start rebase ON main worktree (external/CLI rebase)
    git(repoPath, 'checkout external-rebase-detect-test')
    try {
      git(repoPath, 'rebase main')
    } catch {
      // Expected: conflict
    }

    const worktrees = await adapter.listWorktrees(repoPath)

    const mainWt = worktrees.find((w) => w.isMain)
    expect(mainWt).toBeDefined()
    expect(mainWt!.isRebasing).toBe(true)
    expect(mainWt!.conflictedFiles).toContain('file.txt')
    // Should recover the branch name from rebase-merge/head-name
    expect(mainWt!.branch).toBe('external-rebase-detect-test')
  })

  // -----------------------------------------------------------------------
  // Multiple worktrees – mixed states
  // -----------------------------------------------------------------------

  it('correctly reports mixed state: one clean, one conflicted worktree', async () => {
    commitFile(repoPath, 'file.txt', 'line 1\noriginal\nline 3', 'Initial content')

    // Create two feature branches
    git(repoPath, 'checkout -b mixed-clean-branch')
    commitFile(repoPath, 'clean-feature.txt', 'clean feature', 'Clean feature')

    git(repoPath, 'checkout main')
    git(repoPath, 'checkout -b mixed-conflict-branch')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nfeature\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Conflicting change"')

    // Advance main
    git(repoPath, 'checkout main')
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'line 1\nmain\nline 3')
    git(repoPath, 'add file.txt')
    git(repoPath, 'commit -m "Main advance"')

    // Create worktree for clean branch
    const cleanWtPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-mixed-clean-wt-'))
    )
    fs.rmSync(cleanWtPath, { recursive: true })
    git(repoPath, `worktree add "${cleanWtPath}" mixed-clean-branch`)

    // Create worktree for conflicting branch
    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-mixed-conflict-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `worktree add "${worktreePath}" mixed-conflict-branch`)

    // Start rebase on conflict worktree
    try {
      execSync('git rebase main', {
        cwd: worktreePath,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test User',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test User',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: repoPath
        }
      })
    } catch {
      // Expected: conflict
    }

    const worktrees = await adapter.listWorktrees(repoPath)

    // Clean worktree
    const cleanWt = worktrees.find((w) => w.path === cleanWtPath)
    expect(cleanWt).toBeDefined()
    expect(cleanWt!.isRebasing).toBe(false)
    expect(cleanWt!.conflictedFiles).toEqual([])

    // Conflicted worktree
    const conflictWt = worktrees.find((w) => w.path === worktreePath)
    expect(conflictWt).toBeDefined()
    expect(conflictWt!.isRebasing).toBe(true)
    expect(conflictWt!.conflictedFiles.length).toBeGreaterThan(0)

    // Cleanup extra worktree
    try {
      git(repoPath, `worktree remove "${cleanWtPath}" --force`)
    } catch { /* ignore */ }
    await fs.promises.rm(cleanWtPath, { recursive: true, force: true })
  })

  // -----------------------------------------------------------------------
  // Multiple conflicted files
  // -----------------------------------------------------------------------

  it('reports all conflicted files when multiple files conflict', async () => {
    commitFile(repoPath, 'a.txt', 'original-a', 'Initial a')
    commitFile(repoPath, 'b.txt', 'original-b', 'Initial b')

    git(repoPath, 'checkout -b multi-file-conflict-test')
    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'feature-a')
    fs.writeFileSync(path.join(repoPath, 'b.txt'), 'feature-b')
    git(repoPath, 'add -A')
    git(repoPath, 'commit -m "Feature: change both files"')

    git(repoPath, 'checkout main')
    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'main-a')
    fs.writeFileSync(path.join(repoPath, 'b.txt'), 'main-b')
    git(repoPath, 'add -A')
    git(repoPath, 'commit -m "Main: change both files"')

    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-multi-conflict-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `worktree add "${worktreePath}" multi-file-conflict-test`)

    try {
      execSync('git rebase main', {
        cwd: worktreePath,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test User',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test User',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: repoPath
        }
      })
    } catch {
      // Expected: conflict
    }

    const worktrees = await adapter.listWorktrees(repoPath)
    const wt = worktrees.find((w) => w.path === worktreePath)

    expect(wt).toBeDefined()
    expect(wt!.isRebasing).toBe(true)
    expect(wt!.conflictedFiles).toContain('a.txt')
    expect(wt!.conflictedFiles).toContain('b.txt')
    expect(wt!.conflictedFiles.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: resolve conflicts → continue → stale files cleaned up
// ---------------------------------------------------------------------------

describe('Worktree conflict lifecycle', () => {
  let repoPath: string
  let worktreePath: string
  let adapter: SimpleGitAdapter

  beforeEach(async () => {
    repoPath = await createTestRepo()
    adapter = new SimpleGitAdapter()

    // Base content on main
    commitFile(repoPath, 'file.txt', 'line 1\noriginal\nline 3', 'Initial content')

    // Feature branch with conflicting change
    git(repoPath, 'checkout -b lifecycle-conflict-test')
    commitFile(repoPath, 'file.txt', 'line 1\nfeature-change\nline 3', 'Feature: modify line 2')

    // Advance main with a different change to same line
    git(repoPath, 'checkout main')
    commitFile(repoPath, 'file.txt', 'line 1\nmain-change\nline 3', 'Main: modify line 2')

    // Create worktree and start conflicting rebase
    worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-lifecycle-wt-'))
    )
    fs.rmSync(worktreePath, { recursive: true })
    git(repoPath, `worktree add "${worktreePath}" lifecycle-conflict-test`)

    try {
      execSync('git rebase main', {
        cwd: worktreePath,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test User',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test User',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: repoPath
        }
      })
    } catch {
      // Expected: conflict
    }
  })

  afterEach(async () => {
    try {
      execSync('git rebase --abort', { cwd: worktreePath, stdio: 'ignore' })
    } catch {
      /* already finished */
    }
    try {
      git(repoPath, `worktree remove "${worktreePath}" --force`)
    } catch {
      /* may already be gone */
    }
    fs.rmSync(worktreePath, { recursive: true, force: true })
    await cleanupTestRepo(repoPath)
  })

  it('cleans up stale rebase files after rebase continue', async () => {
    // Confirm conflict is detected
    const before = await adapter.listWorktrees(repoPath)
    const wtBefore = before.find((w) => w.path === worktreePath)
    expect(wtBefore).toBeDefined()
    expect(wtBefore!.isRebasing).toBe(true)
    expect(wtBefore!.conflictedFiles.length).toBeGreaterThan(0)

    // Resolve the conflict and continue the rebase
    fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'line 1\nresolved\nline 3')
    execSync('git add file.txt', { cwd: worktreePath })
    execSync('git rebase --continue', {
      cwd: worktreePath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test User',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test User',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: repoPath
      }
    })

    // listWorktrees should report no conflicts AND clean up stale files
    const after = await adapter.listWorktrees(repoPath)
    const wtAfter = after.find((w) => w.path === worktreePath)
    expect(wtAfter).toBeDefined()
    expect(wtAfter!.isRebasing).toBe(false)
    expect(wtAfter!.conflictedFiles).toEqual([])

    // Verify stale files were cleaned up
    const gitDir = await resolveGitDir(worktreePath)
    for (const staleFile of ['AUTO_MERGE', 'REBASE_HEAD', 'ORIG_HEAD']) {
      const filePath = path.join(gitDir, staleFile)
      expect(fs.existsSync(filePath), `${staleFile} should be cleaned up`).toBe(false)
    }
  })

  it('cleans up stale rebase files after rebase abort via adapter', async () => {
    // Confirm conflict is detected
    const before = await adapter.listWorktrees(repoPath)
    const wtBefore = before.find((w) => w.path === worktreePath)
    expect(wtBefore!.isRebasing).toBe(true)

    // Abort via the adapter (simulates what the app does)
    await adapter.rebaseAbort(worktreePath)

    // Verify stale files were cleaned up
    const gitDir = await resolveGitDir(worktreePath)
    for (const staleFile of ['AUTO_MERGE', 'REBASE_HEAD', 'ORIG_HEAD']) {
      const filePath = path.join(gitDir, staleFile)
      expect(fs.existsSync(filePath), `${staleFile} should be cleaned up`).toBe(false)
    }

    // listWorktrees should report clean state
    const after = await adapter.listWorktrees(repoPath)
    const wtAfter = after.find((w) => w.path === worktreePath)
    expect(wtAfter!.isRebasing).toBe(false)
    expect(wtAfter!.conflictedFiles).toEqual([])
  })
})
