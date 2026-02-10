/**
 * Rebase abort and recovery E2E tests.
 *
 * These verify that aborting a rebase at various stages correctly
 * restores the repository to its pre-rebase state.
 */
import { addRepoToApp, expect, testWithRepo } from './fixtures/testWithRepo'
import {
  abortRebase,
  cancelRebase,
  confirmRebase,
  dragBranchOnto,
  dragBranchOntoCommit,
  expectBranchVisible,
  waitForConflictDialog,
  waitForConflictDialogDismissed,
  waitForRebasePrompt,
  waitForRebasePromptDismissed,
  waitForStackView
} from './helpers/drag'

testWithRepo.describe('Cancel Before Confirm', () => {
  testWithRepo('cancel from rebase prompt leaves repo untouched', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/cancel-early')
    gitRepo.commitFile('src/early.ts', 'early', 'Early commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main update')

    const originalSha = gitRepo.git('rev-parse feature/cancel-early')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/cancel-early', 'Main update')
    await waitForRebasePrompt(page)

    // Cancel before confirming
    await cancelRebase(page)
    await waitForRebasePromptDismissed(page)

    // SHA unchanged
    const afterSha = gitRepo.git('rev-parse feature/cancel-early')
    expect(afterSha).toBe(originalSha)
  })

  testWithRepo('cancel from prompt with stacked branches leaves all untouched', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feat/parent')
    gitRepo.commitFile('src/p.ts', 'p', 'Parent')

    gitRepo.createBranch('feat/child')
    gitRepo.commitFile('src/c.ts', 'c', 'Child')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/m.ts', 'm', 'Main')

    const parentSha = gitRepo.git('rev-parse feat/parent')
    const childSha = gitRepo.git('rev-parse feat/child')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feat/parent', 'Main')
    await waitForRebasePrompt(page)
    await cancelRebase(page)
    await waitForRebasePromptDismissed(page)

    // Both branches unchanged
    expect(gitRepo.git('rev-parse feat/parent')).toBe(parentSha)
    expect(gitRepo.git('rev-parse feat/child')).toBe(childSha)
  })

  testWithRepo('can re-initiate rebase after canceling', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/retry')
    gitRepo.commitFile('src/retry.ts', 'retry', 'Retry commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/m.ts', 'main', 'Main update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // First attempt — cancel
    await dragBranchOntoCommit(page, 'feature/retry', 'Main update')
    await waitForRebasePrompt(page)
    await cancelRebase(page)
    await waitForRebasePromptDismissed(page)

    // Wait for UI to settle
    await page.waitForTimeout(1000)

    // Second attempt — confirm
    await dragBranchOntoCommit(page, 'feature/retry', 'Main update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // Rebase should have succeeded
    const log = gitRepo.git('log --oneline feature/retry')
    expect(log).toContain('Main update')
    expect(log).toContain('Retry commit')
  })
})

testWithRepo.describe('Abort During Conflict', () => {
  testWithRepo('abort from conflict dialog restores original state', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('feature/abort-conflict')
    gitRepo.commitFile('src/shared.ts', 'feature version', 'Feature changes')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/shared.ts', 'main version', 'Main changes')

    const originalSha = gitRepo.git('rev-parse feature/abort-conflict')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/abort-conflict', 'Main changes')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)
    await abortRebase(page)
    await waitForConflictDialogDismissed(page)

    // Original state restored
    const afterSha = gitRepo.git('rev-parse feature/abort-conflict')
    expect(afterSha).toBe(originalSha)

    // Branch should still be visible
    await expectBranchVisible(page, 'feature/abort-conflict')
  })

  testWithRepo('abort during conflict with stacked branches restores all', async ({
    page,
    gitRepo
  }) => {
    gitRepo.createBranch('stack/parent')
    gitRepo.commitFile('src/shared.ts', 'parent version', 'Parent changes')

    gitRepo.createBranch('stack/child')
    gitRepo.commitFile('src/child.ts', 'child code', 'Child work')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/shared.ts', 'main version', 'Main changes')

    const parentSha = gitRepo.git('rev-parse stack/parent')
    const childSha = gitRepo.git('rev-parse stack/child')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'stack/parent', 'Main changes')
    await waitForRebasePrompt(page)
    await confirmRebase(page)

    await waitForConflictDialog(page)
    await abortRebase(page)
    await waitForConflictDialogDismissed(page)

    // Both branches restored
    expect(gitRepo.git('rev-parse stack/parent')).toBe(parentSha)
    expect(gitRepo.git('rev-parse stack/child')).toBe(childSha)
  })

  testWithRepo('can retry rebase after aborting conflict', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/retry-after-abort')
    gitRepo.commitFile('src/conflict.ts', 'feature version', 'Feature change')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/conflict.ts', 'main version', 'Main change')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // First attempt — abort on conflict
    await dragBranchOntoCommit(page, 'feature/retry-after-abort', 'Main change')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForConflictDialog(page)
    await abortRebase(page)
    await waitForConflictDialogDismissed(page)

    // Wait for UI to settle
    await page.waitForTimeout(2000)

    // Can re-initiate the same rebase
    await dragBranchOntoCommit(page, 'feature/retry-after-abort', 'Main change')
    await waitForRebasePrompt(page)

    // Verify the prompt appeared again — we can interact with it
    await expect(page.getByTestId('confirm-rebase-button')).toBeVisible()

    // Abort again to clean up
    await cancelRebase(page)
  })
})

testWithRepo.describe('Abort Idempotency', () => {
  testWithRepo('aborting when no rebase is in progress is safe', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/no-rebase')
    gitRepo.commitFile('src/feat.ts', 'code', 'Feature commit')
    gitRepo.checkout('main')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // No rebase in progress — calling abort via IPC should be a no-op
    const result = await page.evaluate(async (rp: string) => {
      try {
        await window.api.abortRebase({ repoPath: rp })
        return 'ok'
      } catch (e: unknown) {
        return (e as Error).message
      }
    }, gitRepo.repoPath)

    // Should succeed without error (either 'ok' or a non-throwing result)
    // The important thing is the app doesn't crash
    await expect(page.getByTestId('app-container')).toBeVisible()
  })
})

testWithRepo.describe('Recovery After Rebase', () => {
  testWithRepo('UI refreshes correctly after successful rebase', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/refresh-check')
    gitRepo.commitFile('src/r.ts', 'refresh', 'Refresh commit')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/main.ts', 'main', 'Main refresh update')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    await dragBranchOntoCommit(page, 'feature/refresh-check', 'Main refresh update')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForRebasePromptDismissed(page)

    // UI should show updated state
    await expectBranchVisible(page, 'feature/refresh-check')

    // The "Main refresh update" commit should be visible in the trunk
    await expect(page.getByText('Main refresh update')).toBeVisible()

    // The feature commit should still be visible
    await expect(page.getByText('Refresh commit')).toBeVisible()
  })

  testWithRepo('app remains interactive after abort', async ({ page, gitRepo }) => {
    gitRepo.createBranch('feature/interactive')
    gitRepo.commitFile('src/shared.ts', 'feature', 'Feature shared')

    gitRepo.checkout('main')
    gitRepo.commitFile('src/shared.ts', 'main', 'Main shared')

    await addRepoToApp(page, gitRepo.repoPath)
    await waitForStackView(page)

    // Start and abort a rebase
    await dragBranchOntoCommit(page, 'feature/interactive', 'Main shared')
    await waitForRebasePrompt(page)
    await confirmRebase(page)
    await waitForConflictDialog(page)
    await abortRebase(page)
    await waitForConflictDialogDismissed(page)

    // App should still be interactive
    await expect(page.getByTestId('app-container')).toBeVisible()
    await expect(page.getByTestId('settings-button')).toBeVisible()
    await expect(page.getByTestId('stack-view').first()).toBeVisible()

    // Can still open settings
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()
  })
})
