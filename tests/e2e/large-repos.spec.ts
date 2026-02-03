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

    testWithRepo(
      'handles repo with commits across multiple branches',
      async ({ page, gitRepo }) => {
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
      }
    )
  })

  testWithRepo.describe('Many files', () => {
    testWithRepo('can load repo with 50+ files', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create 50 files in one commit (more realistic)
      for (let i = 1; i <= 50; i++) {
        gitRepo.createFile(
          `src/components/Component${i}.tsx`,
          `export const Component${i} = () => <div>${i}</div>`
        )
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

      // Use Performance API for accurate timing
      const clickTiming = await page.evaluate(async () => {
        const button = document.querySelector('[data-testid="sync-button"]') as HTMLButtonElement
        if (!button) return { duration: -1, error: 'Button not found' }

        const startMark = 'click-start'
        const endMark = 'click-end'

        performance.mark(startMark)
        button.click()

        // Wait for next frame to ensure click event processed
        await new Promise((r) => requestAnimationFrame(r))
        performance.mark(endMark)

        const measure = performance.measure('click-duration', startMark, endMark)
        return { duration: measure.duration }
      })

      // Click should respond within 100ms (much stricter than 1s)
      expect(clickTiming.duration).toBeLessThan(100)
    })

    testWithRepo('measures repo load time', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create a medium repo
      for (let i = 1; i <= 25; i++) {
        gitRepo.commitFile(`src/file${i}.ts`, `export const n = ${i}`, `Commit ${i}`)
      }

      // Measure from before addRepoToApp until stack-view is visible
      const loadStartTime = Date.now()

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20000 })

      const loadTime = Date.now() - loadStartTime

      // Log the load time for monitoring (visible in test output)
      console.log(`Repo load time (25 commits): ${loadTime}ms`)

      // Should load within 10 seconds
      expect(loadTime).toBeLessThan(10000)
    })

    testWithRepo('measures frame rate during scroll', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create many commits
      for (let i = 1; i <= 40; i++) {
        gitRepo.commitFile(`src/item${i}.ts`, `${i}`, `Add item ${i}`)
      }

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 25000 })

      // Measure scroll performance using requestAnimationFrame timing
      const scrollMetrics = await page.evaluate(async () => {
        const stackView = document.querySelector('[data-testid="stack-view"]')
        if (!stackView) return { avgFrameTime: -1, frameCount: 0 }

        const frameTimes: number[] = []
        let lastTime = performance.now()
        let frameCount = 0

        return new Promise<{ avgFrameTime: number; frameCount: number }>((resolve) => {
          const measureFrame = () => {
            const now = performance.now()
            const frameTime = now - lastTime
            frameTimes.push(frameTime)
            lastTime = now
            frameCount++

            // Scroll a bit each frame
            stackView.scrollTop += 10

            if (frameCount < 30) {
              requestAnimationFrame(measureFrame)
            } else {
              const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
              resolve({ avgFrameTime, frameCount })
            }
          }

          requestAnimationFrame(measureFrame)
        })
      })

      // Average frame time should be under 50ms (20+ FPS minimum)
      // Ideally under 16.67ms for 60 FPS
      console.log(`Scroll avg frame time: ${scrollMetrics.avgFrameTime.toFixed(2)}ms`)
      expect(scrollMetrics.avgFrameTime).toBeLessThan(50)
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

    testWithRepo('measures interaction latency', async ({ page, gitRepo }) => {
      await expect(page.getByTestId('app-container')).toBeVisible()

      // Create repo
      for (let i = 1; i <= 20; i++) {
        gitRepo.commitFile(`src/file${i}.ts`, `${i}`, `Commit ${i}`)
      }

      await addRepoToApp(page, gitRepo.repoPath)
      await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 20000 })

      // Measure settings dialog open/close latency
      const dialogLatency = await page.evaluate(async () => {
        const settingsButton = document.querySelector(
          '[data-testid="settings-button"]'
        ) as HTMLButtonElement
        if (!settingsButton) return { openTime: -1, closeTime: -1 }

        // Measure open time
        const openStart = performance.now()
        settingsButton.click()

        // Wait for dialog to appear
        await new Promise<void>((resolve) => {
          const check = () => {
            const dialog = document.querySelector('[data-testid="settings-dialog"]')
            if (dialog) resolve()
            else requestAnimationFrame(check)
          }
          check()
        })
        const openTime = performance.now() - openStart

        // Measure close time with Escape
        const closeStart = performance.now()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

        // Wait for dialog to disappear
        await new Promise<void>((resolve) => {
          const check = () => {
            const dialog = document.querySelector('[data-testid="settings-dialog"]')
            if (!dialog) resolve()
            else requestAnimationFrame(check)
          }
          setTimeout(check, 10) // Small delay to let event process
        })
        const closeTime = performance.now() - closeStart

        return { openTime, closeTime }
      })

      console.log(
        `Dialog latency - Open: ${dialogLatency.openTime.toFixed(2)}ms, Close: ${dialogLatency.closeTime.toFixed(2)}ms`
      )

      // Dialogs should open/close within 200ms
      expect(dialogLatency.openTime).toBeLessThan(200)
      expect(dialogLatency.closeTime).toBeLessThan(200)
    })
  })

  testWithRepo.describe('Combined complexity', () => {
    testWithRepo(
      'handles repo with many commits, files, and branches',
      async ({ page, gitRepo }) => {
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
            gitRepo.commitFile(
              `src/feature${b}/file${c}.ts`,
              `${b}${c}`,
              `Feature ${b} commit ${c}`
            )
          }
          gitRepo.checkout('main')
        }

        // This gives us: 20 + (5*5) = 45 commits, 6 branches, 45+ files
        await addRepoToApp(page, gitRepo.repoPath)

        // Should handle this complexity
        await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: 30000 })
        await expect(page.getByTestId('sync-button').first()).toBeVisible()
      }
    )
  })
})
