import { expect, test } from './fixtures/electronApp'

test.describe('Repository Selection', () => {
  test('shows empty state when no repository is selected', async ({ page }) => {
    // Verify app container is present
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Verify empty state is shown
    await expect(page.getByTestId('empty-state-no-repo')).toBeVisible()

    // Verify the action button is present
    await expect(page.getByTestId('empty-state-action')).toBeVisible()
    await expect(page.getByTestId('empty-state-action')).toContainText('Select Repository')
  })

  test('repo selector button is accessible from empty state', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // The repo selector should be available even without a repo selected
    await expect(page.getByTestId('repo-selector')).toBeVisible()
    await expect(page.getByTestId('repo-selector-button')).toBeVisible()
  })
})

test.describe('Repository Dropdown', () => {
  test('opens and closes repository dropdown', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Click repo selector button
    await page.getByTestId('repo-selector-button').click()

    // Dropdown should appear
    await expect(page.getByTestId('repo-dropdown')).toBeVisible()

    // Verify add repo button is in dropdown
    await expect(page.getByTestId('add-repo-button')).toBeVisible()

    // Verify clone repo button is in dropdown
    await expect(page.getByTestId('clone-repo-button')).toBeVisible()

    // Click outside to close (click on body)
    await page.mouse.click(10, 10)

    // Dropdown should close
    await expect(page.getByTestId('repo-dropdown')).not.toBeVisible()
  })

  test('dropdown shows no repositories message when empty', async ({ page }) => {
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Click repo selector button
    await page.getByTestId('repo-selector-button').click()

    // Should show no repositories found message
    await expect(page.getByText('No repositories found')).toBeVisible()
  })
})
