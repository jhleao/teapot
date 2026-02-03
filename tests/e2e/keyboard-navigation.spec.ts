/**
 * Tests for keyboard navigation and accessibility.
 * Verifies Teapot can be used effectively with keyboard-only navigation.
 */
import { expect as baseExpect, test } from './fixtures/electronApp'
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

test.describe('Keyboard Navigation - No Repo', () => {
  test('settings dialog can be opened with keyboard', async ({ page }) => {
    await baseExpect(page.getByTestId('app-container')).toBeVisible()

    // Focus settings button and activate with Enter
    const settingsButton = page.getByTestId('settings-button')
    await settingsButton.focus()
    await page.keyboard.press('Enter')

    // Settings dialog should open
    await baseExpect(page.getByTestId('settings-dialog')).toBeVisible()
  })

  test('settings dialog can be closed with Escape', async ({ page }) => {
    await baseExpect(page.getByTestId('app-container')).toBeVisible()

    // Open settings
    await page.getByTestId('settings-button').click()
    await baseExpect(page.getByTestId('settings-dialog')).toBeVisible()

    // Close with Escape
    await page.keyboard.press('Escape')
    await baseExpect(page.getByTestId('settings-dialog')).not.toBeVisible()
  })

  test('repo dropdown can be opened and navigated with keyboard', async ({ page }) => {
    await baseExpect(page.getByTestId('app-container')).toBeVisible()

    // Focus the repo selector button
    const repoButton = page.getByTestId('repo-selector-button')
    await repoButton.focus()

    // Press Enter to open dropdown
    await page.keyboard.press('Enter')
    await baseExpect(page.getByTestId('repo-dropdown')).toBeVisible()

    // Press Escape to close
    await page.keyboard.press('Escape')
    await baseExpect(page.getByTestId('repo-dropdown')).not.toBeVisible()
  })
})

testWithRepo.describe('Keyboard Navigation - With Repo', () => {
  testWithRepo.beforeEach(async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()
    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
  })

  testWithRepo('sync button can be activated with keyboard', async ({ page }) => {
    const syncButton = page.getByTestId('sync-button')
    await expect(syncButton).toBeVisible()

    // Focus and activate with Enter
    await syncButton.focus()
    await page.keyboard.press('Enter')

    // Button should show pulling state (text changes)
    await expect(syncButton).toContainText(/pulling|git pull/i)
  })

  testWithRepo('repo dropdown remains navigable with repo loaded', async ({ page }) => {
    // Open repo dropdown
    const repoButton = page.getByTestId('repo-selector-button')
    await repoButton.focus()
    await page.keyboard.press('Enter')

    await expect(page.getByTestId('repo-dropdown')).toBeVisible()

    // Tab to navigate within dropdown
    await page.keyboard.press('Tab')

    // Close with Escape
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('repo-dropdown')).not.toBeVisible()
  })

  testWithRepo('settings accessible when repo is loaded', async ({ page }) => {
    // Focus settings button directly
    const settingsButton = page.getByTestId('settings-button')
    await settingsButton.focus()

    // Activate with Enter
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Navigate theme select with keyboard
    const themeSelect = page.getByRole('combobox', { name: 'Appearance' })
    await themeSelect.focus()

    // Arrow down to change selection
    await page.keyboard.press('ArrowDown')

    // Close with Escape
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()
  })
})

testWithRepo.describe('Focus Management', () => {
  testWithRepo('dialog can be closed with Escape after click open', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()
    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    const settingsButton = page.getByTestId('settings-button')

    // Open settings by clicking
    await settingsButton.click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Close with Escape
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()
  })

  testWithRepo('dropdown focus management', async ({ page, gitRepo }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()
    await addRepoToApp(page, gitRepo.repoPath)
    await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

    // Click outside any dropdown to ensure clean state
    await page.mouse.click(10, 10)

    // Open repo dropdown
    await page.getByTestId('repo-selector-button').click()
    await expect(page.getByTestId('repo-dropdown')).toBeVisible()

    // Click outside to close
    await page.mouse.click(10, 10)
    await expect(page.getByTestId('repo-dropdown')).not.toBeVisible()
  })
})
