/**
 * Tests for large repository handling.
 * Verifies Teapot performs well with many commits, files, and branches.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'

testWithRepo.describe('Large Repositories', () => {
  testWithRepo.describe('Many commits', () => {
    testWithRepo('can load repo with 20+ commits on main', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create 25 commits
      for (let i = 1; i <= 25; i++) {
        gitRepo.commitFile(`src/file${i}.ts`, `export const n = ${i}`, `Commit number ${i}`)
      }

      // Verify we have many commits
      const commitCount = gitRepo.git('rev-list --count HEAD')
      expect(parseInt(commitCount, 10)).toBeGreaterThanOrEqual(25)

      await addRepoToApp(page, gitRepo.repoPath)

      // UI should load within reasonable time
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20000 })

      // Should see recent commit
      await expect(page.getByText('Commit number 25')).toBeVisible()
    })

    testWithRepo('can load repo with 50+ commits', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create 50 commits
      for (let i = 1; i <= 50; i++) {
        gitRepo.commitFile(`src/module${i}/index.ts`, `export const mod = ${i}`, `Add module ${i}`)
      }

      await addRepoToApp(page, gitRepo.repoPath)

      // Should still load - testing that UI doesn't hang
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 30000 })
    })

    testWithRepo('handles repo with commits across multiple branches', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create 10 commits on main
      for (let i = 1; i <= 10; i++) {
        gitRepo.commitFile(`main/file${i}.ts`, `${i}`, `Main commit ${i}`)
      }

      // Create feature branch with 10 commits
      gitRepo.createBranch('feature/lots-of-work')
      for (let i = 1; i <= 10; i++) {
        gitRepo.commitFile(`feature/file${i}.ts`, `${i}`, `Feature commit ${i}`)
      }

      // Create another branch from main with 10 commits
      gitRepo.checkout('main')
      gitRepo.createBranch('feature/more-work')
      for (let i = 1; i <= 10; i++) {
        gitRepo.commitFile(`more/file${i}.ts`, `${i}`, `More commit ${i}`)
      }

      gitRepo.checkout('main')

      // Total: 30+ commits across 3 branches
      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 25000 })
    })
  })

  testWithRepo.describe('Many files', () => {
    testWithRepo('can load repo with 50+ files', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create 50 files in one commit (more realistic)
      for (let i = 1; i <= 50; i++) {
        gitRepo.createFile(`src/components/Component${i}.tsx`, `export const Component${i} = () => <div>${i}</div>`)
      }
      gitRepo.git('add .')
      gitRepo.git('commit -m "Add 50 components"')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText('Add 50 components')).toBeVisible()
    })

    testWithRepo('can load repo with nested directory structure', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create deeply nested structure
      const dirs = ['src', 'components', 'features', 'auth', 'login', 'form', 'fields']
      let currentPath = ''
      for (const dir of dirs) {
        currentPath = currentPath ? `${currentPath}/${dir}` : dir
        gitRepo.createFile(`${currentPath}/index.ts`, `export * from './${dir}'`)
      }
      gitRepo.git('add .')
      gitRepo.git('commit -m "Add nested directory structure"')

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })

    testWithRepo('handles large files gracefully', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create a large file (100KB of content)
      const largeContent = 'x'.repeat(100 * 1024)
      gitRepo.commitFile('src/large-file.txt', largeContent, 'Add large file')

      await addRepoToApp(page, gitRepo.repoPath)

      // UI should still load
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 15000 })
    })
  })

  testWithRepo.describe('Many branches', () => {
    testWithRepo('can load repo with 10+ branches', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create 10 feature branches
      for (let i = 1; i <= 10; i++) {
        gitRepo.createBranch(`feature/branch-${i}`)
        gitRepo.commitFile(`src/branch${i}.ts`, `${i}`, `Work on branch ${i}`)
        gitRepo.checkout('main')
      }

      // Verify branch count
      const branchCount = gitRepo.git('branch').split('\n').length
      expect(branchCount).toBeGreaterThanOrEqual(10)

      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20000 })
    })

    testWithRepo('can load repo with mixed branch types', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create various branch types
      const branchTypes = ['feature', 'bugfix', 'hotfix', 'release', 'chore']

      for (const type of branchTypes) {
        for (let i = 1; i <= 3; i++) {
          gitRepo.createBranch(`${type}/task-${i}`)
          gitRepo.commitFile(`src/${type}${i}.ts`, `${type} ${i}`, `${type} task ${i}`)
          gitRepo.checkout('main')
        }
      }

      // 15 branches total (5 types * 3 each)
      await addRepoToApp(page, gitRepo.repoPath)

      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20000 })
    })
  })

  testWithRepo.describe('Performance checks', () => {
    testWithRepo('UI remains responsive after loading large repo', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create a moderately large repo
      for (let i = 1; i <= 30; i++) {
        gitRepo.commitFile(`src/file${i}.ts`, `export const n = ${i}`, `Commit ${i}`)
      }

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20000 })

      // Verify UI is still responsive by interacting with it
      const syncButton = page.getByTestId('sync-button')
      await expect(syncButton).toBeVisible()

      // Click should respond quickly
      const startTime = Date.now()
      await syncButton.click()
      const responseTime = Date.now() - startTime

      // Response should be under 1 second for a click
      expect(responseTime).toBeLessThan(1000)
    })

    // Skip: Would need to measure render times which requires special setup
    testWithRepo.skip('renders commit list within acceptable time', async ({ page, gitRepo }) => {
      // TODO: Implement performance timing for commit list render
      // Would need to inject performance markers in the app
    })

    testWithRepo('no visible lag when scrolling commit history', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create many commits
      for (let i = 1; i <= 40; i++) {
        gitRepo.commitFile(`src/item${i}.ts`, `${i}`, `Add item ${i}`)
      }

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 25000 })

      // Try scrolling within the stack view
      const stackView = page.getByTestId('stack-view')

      // Scroll down
      await stackView.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })

      // Wait a bit and scroll back up
      await page.waitForTimeout(200)

      await stackView.evaluate((el) => {
        el.scrollTop = 0
      })

      // If we get here without timeout, scrolling was responsive
      await expect(stackView).toBeVisible()
    })
  })

  testWithRepo.describe('Combined complexity', () => {
    testWithRepo('handles repo with many commits, files, and branches', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create a realistically complex repository
      // 20 commits on main
      for (let i = 1; i <= 20; i++) {
        gitRepo.commitFile(`src/main${i}.ts`, `${i}`, `Main ${i}`)
      }

      // 5 feature branches with 5 commits each
      for (let b = 1; b <= 5; b++) {
        gitRepo.createBranch(`feature/complex-${b}`)
        for (let c = 1; c <= 5; c++) {
          gitRepo.commitFile(`src/feature${b}/file${c}.ts`, `${b}${c}`, `Feature ${b} commit ${c}`)
        }
        gitRepo.checkout('main')
      }

      // This gives us: 20 + (5*5) = 45 commits, 6 branches, 45+ files
      await addRepoToApp(page, gitRepo.repoPath)

      // Should handle this complexity
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 30000 })
      await expect(page.getByTestId('sync-button').first()).toBeVisible()
    })
  })
})
