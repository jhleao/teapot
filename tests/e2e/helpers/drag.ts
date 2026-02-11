import { expect, Page } from '@playwright/test'

/**
 * Retrieves the commit SHA for a branch by evaluating the DOM.
 * Finds the commit element that contains a branch badge for the given branch name.
 */
export async function getCommitShaForBranch(page: Page, branchName: string): Promise<string> {
  const sha = await page.evaluate((name: string) => {
    const badge = document.querySelector(`[data-testid="branch-badge-${name}"]`)
    if (!badge) return null
    const commitEl = badge.closest('[data-commit-sha]')
    return commitEl?.getAttribute('data-commit-sha') ?? null
  }, branchName)

  if (!sha) throw new Error(`Could not find commit SHA for branch "${branchName}"`)
  return sha
}

/**
 * Retrieves the commit SHA for a commit by its message text.
 * Searches through all commit items for matching text content.
 */
export async function getCommitShaByMessage(page: Page, messageSubstring: string): Promise<string> {
  const sha = await page.evaluate((msg: string) => {
    const commitEls = document.querySelectorAll('[data-commit-sha]')
    for (const el of commitEls) {
      if (el.textContent?.includes(msg)) {
        return el.getAttribute('data-commit-sha')
      }
    }
    return null
  }, messageSubstring)

  if (!sha) throw new Error(`Could not find commit with message containing "${messageSubstring}"`)
  return sha
}

/**
 * Gets all visible commit SHAs with their associated branch names and messages.
 * Useful for debugging and asserting state.
 */
export async function getAllVisibleCommits(
  page: Page
): Promise<Array<{ sha: string; branches: string[]; text: string }>> {
  return page.evaluate(() => {
    const elements = document.querySelectorAll('[data-commit-sha]')
    return Array.from(elements).map((el) => {
      const sha = el.getAttribute('data-commit-sha') ?? ''
      const badges = el.querySelectorAll('[data-testid^="branch-badge-"]')
      const branches = Array.from(badges).map((b) => {
        const testid = b.getAttribute('data-testid') ?? ''
        return testid.replace('branch-badge-', '')
      })
      return { sha, branches, text: el.textContent?.trim().slice(0, 120) ?? '' }
    })
  })
}

/**
 * Simulates a drag-and-drop rebase operation from one commit to another.
 *
 * The drag is performed by:
 * 1. Locating the commit dot handle of the source commit
 * 2. Pressing mouse down on it
 * 3. Moving the mouse in incremental steps toward the target commit
 * 4. Releasing the mouse on the target
 *
 * @param page - Playwright page
 * @param fromSha - Full SHA of the commit to drag (the branch head)
 * @param toSha - Full SHA of the commit to drop onto (the new base)
 * @param options - Drag configuration
 */
export async function dragCommitOnto(
  page: Page,
  fromSha: string,
  toSha: string,
  options: { steps?: number; delayMs?: number } = {}
): Promise<void> {
  const { steps = 15, delayMs = 16 } = options

  const fromHandle = page.locator(
    `[data-commit-sha="${fromSha}"] [data-testid="commit-dot-handle"]`
  )
  const toCommit = page.locator(`[data-commit-sha="${toSha}"]`)

  await expect(fromHandle).toBeVisible({ timeout: 5000 })
  await expect(toCommit).toBeVisible({ timeout: 5000 })

  const fromBox = await fromHandle.boundingBox()
  const toBox = await toCommit.boundingBox()

  if (!fromBox) throw new Error(`Commit dot handle not found for SHA ${fromSha.slice(0, 8)}`)
  if (!toBox) throw new Error(`Target commit element not found for SHA ${toSha.slice(0, 8)}`)

  const fromX = fromBox.x + fromBox.width / 2
  const fromY = fromBox.y + fromBox.height / 2
  // Target the bottom portion of the commit element (drop indicators appear at bottom)
  const toX = toBox.x + toBox.width / 4
  const toY = toBox.y + toBox.height * 0.8

  // Move to starting position
  await page.mouse.move(fromX, fromY)
  // Press down to initiate drag
  await page.mouse.down()

  // Move incrementally to trigger DragContext's mousemove handlers
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps
    const x = fromX + (toX - fromX) * progress
    const y = fromY + (toY - fromY) * progress
    await page.mouse.move(x, y)
    await page.waitForTimeout(delayMs)
  }

  // Release to complete the drop
  await page.mouse.up()
}

/**
 * Drags a branch onto another branch by name.
 * Convenience wrapper around dragCommitOnto that resolves branch names to SHAs.
 */
export async function dragBranchOnto(
  page: Page,
  fromBranch: string,
  toBranch: string,
  options: { steps?: number; delayMs?: number } = {}
): Promise<void> {
  const fromSha = await getCommitShaForBranch(page, fromBranch)
  const toSha = await getCommitShaForBranch(page, toBranch)
  await dragCommitOnto(page, fromSha, toSha, options)
}

/**
 * Drags a branch onto a trunk commit (identified by message text).
 */
export async function dragBranchOntoCommit(
  page: Page,
  fromBranch: string,
  toCommitMessage: string,
  options: { steps?: number; delayMs?: number } = {}
): Promise<void> {
  const fromSha = await getCommitShaForBranch(page, fromBranch)
  const toSha = await getCommitShaByMessage(page, toCommitMessage)
  await dragCommitOnto(page, fromSha, toSha, options)
}

/**
 * Waits for the rebase prompt to appear after a drag operation.
 * The prompt shows "Cancel" and "Confirm" buttons.
 */
export async function waitForRebasePrompt(page: Page, timeoutMs = 10000): Promise<void> {
  await expect(page.getByTestId('rebase-prompt')).toBeVisible({ timeout: timeoutMs })
}

/**
 * Confirms a pending rebase by clicking the "Confirm" button.
 */
export async function confirmRebase(page: Page): Promise<void> {
  await page.getByTestId('confirm-rebase-button').click()
}

/**
 * Cancels a pending rebase by clicking the "Cancel" button.
 */
export async function cancelRebase(page: Page): Promise<void> {
  await page.getByTestId('cancel-rebase-button').click()
}

/**
 * Waits for the conflict resolution dialog to appear.
 */
export async function waitForConflictDialog(page: Page, timeoutMs = 30000): Promise<void> {
  await expect(page.getByTestId('conflict-resolution-dialog')).toBeVisible({ timeout: timeoutMs })
}

/**
 * Waits for the conflict resolution dialog to disappear.
 */
export async function waitForConflictDialogDismissed(
  page: Page,
  timeoutMs = 30000
): Promise<void> {
  await expect(page.getByTestId('conflict-resolution-dialog')).not.toBeVisible({
    timeout: timeoutMs
  })
}

/**
 * Clicks "Continue" in the conflict resolution dialog.
 */
export async function continueRebase(page: Page): Promise<void> {
  await page.getByTestId('continue-rebase-button').click()
}

/**
 * Clicks "Abort" in the conflict resolution dialog.
 */
export async function abortRebase(page: Page): Promise<void> {
  await page.getByTestId('abort-rebase-button').click()
}

/**
 * Gets the execution path (worktree) where conflicts should be resolved.
 * This is needed to programmatically resolve conflicts in E2E tests.
 */
export async function getRebaseExecutionPath(page: Page, repoPath: string): Promise<string | null> {
  return page.evaluate(async (rp: string) => {
    const result = await window.api.getRebaseExecutionPath({ repoPath: rp })
    return result.path ?? null
  }, repoPath)
}

/**
 * Waits for the rebase prompt to disappear, indicating the rebase completed or was canceled.
 */
export async function waitForRebasePromptDismissed(page: Page, timeoutMs = 30000): Promise<void> {
  await expect(page.getByTestId('rebase-prompt')).not.toBeVisible({ timeout: timeoutMs })
}

/**
 * Asserts that a branch badge is visible in the stack view.
 */
export async function expectBranchVisible(
  page: Page,
  branchName: string,
  timeoutMs = 10000
): Promise<void> {
  await expect(page.getByTestId(`branch-badge-${branchName}`)).toBeVisible({ timeout: timeoutMs })
}

/**
 * Asserts that a branch badge is NOT visible in the stack view.
 */
export async function expectBranchNotVisible(page: Page, branchName: string): Promise<void> {
  await expect(page.getByTestId(`branch-badge-${branchName}`)).not.toBeVisible()
}

/**
 * Waits for the stack view to be loaded and visible.
 */
export async function waitForStackView(page: Page, timeoutMs = 15000): Promise<void> {
  await expect(page.getByTestId('stack-view').first()).toBeVisible({ timeout: timeoutMs })
}
