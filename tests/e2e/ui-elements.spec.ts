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

testWithRepo.describe('Commit View Elements', () => {
  testWithRepo('displays commit with timestamp', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Create commits
    gitRepo.commitFile('test.ts', 'test', 'Test commit message')

    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Commit message should be visible
    await expect(page.getByText('Test commit message')).toBeVisible()

    // Relative timestamp should be visible and have valid format
    // App uses compact format: "1s", "2m", "3h", "4d" or verbose "X seconds ago"
    const timestamp = page.getByTestId('commit-timestamp').first()
    await expect(timestamp).toBeVisible()
    await expect(timestamp).toHaveText(/^\d+[smhd]$|just now|seconds? ago|minutes? ago|hours? ago|days? ago/)
  })

  testWithRepo('shows main branch badge', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    await addRepoToApp(page, gitRepo.repoPath)

    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Main branch badge should be visible
    await expect(page.getByTestId('branch-badge-main')).toBeVisible()
  })

  testWithRepo('commit items have proper structure', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Create a commit
    gitRepo.commitFile('feature.ts', 'export const x = 1', 'Add feature')

    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Verify commit items are rendered
    const commitItems = page.getByTestId('commit-item')
    await expect(commitItems.first()).toBeVisible()

    // Each commit should have a timestamp
    await expect(page.getByTestId('commit-timestamp').first()).toBeVisible()
  })
})
