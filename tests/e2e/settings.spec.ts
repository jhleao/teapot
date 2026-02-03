import { expect, test } from './fixtures/electronApp'

test.describe('Settings Dialog', () => {
  test('opens settings dialog when clicking settings button', async ({ page }) => {
    // Wait for app to fully load
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Settings button should be visible (even with no repo)
    await expect(page.getByTestId('settings-button')).toBeVisible()

    // Click the settings button
    await page.getByTestId('settings-button').click()

    // Settings dialog should appear
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Dialog should have the title
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('settings dialog contains expected sections', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Open settings
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Check for Appearance section
    await expect(page.getByText('Appearance')).toBeVisible()
    await expect(page.getByRole('combobox').first()).toBeVisible()

    // Check for GitHub PAT section
    await expect(page.getByText('GitHub Personal Access Token')).toBeVisible()

    // Check for Debug Logging section
    await expect(page.getByText('Debug Logging')).toBeVisible()
  })

  test('closes settings dialog when clicking outside or pressing escape', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Open settings
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Press escape to close
    await page.keyboard.press('Escape')

    // Dialog should be closed
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()
  })

  test('can change theme preference', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Open settings
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()

    // Find the theme select by role (more reliable than id)
    const themeSelect = page.getByRole('combobox', { name: 'Appearance' })
    await expect(themeSelect).toBeVisible()

    // Verify default options exist
    await expect(themeSelect.locator('option')).toHaveCount(3)

    // Change to dark theme
    await themeSelect.selectOption('dark')

    // Verify selection persists
    await expect(themeSelect).toHaveValue('dark')
  })
})
