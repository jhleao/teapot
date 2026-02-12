/**
 * E2E Tests for PR #345: Multi-Worktree Conflict Awareness
 *
 * Tests the UI elements that appear when a worktree has rebase conflicts:
 * 1. Red "conflicted" badge on worktree indicator
 * 2. Red banner when viewing a different worktree
 * 3. "Switch to resolve" button → ConflictResolutionDialog
 * 4. Resolve conflicts → badge/banner disappear
 * 5. Abort flow → state cleaned up
 * 6. External rebase (via CLI) → dialog shown correctly
 */
import { test as base, expect, Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ElectronFixtures, electronFixtures } from './fixtures/electronApp'
import { createGitHelpers, GitRepoFixture, initializeRepo } from './fixtures/gitRepo'
import { addRepoToApp } from './fixtures/testWithRepo'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A repo where a temp worktree has a conflicting rebase in progress. */
interface ConflictWorktreeFixtures extends ElectronFixtures {
  /** Main repo with a conflicting rebase happening in a temp worktree. */
  conflictRepo: GitRepoFixture & {
    worktreePath: string
    featureBranch: string
  }
}

/**
 * Creates a git repo that has:
 *  - main branch with file.txt = "line 1\nmain-change\nline 3"
 *  - conflict-rebase-test branch with file.txt = "line 1\nfeature-change\nline 3"
 *  - A worktree (at worktreePath) on conflict-rebase-test
 *  - A rebase of conflict-rebase-test onto main IN that worktree, paused on conflict
 *
 * Branch / worktree names are deliberately descriptive so it's clear what's
 * being tested when looking at `git worktree list` output.
 */
const testWithConflictWorktree = base.extend<ConflictWorktreeFixtures>({
  ...electronFixtures,

  conflictRepo: async ({}, use) => {
    // Use realpath to resolve macOS /var → /private/var symlink
    const repoPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-conflict-wt-'))
    )
    const helpers = createGitHelpers(repoPath)
    initializeRepo(repoPath, helpers, { withInitialCommit: false })

    // --- Set up conflicting history ---
    // Base content on main
    helpers.commitFile('file.txt', 'line 1\noriginal\nline 3', 'Initial content on main')

    // Feature branch modifies the same line
    helpers.createBranch('conflict-rebase-test')
    helpers.createFile('file.txt', 'line 1\nfeature-change\nline 3')
    helpers.git('add file.txt')
    helpers.git('commit -m "Feature: modify line 2"')

    // Advance main so it also modifies line 2 → guaranteed conflict
    helpers.checkout('main')
    helpers.createFile('file.txt', 'line 1\nmain-change\nline 3')
    helpers.git('add file.txt')
    helpers.git('commit -m "Main: modify line 2"')

    // --- Create a worktree for the feature branch ---
    const worktreePath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-wt-conflict-rebase-test-'))
    )
    // Remove the dir mkdtemp created — git worktree add needs a non-existent target
    fs.rmSync(worktreePath, { recursive: true })
    helpers.git(`worktree add "${worktreePath}" conflict-rebase-test`)

    // --- Start a rebase that will conflict, inside the worktree ---
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
      // Expected: rebase fails with conflict — that's what we want
    }

    await use({
      repoPath,
      ...helpers,
      worktreePath,
      featureBranch: 'conflict-rebase-test'
    })

    // Cleanup: abort any in-progress rebase, remove worktree, remove repo
    try {
      execSync('git rebase --abort', { cwd: worktreePath, stdio: 'ignore' })
    } catch {
      /* already finished or no rebase */
    }
    try {
      helpers.git(`worktree remove "${worktreePath}" --force`)
    } catch {
      /* may already be gone */
    }
    fs.rmSync(worktreePath, { recursive: true, force: true })
    fs.rmSync(repoPath, { recursive: true, force: true })
  }
})

/** A repo where an external rebase (started via CLI) has conflicts in the main worktree. */
interface ExternalRebaseFixtures extends ElectronFixtures {
  externalRebaseRepo: GitRepoFixture & {
    featureBranch: string
  }
}

const testWithExternalRebase = base.extend<ExternalRebaseFixtures>({
  ...electronFixtures,

  externalRebaseRepo: async ({}, use) => {
    const repoPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-ext-rebase-'))
    )
    const helpers = createGitHelpers(repoPath)
    initializeRepo(repoPath, helpers, { withInitialCommit: false })

    // Set up conflicting branches
    helpers.commitFile('file.txt', 'line 1\noriginal\nline 3', 'Initial content')

    helpers.createBranch('cli-rebase-conflict-test')
    helpers.createFile('file.txt', 'line 1\nfeature-change\nline 3')
    helpers.git('add file.txt')
    helpers.git('commit -m "Feature: modify line 2"')

    helpers.checkout('main')
    helpers.createFile('file.txt', 'line 1\nmain-change\nline 3')
    helpers.git('add file.txt')
    helpers.git('commit -m "Main: modify line 2"')

    // Checkout feature branch and start a rebase that will conflict
    helpers.checkout('cli-rebase-conflict-test')
    try {
      helpers.git('rebase main')
    } catch {
      // Expected: conflict
    }

    await use({
      repoPath,
      ...helpers,
      featureBranch: 'cli-rebase-conflict-test'
    })

    try {
      helpers.git('rebase --abort')
    } catch {
      /* no rebase in progress */
    }
    fs.rmSync(repoPath, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Helper — wait for the app to fully load a repo
// ---------------------------------------------------------------------------

async function waitForRepoLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// 1-3. Conflict badge + banner when viewing a different worktree
// ---------------------------------------------------------------------------

testWithConflictWorktree.describe('Worktree Conflict Badge & Banner', () => {
  testWithConflictWorktree(
    'shows red conflicted badge on worktree indicator for conflicted worktree',
    async ({ page, conflictRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      // The app is viewing main (the main worktree).
      // The feature branch's worktree has conflicts → should show "conflicted" badge.
      // Badge text includes the worktree path; look for the red "Has merge conflicts" tooltip/title.
      const conflictedBadge = page.locator('span', { hasText: /conflict-rebase-test/ }).filter({
        has: page.locator('svg') // AlertTriangle icon
      })
      // Alternatively, look for the status label text
      await expect(
        page.getByTitle('Has merge conflicts - click to resolve').first()
      ).toBeVisible({ timeout: 10_000 })
    }
  )

  testWithConflictWorktree(
    'shows red conflict banner when another worktree has conflicts',
    async ({ page, conflictRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      // Banner should appear because a non-current worktree has conflicts
      const banner = page.locator('[role="alert"]')
      await expect(banner).toBeVisible({ timeout: 10_000 })
      await expect(banner).toContainText('merge conflicts')
    }
  )

  testWithConflictWorktree(
    'banner has "Switch to resolve" button for single conflicted worktree',
    async ({ page, conflictRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      const switchButton = page.getByRole('button', { name: /Switch to resolve/i })
      await expect(switchButton).toBeVisible({ timeout: 10_000 })
    }
  )
})

// ---------------------------------------------------------------------------
// 4. Click "Switch to resolve" → ConflictResolutionDialog
// ---------------------------------------------------------------------------

testWithConflictWorktree.describe('Switch to Conflicted Worktree', () => {
  testWithConflictWorktree(
    'clicking "Switch to resolve" shows ConflictResolutionDialog',
    async ({ page, conflictRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      // Click the switch button
      const switchButton = page.getByRole('button', { name: /Switch to resolve/i })
      await expect(switchButton).toBeVisible({ timeout: 10_000 })
      await switchButton.click()

      // ConflictResolutionDialog should appear — it contains "has conflicts" text
      // and Abort / Continue buttons
      await expect(page.getByText(/has conflicts/i)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
    }
  )
})

// ---------------------------------------------------------------------------
// 5. Resolve conflicts → badge and banner disappear
// ---------------------------------------------------------------------------

testWithConflictWorktree.describe('Resolve Conflicts Flow', () => {
  testWithConflictWorktree(
    'resolving conflicts and continuing removes badge and banner',
    async ({ page, conflictRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Resolve the conflict in the worktree BEFORE loading the app
      const conflictedFile = path.join(conflictRepo.worktreePath, 'file.txt')
      fs.writeFileSync(conflictedFile, 'line 1\nresolved\nline 3')
      execSync('git add file.txt', { cwd: conflictRepo.worktreePath })
      execSync('git rebase --continue', {
        cwd: conflictRepo.worktreePath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test User',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test User',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: conflictRepo.repoPath
        }
      })

      // Now load the app — there should be NO conflict indicators
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      // Banner should NOT be visible
      const banner = page.locator('[role="alert"]')
      await expect(banner).not.toBeVisible({ timeout: 5_000 })

      // "Has merge conflicts" badge should not exist
      await expect(
        page.getByTitle('Has merge conflicts - click to resolve')
      ).not.toBeVisible({ timeout: 5_000 })
    }
  )
})

// ---------------------------------------------------------------------------
// 6. Abort flow → state cleaned up
// ---------------------------------------------------------------------------

testWithConflictWorktree.describe('Abort Rebase Flow', () => {
  testWithConflictWorktree(
    'aborting rebase via dialog cleans up conflict state',
    async ({ page, conflictRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      // Switch to the conflicted worktree
      const switchButton = page.getByRole('button', { name: /Switch to resolve/i })
      await expect(switchButton).toBeVisible({ timeout: 10_000 })
      await switchButton.click()

      // Dialog should appear
      await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible({ timeout: 10_000 })

      // Click Abort
      await page.getByRole('button', { name: 'Abort' }).click()

      // After abort, the dialog should close and conflict indicators should disappear
      // Give the app time to refresh state
      await page.waitForTimeout(2_000)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Re-add repo since reload may clear state
      await addRepoToApp(page, conflictRepo.repoPath)
      await waitForRepoLoaded(page)

      // Verify banner is gone
      const banner = page.locator('[role="alert"]')
      await expect(banner).not.toBeVisible({ timeout: 5_000 })
    }
  )
})

// ---------------------------------------------------------------------------
// 7. External rebase (started via CLI) shows dialog correctly
// ---------------------------------------------------------------------------

testWithExternalRebase.describe('External Rebase Conflict Detection', () => {
  testWithExternalRebase(
    'detects external CLI rebase conflict and shows ConflictResolutionDialog',
    async ({ page, externalRebaseRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Load the repo — it already has a conflict from a CLI-initiated rebase
      await addRepoToApp(page, externalRebaseRepo.repoPath)

      // Since the CURRENT worktree has conflicts, the blocking modal should appear
      // ConflictResolutionDialog is shown for current-worktree conflicts
      await expect(page.getByText(/has conflicts/i)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
    }
  )

  testWithExternalRebase(
    'aborting external rebase cleans up state',
    async ({ page, externalRebaseRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, externalRebaseRepo.repoPath)

      // Dialog should appear
      await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible({ timeout: 15_000 })

      // Abort the external rebase
      await page.getByRole('button', { name: 'Abort' }).click()

      // Verify the dialog is gone and state is clean
      await page.waitForTimeout(2_000)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await addRepoToApp(page, externalRebaseRepo.repoPath)
      await waitForRepoLoaded(page)

      // No conflict dialog should be present
      await expect(page.getByText(/has conflicts/i)).not.toBeVisible({ timeout: 5_000 })
    }
  )

  testWithExternalRebase(
    'external rebase dialog shows conflicted file names',
    async ({ page, externalRebaseRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()
      await addRepoToApp(page, externalRebaseRepo.repoPath)

      // Dialog should show the conflicted file
      await expect(page.getByText(/has conflicts/i)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('file.txt')).toBeVisible({ timeout: 5_000 })
    }
  )
})
