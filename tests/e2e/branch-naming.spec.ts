/**
 * Tests for branch naming edge cases.
 * Verifies Teapot handles various branch naming conventions correctly.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo.describe('Branch Naming', () => {
  testWithRepo.describe('Branches with special characters', () => {
    testWithRepo('handles branch names with dots', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.createBranch('feature/auth-v2.0')
      gitRepo.commitFile('src/auth-v2.ts', 'export const v2 = true', 'Add auth v2.0')

      gitRepo.checkout('main')
      gitRepo.createBranch('release/1.0.0')
      gitRepo.commitFile('VERSION', '1.0.0', 'Release 1.0.0')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles branch names with hyphens and underscores', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.createBranch('feature_snake_case')
      gitRepo.commitFile('src/snake.ts', 'export const snake = true', 'Add snake case feature')

      gitRepo.checkout('main')
      gitRepo.createBranch('feature-kebab-case')
      gitRepo.commitFile('src/kebab.ts', 'export const kebab = true', 'Add kebab case feature')

      gitRepo.checkout('main')
      gitRepo.createBranch('mix_kebab-snake_case')
      gitRepo.commitFile('src/mix.ts', 'export const mix = true', 'Add mixed case feature')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles branch names with numbers', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.createBranch('feature/123-ticket')
      gitRepo.commitFile('src/ticket.ts', 'export const ticket = 123', 'Ticket 123')

      gitRepo.checkout('main')
      gitRepo.createBranch('feature/JIRA-456')
      gitRepo.commitFile('src/jira.ts', 'export const jira = 456', 'JIRA-456')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Branches with slashes (nested paths)', () => {
    testWithRepo('handles single slash', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.createBranch('feature/login')
      gitRepo.commitFile('src/login.ts', 'export function login() {}', 'Add login')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles multiple slashes (deeply nested)', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.createBranch('feature/user/profile/settings')
      gitRepo.commitFile(
        'src/settings.ts',
        'export const settings = {}',
        'Add user profile settings'
      )

      gitRepo.checkout('main')
      gitRepo.createBranch('team/frontend/components/button')
      gitRepo.commitFile('src/button.tsx', '<button/>', 'Add button component')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles common prefix convention branches', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Common conventions
      gitRepo.createBranch('feature/auth')
      gitRepo.commitFile('f1.ts', '1', 'Feature 1')
      gitRepo.checkout('main')

      gitRepo.createBranch('bugfix/login')
      gitRepo.commitFile('b1.ts', '1', 'Bugfix 1')
      gitRepo.checkout('main')

      gitRepo.createBranch('hotfix/security')
      gitRepo.commitFile('h1.ts', '1', 'Hotfix 1')
      gitRepo.checkout('main')

      gitRepo.createBranch('release/v2.0')
      gitRepo.commitFile('r1.ts', '1', 'Release 1')
      gitRepo.checkout('main')

      gitRepo.createBranch('chore/deps')
      gitRepo.commitFile('c1.ts', '1', 'Chore 1')
      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Long branch names', () => {
    testWithRepo('handles moderately long branch names', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // 50 character branch name
      const longName = 'feature/this-is-a-moderately-long-branch-name-ok'
      gitRepo.createBranch(longName)
      gitRepo.commitFile('src/long.ts', 'export const long = true', 'Long branch commit')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles very long branch names (100+ chars)', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // 100+ character branch name (common in auto-generated branches)
      const veryLongName =
        'feature/JIRA-12345-implement-the-new-user-authentication-flow-with-oauth2-and-refresh-tokens-support'
      gitRepo.createBranch(veryLongName)
      gitRepo.commitFile('src/oauth.ts', 'export const oauth = true', 'OAuth implementation')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles maximum git branch name length', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Git allows branch names up to 250 characters
      const maxLength = 'feature/' + 'a'.repeat(240)
      gitRepo.createBranch(maxLength)
      gitRepo.commitFile('src/max.ts', 'export const max = true', 'Max length branch')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Unicode in branch names', () => {
    testWithRepo('handles emoji in branch names', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Some teams use emoji in branch names
      gitRepo.createBranch('feature/🚀-launch')
      gitRepo.commitFile('src/launch.ts', 'export const launch = true', 'Launch feature')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

      // Verify branch with emoji renders correctly via badge
      await expect(page.getByTestId('branch-badge-feature/🚀-launch')).toBeVisible()
    })

    testWithRepo('handles non-ASCII characters in branch names', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // International characters
      gitRepo.createBranch('feature/日本語')
      gitRepo.commitFile('src/japanese.ts', 'export const jp = true', 'Japanese feature')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

      // Verify Unicode branch renders correctly
      await expect(page.getByTestId('branch-badge-feature/日本語')).toBeVisible()
    })
  })

  testWithRepo.describe('Edge case branch names', () => {
    testWithRepo('handles branch names that look like git refs', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Branch names that could be confused with refs
      gitRepo.createBranch('heads/feature')
      gitRepo.commitFile('src/heads.ts', 'export const heads = true', 'Heads feature')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles branch names with @ symbol', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // @ is valid in branch names except @{ which is reserved
      gitRepo.createBranch('user@domain')
      gitRepo.commitFile('src/user.ts', 'export const user = true', 'User feature')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles branch starting with number', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.createBranch('123-fix-bug')
      gitRepo.commitFile('src/fix.ts', 'export const fix = true', 'Fix bug 123')

      gitRepo.checkout('main')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })
})
