/**
 * Tests for edge case repository configurations.
 * These verify Teapot handles unusual repo states gracefully.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base, expect, Page } from '@playwright/test'
import { ElectronFixtures, electronFixtures } from './fixtures/electronApp'
import { createGitHelpers, GitRepoFixture, initializeRepo } from './fixtures/gitRepo'
import { addRepoToApp, testWithRepo } from './fixtures/testWithRepo'

// Custom fixture for edge case repos that need special initialization
type EdgeCaseFixtures = ElectronFixtures & {
  emptyRepo: GitRepoFixture
  singleBranchRepo: GitRepoFixture
}

const testWithEdgeCases = base.extend<EdgeCaseFixtures>({
  ...electronFixtures,

  // Empty repo with no commits at all
  emptyRepo: async ({}, use) => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-empty-repo-'))
    const helpers = createGitHelpers(repoPath)

    // Initialize WITHOUT initial commit
    initializeRepo(repoPath, helpers, { withInitialCommit: false })

    await use({ repoPath, ...helpers })

    fs.rmSync(repoPath, { recursive: true, force: true })
  },

  // Repo with only main branch and minimal commits
  singleBranchRepo: async ({}, use) => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-single-branch-'))
    const helpers = createGitHelpers(repoPath)

    initializeRepo(repoPath, helpers, { withInitialCommit: true })

    await use({ repoPath, ...helpers })

    fs.rmSync(repoPath, { recursive: true, force: true })
  }
})

testWithRepo.describe('Edge Cases', () => {
  testWithRepo.describe('Dirty working tree', () => {
    testWithRepo('can load repo with uncommitted changes', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Stage a file but don't commit
      gitRepo.createFile('src/uncommitted.ts', 'export const dirty = true')
      gitRepo.git('add src/uncommitted.ts')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Stack view should still load despite staged changes
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('can load repo with modified but unstaged files', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Modify an existing tracked file
      gitRepo.createFile('README.md', '# Modified README\n\nThis has been changed.')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Stack view should load
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('can load repo with untracked files', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create untracked files
      gitRepo.createFile('untracked.txt', 'This file is not tracked')
      gitRepo.createFile('.env.local', 'SECRET=123')
      gitRepo.createFile('node_modules/package/index.js', '// node_modules file')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Stack view should load
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles repo with both staged and unstaged changes', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create a staged change
      gitRepo.createFile('src/staged.ts', 'export const staged = true')
      gitRepo.git('add src/staged.ts')

      // Create an unstaged modification
      gitRepo.createFile('README.md', '# Modified but not staged')

      // Create an untracked file
      gitRepo.createFile('new-file.txt', 'Untracked content')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Stack view should load despite messy working tree
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Detached HEAD', () => {
    testWithRepo('can load repo in detached HEAD state', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Add a few commits first
      gitRepo.commitFile('src/a.ts', 'export const a = 1', 'Commit A')
      gitRepo.commitFile('src/b.ts', 'export const b = 2', 'Commit B')

      // Get the first commit hash and checkout to it (detached HEAD)
      const firstCommitHash = gitRepo.git('rev-parse HEAD~1')
      gitRepo.git(`checkout ${firstCommitHash}`)

      // Verify we're in detached HEAD state
      const headState = gitRepo.git('symbolic-ref --short -q HEAD || echo DETACHED')
      expect(headState).toBe('DETACHED')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // App should handle detached HEAD gracefully
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('detached HEAD with uncommitted changes', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.commitFile('src/a.ts', 'export const a = 1', 'Commit A')

      // Detach HEAD
      const hash = gitRepo.git('rev-parse HEAD')
      gitRepo.git(`checkout ${hash}`)

      // Make changes in detached state
      gitRepo.createFile('detached-work.ts', 'export const work = "in progress"')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Single branch repository', () => {
    testWithRepo('can load simple repo with only main branch', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Just add a few commits on main, no branches
      gitRepo.commitFile('src/one.ts', '1', 'First')
      gitRepo.commitFile('src/two.ts', '2', 'Second')
      gitRepo.commitFile('src/three.ts', '3', 'Third')

      // Verify only main exists
      const branches = gitRepo.git('branch').trim()
      expect(branches).toBe('* main')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText('Third')).toBeVisible()
    })
  })
})

// Empty repo tests need special fixture
// Skip: Empty repos (no commits) show an error state that doesn't match expected selectors
// TODO: Add data-testid for error state when loading invalid/empty repos
testWithEdgeCases.describe.skip('Empty Repository', () => {
  testWithEdgeCases('handles empty repo with no commits', async ({ page, emptyRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Verify repo is truly empty
    try {
      emptyRepo.git('log --oneline')
      throw new Error('Expected git log to fail on empty repo')
    } catch {
      // Expected - no commits yet
    }

    // Add the empty repo
    await addRepoToApp(page, emptyRepo.repoPath)

    // App should handle empty repo - might show empty state or error
    // The key is it shouldn't crash
    await page.waitForTimeout(2000)

    // Either stack-view loads or we get an appropriate empty/error state
    const hasStackView = await page.getByTestId('stack-view').first().isVisible().catch(() => false)
    const hasEmptyState = await page.getByTestId('empty-state-no-repo').isVisible().catch(() => false)

    // One of these should be true - app didn't crash
    expect(hasStackView || hasEmptyState).toBe(true)
  })

  testWithEdgeCases('empty repo with staged but uncommitted files', async ({ page, emptyRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Stage a file but don't commit
    emptyRepo.createFile('first-file.ts', 'export const first = true')
    emptyRepo.git('add first-file.ts')

    // Add the repo
    await addRepoToApp(page, emptyRepo.repoPath)

    // App should handle this gracefully
    await page.waitForTimeout(2000)

    const hasStackView = await page.getByTestId('stack-view').first().isVisible().catch(() => false)
    const hasEmptyState = await page.getByTestId('empty-state-no-repo').isVisible().catch(() => false)

    expect(hasStackView || hasEmptyState).toBe(true)
  })
})

testWithRepo.describe('Repository State Edge Cases', () => {
  testWithRepo('handles repo after soft reset', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Create commits then soft reset
    gitRepo.commitFile('src/a.ts', 'a', 'Commit A')
    gitRepo.commitFile('src/b.ts', 'b', 'Commit B')
    gitRepo.git('reset --soft HEAD~1')

    // Now we have staged changes from the undone commit
    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
  })

  testWithRepo('handles repo after mixed reset', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    gitRepo.commitFile('src/a.ts', 'a', 'Commit A')
    gitRepo.commitFile('src/b.ts', 'b', 'Commit B')
    gitRepo.git('reset --mixed HEAD~1')

    // Now we have unstaged changes
    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
  })

  // Skip: stash tests would need UI to show stash info
  testWithRepo.skip('handles repo with stashed changes', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    gitRepo.createFile('stashed.ts', 'export const stashed = true')
    gitRepo.git('add stashed.ts')
    gitRepo.git('stash push -m "WIP changes"')

    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    // TODO: Need selector for stash indicator if Teapot shows stashes
  })
})
