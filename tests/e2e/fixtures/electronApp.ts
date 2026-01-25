import { _electron as electron, ElectronApplication, Page, expect, test as base } from '@playwright/test'
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
    const electronApp = await electron.launch({
      args: [mainEntry],
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
    await electronApp.close()
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
}

export const test = base.extend<ElectronFixtures>(electronFixtures)

export { expect }
