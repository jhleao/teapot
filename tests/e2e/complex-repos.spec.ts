/**
 * Tests for complex repository structures.
 * These test Teapot's ability to handle non-trivial git histories.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo.describe('Complex Repository Structures', () => {
  testWithRepo.describe('Multi-branch at different depths', () => {
    testWithRepo(
      'can load repo with 5+ branches at different depths',
      async ({ page, gitRepo }) => {
        await expect(page.getByTestId('app-container')).toBeVisible()

        // Create 5 branches at different depths from main
        // Note: Can't use feature/api AND feature/api-auth because git ref conflict
        // Branch 1: feature-api (1 level)
        gitRepo.createBranch('feature-api')
        gitRepo.commitFile('src/api/index.ts', 'export const api = {}', 'Add API module')

        // Branch 2: feature-api-auth (stacked on feature-api)
        gitRepo.createBranch('feature-api-auth')
        gitRepo.commitFile('src/api/auth.ts', 'export function auth() {}', 'Add auth endpoint')

        // Branch 3: feature-api-users (stacked on feature-api-auth)
        gitRepo.createBranch('feature-api-users')
        gitRepo.commitFile(
          'src/api/users.ts',
          'export function getUsers() {}',
          'Add users endpoint'
        )

        // Go back to main and create more branches
        gitRepo.checkout('main')

        // Branch 4: hotfix/urgent (1 level, from main)
        gitRepo.createBranch('hotfix/urgent')
        gitRepo.commitFile('src/fix.ts', 'export function quickFix() {}', 'Urgent hotfix')

        gitRepo.checkout('main')

        // Branch 5: release/v1.0 (1 level, from main)
        gitRepo.createBranch('release/v1.0')
        gitRepo.commitFile('VERSION', '1.0.0', 'Prepare release v1.0')

        gitRepo.checkout('main')

        // Add the repo
        await addRepoToApp(page, gitRepo.repoPath)

        // Verify the stack view loads
        // Multiple branches = multiple stack-views, use .first()
        await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

        // Verify we can see the main branch content (Initial commit from fixture)
        await expect(page.getByText('Initial commit')).toBeVisible()
      }
    )

    testWithRepo(
      'can load repo with deeply nested stacked branches (3+ levels)',
      async ({ page, gitRepo }) => {
        await expect(page.getByTestId('app-container')).toBeVisible()

        // Create a 4-level deep stack:
        // main -> feature/base -> feature/layer1 -> feature/layer2 -> feature/layer3

        gitRepo.createBranch('feature/base')
        gitRepo.commitFile('src/base.ts', 'export const base = 1', 'Add base layer')

        gitRepo.createBranch('feature/layer1')
        gitRepo.commitFile('src/layer1.ts', 'import { base } from "./base"', 'Add layer 1')

        gitRepo.createBranch('feature/layer2')
        gitRepo.commitFile('src/layer2.ts', 'import { layer1 } from "./layer1"', 'Add layer 2')

        gitRepo.createBranch('feature/layer3')
        gitRepo.commitFile('src/layer3.ts', 'import { layer2 } from "./layer2"', 'Add layer 3')

        gitRepo.checkout('main')

        // Add the repo
        await addRepoToApp(page, gitRepo.repoPath)

        // Verify stack view loads (multiple views for multiple branches)
        await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

        // App should handle deep nesting without crashing
        await expect(page.getByTestId('sync-button').first()).toBeVisible()
      }
    )
  })

  testWithRepo.describe('Merge commits', () => {
    testWithRepo('can load repo with merge commits in history', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create a branch, add commits, then merge back to main
      gitRepo.createBranch('feature/to-merge')
      gitRepo.commitFile('src/feature.ts', 'export function feature() {}', 'Add feature')
      gitRepo.commitFile(
        'src/feature.ts',
        'export function feature() { return 1 }',
        'Improve feature'
      )

      // Go back to main and create a parallel commit
      gitRepo.checkout('main')
      gitRepo.commitFile('src/main.ts', 'console.log("main work")', 'Main branch work')

      // Merge the feature branch (creates merge commit)
      gitRepo.git('merge feature/to-merge --no-ff -m "Merge feature/to-merge"')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Verify stack view loads successfully (multiple branches = multiple stack-views)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })

      // Should show the merge commit
      await expect(page.getByText('Merge feature/to-merge')).toBeVisible({ timeout: 5000 })
    })

    testWithRepo('handles multiple merge commits', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create and merge first feature
      gitRepo.createBranch('feature/one')
      gitRepo.commitFile('src/one.ts', 'export const one = 1', 'Add one')
      gitRepo.checkout('main')
      gitRepo.git('merge feature/one --no-ff -m "Merge feature/one"')

      // Create and merge second feature
      gitRepo.createBranch('feature/two')
      gitRepo.commitFile('src/two.ts', 'export const two = 2', 'Add two')
      gitRepo.checkout('main')
      gitRepo.git('merge feature/two --no-ff -m "Merge feature/two"')

      // Create and merge third feature
      gitRepo.createBranch('feature/three')
      gitRepo.commitFile('src/three.ts', 'export const three = 3', 'Add three')
      gitRepo.checkout('main')
      gitRepo.git('merge feature/three --no-ff -m "Merge feature/three"')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Verify stack view handles multiple merge commits (multiple branches = multiple stack-views)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Tags', () => {
    testWithRepo('can load repo with tags', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Add some commits and tag them
      gitRepo.commitFile('src/v1.ts', 'export const version = "1.0.0"', 'Version 1.0.0')
      gitRepo.git('tag v1.0.0')

      gitRepo.commitFile('src/v1.ts', 'export const version = "1.1.0"', 'Version 1.1.0')
      gitRepo.git('tag v1.1.0')

      gitRepo.commitFile('src/v1.ts', 'export const version = "2.0.0"', 'Version 2.0.0')
      gitRepo.git('tag v2.0.0')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Verify stack view loads with tags present
      await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })

      // The commits should be visible
      await expect(page.getByText('Version 2.0.0')).toBeVisible()
    })

    testWithRepo('handles annotated tags', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      gitRepo.commitFile('CHANGELOG.md', '# v1.0.0\n- Initial release', 'Prepare v1.0.0 release')
      gitRepo.git('tag -a v1.0.0-annotated -m "Release version 1.0.0"')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view')).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Complex branch topology', () => {
    testWithRepo('handles diamond-shaped branch history', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create diamond pattern:
      //       B
      //      / \
      // A - +   + - D
      //      \ /
      //       C

      // A is the initial commit from fixture
      // Create B branch
      gitRepo.createBranch('branch-b')
      gitRepo.commitFile('src/b.ts', 'export const b = "b"', 'Commit in B')

      // Go back and create C branch
      gitRepo.checkout('main')
      gitRepo.createBranch('branch-c')
      gitRepo.commitFile('src/c.ts', 'export const c = "c"', 'Commit in C')

      // Merge both into a new branch D
      gitRepo.checkout('main')
      gitRepo.git('merge branch-b --no-ff -m "Merge B"')
      gitRepo.git('merge branch-c --no-ff -m "Merge C into D"')

      // Add the repo
      await addRepoToApp(page, gitRepo.repoPath)

      // Multiple branches = multiple stack-views
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })
})
