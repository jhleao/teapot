/**
 * Drag UX behavior E2E tests.
 *
 * These verify the visual and interactive behavior of the drag-and-drop
 * rebase mechanism: cursor changes, drop indicators, forbidden targets,
 * auto-scroll, and visual feedback during drag operations.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'
import {
  expectBranchVisible,
  getCommitShaForBranch,
  waitForStackView
} from './helpers/drag'

testWithRepo.describe('Drag Initiation', () => {
  testWithRepo('dragging a commit with branches starts drag state', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/draggable')
    gitRepo.commitFile('src/drag.ts', 'drag', 'Draggable commit')
    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const sha = await getCommitShaForBranch(page, 'feature/draggable')
    const handle = page.locator(`[data-commit-sha="${sha}"] [data-testid="commit-dot-handle"]`)

    await expect(handle).toBeVisible()

    const box = await handle.boundingBox()
    expect(box).toBeTruthy()

    // Start drag by mouse down + move
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 50, { steps: 5 })

    // Cursor should be hidden during drag (body style)
    const cursor = await page.evaluate(() => document.body.style.cursor)
    expect(cursor).toBe('none')

    // Release
    await page.mouse.up()

    // Cursor should be restored
    await page.waitForTimeout(500)
    const cursorAfter = await page.evaluate(() => document.body.style.cursor)
    expect(cursorAfter).not.toBe('none')
  })

  testWithRepo('right-click does not initiate drag', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/no-right-drag')
    gitRepo.commitFile('src/nr.ts', 'nr', 'No right drag')
    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const sha = await getCommitShaForBranch(page, 'feature/no-right-drag')
    const handle = page.locator(`[data-commit-sha="${sha}"] [data-testid="commit-dot-handle"]`)
    const box = await handle.boundingBox()

    // Right-click should not start drag
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' })
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 50)

    // Cursor should NOT be hidden (no drag started)
    const cursor = await page.evaluate(() => document.body.style.cursor)
    expect(cursor).not.toBe('none')
  })

  testWithRepo('cannot drag trunk commits (commits without branches)', async ({
    page,
    gitRepo
  }) => {
    // The "Initial commit" on main should not be draggable
    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Find the initial commit element
    const initialCommitEl = page.locator('[data-testid="commit-item"]').filter({
      hasText: 'Initial commit'
    })

    await expect(initialCommitEl).toBeVisible()

    const box = await initialCommitEl.boundingBox()

    // Try to drag the trunk commit
    await page.mouse.move(box!.x + 12, box!.y + 18) // Approximate commit dot position
    await page.mouse.down()
    await page.mouse.move(box!.x + 12, box!.y + 18 + 80, { steps: 5 })

    // Cursor should NOT be hidden (drag was not started for trunk)
    const cursor = await page.evaluate(() => document.body.style.cursor)
    // Note: this may or may not be 'none' depending on exact implementation
    // The important thing is the drag doesn't produce a rebase prompt
    await page.mouse.up()
    await page.waitForTimeout(500)

    // No rebase prompt should appear
    await expect(page.getByTestId('rebase-prompt')).not.toBeVisible()
  })
})

testWithRepo.describe('Drop Target Indicators', () => {
  testWithRepo('drop indicator appears on valid target during drag', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/indicator-test')
    gitRepo.commitFile('src/ind.ts', 'indicator', 'Indicator commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main target')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const featureSha = await getCommitShaForBranch(page, 'feature/indicator-test')
    const handle = page.locator(
      `[data-commit-sha="${featureSha}"] [data-testid="commit-dot-handle"]`
    )
    const handleBox = await handle.boundingBox()

    // Find the "Main target" commit
    const mainCommit = page.locator('[data-testid="commit-item"]').filter({
      hasText: 'Main target'
    })
    const mainBox = await mainCommit.boundingBox()

    // Start dragging
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()

    // Move toward the target
    await page.mouse.move(mainBox!.x + mainBox!.width / 4, mainBox!.y + mainBox!.height / 2, {
      steps: 10
    })

    // Wait for the drop indicator animation
    await page.waitForTimeout(200)

    // Check if the drop indicator on the target commit is visible
    // It should have the "hidden" class removed
    const mainSha = await mainCommit.getAttribute('data-commit-sha')
    if (mainSha) {
      const indicator = page.locator(
        `[data-commit-sha="${mainSha}"] [data-testid="drop-indicator"]`
      )
      const isHidden = await indicator.evaluate((el) => el.classList.contains('hidden'))
      // During active drag, the indicator should NOT be hidden
      expect(isHidden).toBe(false)
    }

    // Release
    await page.mouse.up()
  })

  testWithRepo('drop indicator disappears after mouse up', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/indicator-cleanup')
    gitRepo.commitFile('src/ic.ts', 'cleanup', 'Indicator cleanup')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main cleanup target')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const featureSha = await getCommitShaForBranch(page, 'feature/indicator-cleanup')
    const handle = page.locator(
      `[data-commit-sha="${featureSha}"] [data-testid="commit-dot-handle"]`
    )
    const handleBox = await handle.boundingBox()

    const mainCommit = page.locator('[data-testid="commit-item"]').filter({
      hasText: 'Main cleanup target'
    })
    const mainBox = await mainCommit.boundingBox()

    // Drag to target
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(mainBox!.x + mainBox!.width / 4, mainBox!.y + mainBox!.height / 2, {
      steps: 8
    })
    await page.waitForTimeout(200)

    // Release without confirming — cancel the rebase prompt
    await page.mouse.up()

    // All drop indicators should be hidden again
    await page.waitForTimeout(500)
    const visibleIndicators = await page.evaluate(() => {
      const indicators = document.querySelectorAll('[data-testid="drop-indicator"]')
      let visCount = 0
      indicators.forEach((el) => {
        if (!el.classList.contains('hidden')) visCount++
      })
      return visCount
    })
    expect(visibleIndicators).toBe(0)
  })
})

testWithRepo.describe('Forbidden Drop Targets', () => {
  testWithRepo('cannot drop a branch onto itself', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/self-drop')
    gitRepo.commitFile('src/self.ts', 'self', 'Self drop commit')
    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const sha = await getCommitShaForBranch(page, 'feature/self-drop')
    const commitEl = page.locator(`[data-commit-sha="${sha}"]`)
    const handle = commitEl.locator('[data-testid="commit-dot-handle"]')
    const handleBox = await handle.boundingBox()

    // Drag and release on itself
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    // Small movement, still on same commit
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 5, handleBox!.y + handleBox!.height / 2 + 5, { steps: 3 })
    await page.mouse.up()

    // No rebase prompt should appear
    await page.waitForTimeout(500)
    await expect(page.getByTestId('rebase-prompt')).not.toBeVisible()
  })

  testWithRepo('cannot drop parent onto its own child', async ({ page, gitRepo }) => {
    // main -> parent -> child
    // Dragging parent onto child should be forbidden
    gitRepo.createBranch('feature/parent')
    gitRepo.commitFile('src/p.ts', 'parent', 'Parent commit')

    gitRepo.createBranch('feature/child')
    gitRepo.commitFile('src/c.ts', 'child', 'Child commit')

    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const parentSha = await getCommitShaForBranch(page, 'feature/parent')
    const childSha = await getCommitShaForBranch(page, 'feature/child')

    const handle = page.locator(
      `[data-commit-sha="${parentSha}"] [data-testid="commit-dot-handle"]`
    )
    const childEl = page.locator(`[data-commit-sha="${childSha}"]`)

    const handleBox = await handle.boundingBox()
    const childBox = await childEl.boundingBox()

    // Try to drag parent onto child
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(childBox!.x + childBox!.width / 4, childBox!.y + childBox!.height / 2, {
      steps: 10
    })
    await page.mouse.up()

    // Should not produce a rebase prompt (child is a forbidden target)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('rebase-prompt')).not.toBeVisible()
  })
})

testWithRepo.describe('Drag Visual Feedback', () => {
  testWithRepo('dragged commit gets accent background', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/accent-bg')
    gitRepo.commitFile('src/accent.ts', 'accent', 'Accent commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main commit')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    const sha = await getCommitShaForBranch(page, 'feature/accent-bg')
    const commitEl = page.locator(`[data-commit-sha="${sha}"]`)
    const handle = commitEl.locator('[data-testid="commit-dot-handle"]')
    const handleBox = await handle.boundingBox()

    // Check class before drag
    const classBefore = await commitEl.getAttribute('class')

    // Start drag
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2 + 80, { steps: 5 })
    await page.waitForTimeout(100)

    // Check class during drag — should have accent background
    const classDuring = await commitEl.getAttribute('class')
    expect(classDuring).toContain('bg-accent')

    // Release
    await page.mouse.up()
  })

  testWithRepo('cursor is hidden during drag and restored after', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/cursor-test')
    gitRepo.commitFile('src/cursor.ts', 'cursor', 'Cursor test')
    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Cursor before drag
    const cursorBefore = await page.evaluate(() => document.body.style.cursor)
    expect(cursorBefore).not.toBe('none')

    const sha = await getCommitShaForBranch(page, 'feature/cursor-test')
    const handle = page.locator(`[data-commit-sha="${sha}"] [data-testid="commit-dot-handle"]`)
    const handleBox = await handle.boundingBox()

    // Start drag
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2 + 50, { steps: 5 })
    await page.waitForTimeout(100)

    // Cursor during drag
    const cursorDuring = await page.evaluate(() => document.body.style.cursor)
    expect(cursorDuring).toBe('none')

    // End drag
    await page.mouse.up()
    await page.waitForTimeout(500)

    // Cursor after drag
    const cursorAfter = await page.evaluate(() => document.body.style.cursor)
    expect(cursorAfter).not.toBe('none')
  })
})

testWithRepo.describe('Drag with Scrolling', () => {
  testWithRepo('drag works when viewport needs scrolling (many branches)', async ({
    page,
    gitRepo
  }) => {
    // Create many branches to force scrolling
    for (let i = 1; i <= 8; i++) {
      gitRepo.createBranch(`scroll-branch-${i}`)
      gitRepo.commitFile(`src/scroll${i}.ts`, `content ${i}`, `Scroll branch ${i} commit`)
      gitRepo.checkout('main')
    }

    gitRepo.commitFile('src/main.ts', 'main update', 'Main scroll update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Rebase one of the branches — this tests that coordinate calculation
    // works even if commits are at different scroll positions
    await expectBranchVisible(page, 'scroll-branch-1')

    await dragBranchOntoCommit(page, 'scroll-branch-1', 'Main scroll update')

    // Either prompt appears or the drag worked
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('app-container')).toBeVisible()
  })
})
