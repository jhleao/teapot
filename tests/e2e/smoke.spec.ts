import { expect, test } from './fixtures/electronApp'

test.describe('Smoke Tests', () => {
  test('renders the main window with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Teapot/i)
    await expect(page.locator('body')).toBeVisible()
  })

  test('app container mounts and is interactive', async ({ page }) => {
    // Verify the React app has mounted
    await expect(page.getByTestId('app-container')).toBeVisible()

    // Verify key UI elements are present
    await expect(page.getByTestId('topbar')).toBeVisible()
    await expect(page.getByTestId('settings-button')).toBeVisible()
  })

  test('window has expected dimensions', async ({ app }) => {
    const window = await app.firstWindow()
    const { width, height } = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    // Window should be a reasonable size
    expect(width).toBeGreaterThan(400)
    expect(height).toBeGreaterThan(300)
  })
})
