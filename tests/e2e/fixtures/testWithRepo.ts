import { expect, Page, test as base } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ElectronFixtures, electronFixtures } from './electronApp'
import { createGitHelpers, GitRepoFixture, initializeRepo } from './gitRepo'

type TestWithRepoFixtures = ElectronFixtures & {
  gitRepo: GitRepoFixture
}

/**
 * Combined test fixture that provides both an Electron app AND a git repo.
 * Composes electronFixtures with an additional gitRepo fixture.
 */
export const testWithRepo = base.extend<TestWithRepoFixtures>({
  ...electronFixtures,

  gitRepo: async ({}, use) => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-test-repo-'))
    const helpers = createGitHelpers(repoPath)

    initializeRepo(repoPath, helpers, { withInitialCommit: true })

    await use({ repoPath, ...helpers })

    fs.rmSync(repoPath, { recursive: true, force: true })
  }
})

/**
 * Add a repo via IPC and reload the page so React picks up the change.
 * The IPC call persists the repo to disk, but React state isn't updated directly.
 */
export async function addRepoToApp(page: Page, repoPath: string): Promise<void> {
  await page.evaluate(async (repoPathArg: string) => {
    await window.api.addLocalRepo({ path: repoPathArg })
    await window.api.selectLocalRepo({ path: repoPathArg })
  }, repoPath)

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

export { expect }
