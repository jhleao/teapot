import {
  test as base,
  _electron as electron,
  ElectronApplication,
  expect,
  Page
} from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ElectronFixtures = {
  app: ElectronApplication
  page: Page
  userDataDir: string
  mainEntry: string
}

/**
 * Core electron fixtures that can be composed into other test fixtures.
 * Provides isolated user data directory, build artifact validation, and app lifecycle.
 */
export const electronFixtures: Parameters<typeof base.extend<ElectronFixtures>>[0] = {
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-e2e-'))
    await use(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  },

  mainEntry: async ({}, use) => {
    const entry = path.join(process.cwd(), 'out', 'main', 'index.js')
    if (!fs.existsSync(entry)) {
      throw new Error('Build artifacts missing. Run `pnpm build` before `pnpm e2e`.')
    }
    await use(entry)
  },

  app: async ({ mainEntry, userDataDir }, use) => {
    // Disable sandbox in CI - GitHub Actions runners don't support SUID sandbox
    const args = process.env.CI ? [mainEntry, '--no-sandbox'] : [mainEntry]

    const electronApp = await electron.launch({
      args,
      cwd: process.cwd(),
      env: {
        ...process.env,
        TEAPOT_E2E: '1',
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        TEAPOT_E2E_USER_DATA: userDataDir
      }
    })
    await use(electronApp)

    // Close with timeout - force kill if app doesn't respond
    try {
      await Promise.race([
        electronApp.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('App close timeout')), 5000)
        )
      ])
    } catch {
      // Force kill the process if graceful close fails
      const pid = electronApp.process().pid
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Process may already be dead
        }
      }
    }
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
}

export const test = base.extend<ElectronFixtures>(electronFixtures)

export { expect }
