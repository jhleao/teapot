import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo.describe('UI Elements with Loaded Repo', () => {
  testWithRepo.beforeEach(async ({ page, gitRepo }) => {
    // Load the repo before each test
    await expect(page.getByTestId('app-container')).toBeVisible()
    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
  })

  testWithRepo('sync button is clickable', async ({ page }) => {
    const syncButton = page.getByTestId('sync-button')
    await expect(syncButton).toBeVisible()
    await expect(syncButton).toBeEnabled()

    // Button should have "git pull" text initially
    await expect(syncButton).toContainText('git pull')
  })

  testWithRepo('topbar elements are visible when repo is loaded', async ({ page }) => {
    // Topbar should be visible
    await expect(page.getByTestId('topbar')).toBeVisible()

    // Repo selector should still be accessible
    await expect(page.getByTestId('repo-selector')).toBeVisible()

    // Repo metadata container should show repo info, not "no repo" message
    await expect(page.getByTestId('no-repo-message')).not.toBeVisible()
  })

  testWithRepo('settings remains accessible with loaded repo', async ({ page }) => {
    // Settings button should be visible
    await expect(page.getByTestId('settings-button')).toBeVisible()

    // Click settings
    await page.getByTestId('settings-button').click()

    // Settings dialog should open
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Can close with Escape
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()
  })

  testWithRepo('repo dropdown shows current repo as selected', async ({ page, gitRepo }) => {
    // Open repo dropdown
    await page.getByTestId('repo-selector-button').click()
    await expect(page.getByTestId('repo-dropdown')).toBeVisible()

    // Should show the repo path (or a portion of it)
    const repoName = gitRepo.repoPath.split('/').pop()
    if (repoName) {
      // The selected repo should be visible in the dropdown
      await expect(page.locator(`text=${repoName}`).first()).toBeVisible()
    }
  })
})

// TODO: These tests need fixes - commit view selectors don't match current app
testWithRepo.describe.skip('Commit View Elements', () => {
  testWithRepo('displays commit with timestamp', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Create commits
    gitRepo.commitFile('test.ts', 'test', 'Test commit message')

    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Commit message should be visible
    await expect(page.getByText('Test commit message')).toBeVisible()

    // Relative timestamp should be visible (e.g., "just now", "a few seconds ago")
    await expect(page.getByText(/just now|seconds? ago|minute/i)).toBeVisible()
  })

  testWithRepo('shows main branch badge', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Main branch should be visible
    await expect(page.getByText('main')).toBeVisible()
  })
})
