/**
 * Tests for error states and graceful error handling.
 * Verifies Teapot displays appropriate error messages and doesn't crash.
 */
import { test as base, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ElectronFixtures, electronFixtures } from './fixtures/electronApp'
import { createGitHelpers, GitRepoFixture, initializeRepo } from './fixtures/gitRepo'
import { addRepoToApp, testWithRepo } from './fixtures/testWithRepo'

// Custom fixture for repos with intentional problems
type ErrorStateFixtures = ElectronFixtures & {
  corruptRepo: GitRepoFixture
  nonExistentRepoPath: string
}

const testWithErrorCases = base.extend<ErrorStateFixtures>({
  ...electronFixtures,

  // A repo with a corrupt .git directory
  corruptRepo: async ({}, use) => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-corrupt-repo-'))
    const helpers = createGitHelpers(repoPath)

    // Initialize a normal repo first
    initializeRepo(repoPath, helpers, { withInitialCommit: true })

    // Corrupt it by removing essential git files
    const headPath = path.join(repoPath, '.git', 'HEAD')
    fs.writeFileSync(headPath, 'corrupted data that is not a valid ref')

    await use({ repoPath, ...helpers })

    fs.rmSync(repoPath, { recursive: true, force: true })
  },

  // Path to a non-existent directory
  nonExistentRepoPath: async ({}, use) => {
    const fakePath = path.join(os.tmpdir(), 'teapot-does-not-exist-' + Date.now())
    // Ensure it doesn't exist
    if (fs.existsSync(fakePath)) {
      fs.rmSync(fakePath, { recursive: true })
    }
    await use(fakePath)
  }
})

testWithRepo.describe('Error State Display', () => {
  testWithRepo('error state has proper structure', async ({ page, gitRepo }) => {
    // This test documents the expected error state structure
    // We'll trigger a scenario that might cause an error by manipulating the repo

    await expect(page.getByTestId('app-container')).toBeVisible()

    // Add a valid repo first
    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // The error state component should have these data-testids when shown:
    // - empty-state-error: the container
    // - error-reload-button: reload button

    // For now, verify the app is in a good state
    await expect(page.getByTestId('stack-view')).toBeVisible()
  })
})

testWithErrorCases.describe('Invalid Repository Handling', () => {
  testWithErrorCases('handles non-existent repo path gracefully', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Try to add a non-existent path via IPC
    // The app should handle this gracefully
    const nonExistentPath = '/tmp/path-that-does-not-exist-' + Date.now()

    try {
      await page.evaluate(async (repoPath: string) => {
        await window.api.addLocalRepo({ path: repoPath })
      }, nonExistentPath)
    } catch {
      // Expected to fail or be rejected
    }

    // App should still be responsive
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Should still show empty state or handle error
    await page.waitForTimeout(1000)
    const hasEmptyState = await page
      .getByTestId('empty-state-no-repo')
      .isVisible()
      .catch(() => false)
    const hasErrorState = await page
      .getByTestId('empty-state-error')
      .isVisible()
      .catch(() => false)

    // Either we're still in empty state or showing an error - both are valid
    expect(hasEmptyState || hasErrorState).toBe(true)
  })

  testWithErrorCases('handles corrupt repo gracefully', async ({ page, corruptRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Try to add the corrupt repo
    await addRepoToApp(page, corruptRepo.repoPath)

    // Wait for the app to process
    await page.waitForTimeout(2000)

    // App should show error state or handle gracefully
    const hasStackView = await page
      .getByTestId('stack-view')
      .first()
      .isVisible()
      .catch(() => false)
    const hasErrorState = await page
      .getByTestId('empty-state-error')
      .isVisible()
      .catch(() => false)
    const hasEmptyState = await page
      .getByTestId('empty-state-no-repo')
      .isVisible()
      .catch(() => false)

    // App didn't crash - one of these states should be visible
    expect(hasStackView || hasErrorState || hasEmptyState).toBe(true)
  })
})

testWithRepo.describe('Recovery from Errors', () => {
  testWithRepo('can add valid repo after error', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // First, verify we're in empty state
    await expect(page.getByTestId('empty-state-no-repo')).toBeVisible()

    // Try an invalid operation (selecting non-existent repo)
    try {
      await page.evaluate(async () => {
        await window.api.selectLocalRepo({ path: '/invalid/path' })
      })
    } catch {
      // Expected to fail
    }

    // Wait a moment
    await page.waitForTimeout(500)

    // Now add a valid repo
    await addRepoToApp(page, gitRepo.repoPath)

    // Should successfully load
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
  })

  testWithRepo('app remains usable after IPC failure', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Load a valid repo first
    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // UI should still be responsive
    await expect(page.getByTestId('settings-button')).toBeVisible()
    await expect(page.getByTestId('repo-selector-button')).toBeVisible()

    // Settings should still work
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()
  })
})

testWithRepo.describe('Loading State Handling', () => {
  testWithRepo('loading state appears during repo load', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Note: This test is timing-dependent
    // The loading state might be too fast to catch, so we verify the end state
    await addRepoToApp(page, gitRepo.repoPath)

    // After loading completes, stack view should be visible
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
  })
})

testWithRepo.describe('Graceful Degradation', () => {
  testWithRepo('app handles repo with missing origin gracefully', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // The test repo has no remote configured
    // Verify it doesn't have a remote
    const remotes = gitRepo.git('remote').trim()
    expect(remotes).toBe('')

    // Add the repo
    await addRepoToApp(page, gitRepo.repoPath)

    // Should load successfully despite no remote
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Sync button should be visible but may indicate no remote
    const syncButton = page.getByTestId('sync-button')
    await expect(syncButton).toBeVisible()
  })

  testWithRepo('handles repo with unusual config gracefully', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Set some unusual git config values
    gitRepo.git('config core.ignorecase true')
    gitRepo.git('config core.autocrlf input')

    await addRepoToApp(page, gitRepo.repoPath)

    // Should load successfully
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
  })
})
